import {
  sendMessage,
  editMessageText,
  editMessageReplyMarkup,
  answerCallbackQuery,
} from "../telegram.js";
import {
  MAIN_MENU_TEXT,
  mainMenuKeyboard,
  NEWS_MENU_TEXT,
  newsMenuKeyboard,
  backOnlyKeyboard,
  NEWS_ITEM_LABELS,
  TRADE_MODE_SELECT_TEXT,
  tradeModeKeyboard,
  symbolPromptText,
  symbolPromptKeyboard,
  aiModePromptText,
  aiModeKeyboard,
  chartPhotoPromptText,
  chartPhotoReceivedText,
  chartPhotoKeyboard,
  MAX_CHART_PHOTOS,
  riwayatStatsText,
  TRADE_MODES,
  strategyReplyKeyboard,
  STRATEGY_KEYBOARD_INTRO_TEXT,
  autoTradeModeKeyboard,
} from "../menus.js";
import { listSignals, markSignalResult, summarizeSignalStats } from "../signalLog.js";
import { formatNewsScheduleText, formatUpcomingAllText } from "../newsScheduleFormat.js";
import {
  getMode,
  setMode,
  setTradeMode,
  getTradeMode,
  setSymbol,
  getSymbol,
  setAiMode,
  addPhoto,
  countPhotos,
  claimPhotoPromptMsgId,
  setPhotoPromptMsgId,
  resetSession,
  startAnalysis,
  startAutoSignal,
  stopAutoSignal,
  getAutoMode,
} from "../state.js";
import { buildMarketDataPackage, normalizeSymbol } from "../marketData.js";
import { isMt5Symbol } from "../marketSource.js";
import { escapeHtml } from "../htmlUtil.js";

const VALID_TRADE_MODES = ["scalping", "daytrade", "swing"];

/**
 * Cek apakah chat_id boleh pakai bot ini.
 * Dikontrol lewat env var ALLOWED_CHAT_IDS, isi daftar chat_id dipisah koma
 * (misal "111111,222222"). Kalau env var ini TIDAK diset sama sekali, bot
 * tetap terbuka untuk semua orang (perilaku lama) — supaya tidak mengunci
 * diri sendiri kalau lupa setup. Sangat disarankan untuk selalu diisi
 * kalau bot ini dipakai pribadi/terbatas, karena tiap analisis memicu
 * banyak panggilan Groq API (biaya kuota).
 */
function isAllowedChat(env, chatId) {
  const raw = env.ALLOWED_CHAT_IDS;
  if (!raw) return true;
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(String(chatId));
}

export async function handleUpdate(env, update) {
  const chatId = update.callback_query?.message?.chat?.id ?? update.message?.chat?.id;

  if (chatId !== undefined && !isAllowedChat(env, chatId)) {
    console.warn(`Chat ${chatId} tidak ada di ALLOWED_CHAT_IDS, update diabaikan.`);
    return; // diam saja, jangan balas apa pun ke chat yang tidak diizinkan
  }

  if (update.callback_query) {
    return handleCallbackQuery(env, update.callback_query);
  }
  if (update.message) {
    return handleMessage(env, update.message);
  }
}

async function handleMessage(env, message) {
  const chatId = message.chat.id;
  const text = message.text?.trim();

  // --- Perintah global ---
  if (text === "/start") {
    const oldPhotoPromptMsgId = await resetSession(env, chatId);
    if (oldPhotoPromptMsgId) await editMessageReplyMarkup(env, chatId, oldPhotoPromptMsgId);
    await sendMessage(env, chatId, MAIN_MENU_TEXT, mainMenuKeyboard());
    // Keyboard permanen (nempel di atas kolom ketik) buat pilih Strategi
    // 1/2 XAUUSD kapan aja -- kirim ulang tiap /start supaya kalau
    // sebelumnya sempat hilang/ke-dismiss, gampang dipanggil balik.
    await sendMessage(env, chatId, STRATEGY_KEYBOARD_INTRO_TEXT, strategyReplyKeyboard());
    return;
  }

  if (text === "/batal") {
    const oldPhotoPromptMsgId = await resetSession(env, chatId); // ini juga membatalkan proses AI kalau sedang berjalan
    if (oldPhotoPromptMsgId) await editMessageReplyMarkup(env, chatId, oldPhotoPromptMsgId);
    await sendMessage(env, chatId, "❌ Dibatalkan. Kembali ke menu utama.", mainMenuKeyboard());
    return;
  }

  // --- Tombol keyboard permanen: pilih Strategi 1/2 (XAUUSD). Reply
  // keyboard cuma bisa kirim TEKS persis label tombolnya, jadi dicocokkan
  // sebagai teks biasa, bukan callback_data. Lanjut ke pilih trade mode
  // (inline) dulu sebelum benar-benar mulai siklus auto.
  if (text === "🧭 Strategi 1 (XAUUSD)" || text === "🎯 Strategi 2 (Pro)") {
    const isS2 = text === "🎯 Strategi 2 (Pro)";
    await setMode(env, chatId, isS2 ? "choosing_auto_trademode_s2" : "choosing_auto_trademode_s1");
    await sendMessage(
      env,
      chatId,
      `${isS2 ? "🎯 <b>Strategi 2 (Pro)</b>" : "🧭 <b>Strategi 1</b>"} — XAUUSD\n\nPilih mode trading buat siklus analisanya:`,
      autoTradeModeKeyboard()
    );
    return;
  }

  // --- Alias tombol "Stop Auto" di keyboard permanen -> sama seperti /stop_auto ---
  if (text === "⏹️ Stop Auto") {
    const wasOn = await getAutoMode(env, chatId);
    await stopAutoSignal(env, chatId);
    await sendMessage(
      env,
      chatId,
      wasOn
        ? "⏹️ Auto-signal dihentikan."
        : "Auto-signal emang lagi nggak aktif kok, tapi udah dipastikan mati ya 👍"
    );
    return;
  }

  if (text.startsWith("/auto")) {
    const alreadyOn = await getAutoMode(env, chatId);
    if (alreadyOn) {
      await sendMessage(env, chatId, "🤖 Auto-signal udah aktif. Ketik /stop_auto buat berhenti.");
      return;
    }

    // Format: /auto [SIMBOL] [mode_trading]
    // Contoh: /auto XAUUSD swing   -> XAUUSD, mode Swing
    //         /auto BTCUSDT       -> BTCUSDT, mode Scalping (default)
    //         /auto                -> BTCUSDT, mode Scalping (default lama, backward-compatible)
    const parts = text.trim().split(/\s+/).slice(1); // buang "/auto"
    const rawSymbol = parts[0];
    const rawMode = parts[1];

    const symbol = rawSymbol ? normalizeSymbol(rawSymbol) : "BTCUSDT";
    const tradeMode = rawMode && TRADE_MODES[rawMode] ? rawMode : "scalping";

    if (rawMode && !TRADE_MODES[rawMode]) {
      await sendMessage(
        env,
        chatId,
        `⚠️ Mode trading "${escapeHtml(rawMode)}" tidak dikenal, pakai salah satu: scalping, daytrade, swing. Memakai default: scalping.`
      );
    }

    // Jumlah AI khusus /auto: XAUUSD (data dari MT5 bridge) pakai mode
    // "Lengkap" (10 AI spesialis), simbol lain (kripto, dari Binance/Bybit)
    // tetap "Cepat" (5 AI) -- siklus auto jalan tiap 10 menit terus-menerus,
    // jadi 10 AI untuk SEMUA simbol akan boros limit Groq API kalau dipakai
    // ke banyak pair kripto sekaligus.
    const aiMode = isMt5Symbol(symbol) ? "lengkap" : "cepat";

    await startAutoSignal(env, chatId, { symbol, tradeMode, aiMode });

    const modeLabel = TRADE_MODES[tradeMode]?.label || tradeMode;
    const aiCountLabel = aiMode === "lengkap" ? "10 AI" : "5 AI";
    await sendMessage(
      env,
      chatId,
      `🤖 <b>Auto-Signal AKTIF</b>

Bot bakal otomatis analisis <b>${escapeHtml(symbol)}</b> (mode ${escapeHtml(modeLabel)}, ${aiCountLabel}) tiap <b>10 menit</b>, dan otomatis ngecek TP/SL sinyal sebelumnya terhadap harga terkini.${
        isMt5Symbol(symbol)
          ? `\n\n${
              env.MT5_AUTONOMOUS_XAUUSD === "true"
                ? "🔓 Mode OTONOM aktif untuk simbol ini — sinyal BUY/SELL akan otomatis dieksekusi ke MT5 (dengan 3 kontrol risiko: 1 posisi terbuka, limit trade/hari, circuit breaker rugi harian).\n📐 Lot dihitung otomatis tiap entry supaya risiko ke SL asli ≈ 1% balance, plus lapisan tambahan: force-close otomatis kalau floating profit/rugi duluan nyentuh +2%/-1% balance sebelum harga sampai ke level SL/TP asli sinyal.\n⏭️ Siklus auto otomatis di-skip (tanpa panggil AI) selama masih ada posisi terbuka, biar hemat limit API."
                : "🔒 Mode otonom BELUM aktif (env MT5_AUTONOMOUS_XAUUSD belum \"true\") — bot cuma kirim sinyal teks, TIDAK eksekusi ke MT5."
            }`
          : ""
      }

⚠️ Selama auto-signal aktif, sebaiknya jangan pakai "Signal Trade" manual di chat ini bareng, biar nggak saling tabrakan.

Ketik /stop_auto buat berhenti kapan aja.`
    );
    return;
  }

  if (text === "/stop_auto") {
    const wasOn = await getAutoMode(env, chatId);
    await stopAutoSignal(env, chatId);
    await sendMessage(
      env,
      chatId,
      wasOn
        ? "⏹️ Auto-signal dihentikan."
        : "Auto-signal emang lagi nggak aktif kok, tapi udah dipastikan mati ya 👍"
    );
    return;
  }

  const mode = await getMode(env, chatId);

  // --- Mode: sedang menunggu input simbol pair ---
  if (mode === "awaiting_symbol") {
    if (!text) {
      await sendMessage(env, chatId, "Mohon ketik simbol pair (contoh: BTCUSDT), atau /batal untuk keluar.");
      return;
    }

    const symbol = normalizeSymbol(text);
    if (symbol.length < 5) {
      await sendMessage(env, chatId, "Simbol sepertinya tidak valid. Contoh yang benar: BTCUSDT, ETHUSDT. Coba lagi, atau /batal.");
      return;
    }

    await setSymbol(env, chatId, symbol);
    await setMode(env, chatId, "choosing_ai_mode");
    await sendMessage(env, chatId, aiModePromptText(symbol), aiModeKeyboard());
    return;
  }

  // --- Mode: sedang pilih mode analisis, tapi user malah kirim teks ---
  if (mode === "choosing_ai_mode") {
    await sendMessage(env, chatId, "Silakan pilih mode analisis lewat tombol di atas, atau ketik /batal.");
    return;
  }

  // --- Mode: sedang pilih trade mode buat Strategi 1/2, tapi user malah kirim teks ---
  if (mode === "choosing_auto_trademode_s1" || mode === "choosing_auto_trademode_s2") {
    await sendMessage(env, chatId, "Silakan pilih mode trading lewat tombol di atas, atau ketik /batal.");
    return;
  }

  // --- Mode: sedang menunggu foto chart (khusus mode Lengkap, untuk AI Price Action) ---
  // Bisa terima lebih dari 1 foto (misal beda timeframe). Foto ditampung dulu,
  // analisis baru dijalankan setelah user tekan tombol "Analisa Sekarang".
  // Pesan konfirmasi di-EDIT di tempat tiap foto baru masuk (bukan kirim pesan
  // baru tiap kali), supaya chat tidak numpuk dan totalnya jelas kelihatan naik.
  //
  // CATATAN RACE CONDITION: kalau user kirim beberapa foto sekaligus (misal
  // album), beberapa update webhook bisa diproses hampir bersamaan. Supaya
  // tidak semuanya sama-sama bikin pesan baru sendiri-sendiri (karena belum
  // sempat lihat pesan yang lain sudah dibuat), pakai pola "claim" atomik:
  // cuma request PERTAMA yang boleh bikin pesan baru, request lainnya nunggu
  // (polling singkat) sampai message_id itu siap, baru ikut EDIT pesan yang sama.
  if (mode === "awaiting_chart") {
    if (message.photo && message.photo.length > 0) {
      const fileId = message.photo[message.photo.length - 1].file_id;
      const total = await addPhoto(env, chatId, fileId);
      const isLast = total >= MAX_CHART_PHOTOS;
      const text = isLast
        ? `✅ Foto ke-${total} diterima (batas maksimal ${MAX_CHART_PHOTOS} foto tercapai). Memulai analisis...`
        : chartPhotoReceivedText(total);
      const keyboard = isLast ? { inline_keyboard: [] } : chartPhotoKeyboard(total);

      const promptMsgId = await resolvePhotoPromptMsgId(env, chatId, text, keyboard);
      if (isLast) {
        // Kalau ternyata tetep gagal dapat message_id (edge case langka), minimal
        // beri tahu user lewat pesan baru supaya nggak diam saja.
        if (!promptMsgId) await sendMessage(env, chatId, text);
        await beginAnalysis(env, chatId, null);
      }
      return;
    }

    await sendMessage(
      env,
      chatId,
      "Mohon kirim <b>foto chart</b> (bukan teks). Ketik /batal untuk membatalkan."
    );
    return;
  }

  // --- Mode: sedang diproses AI, jangan ganggu ---
  if (mode === "processing") {
    await sendMessage(env, chatId, "⏳ Analisis sedang berjalan, mohon tunggu... (ketik /batal untuk membatalkan)");
    return;
  }

  // --- Default ---
  await sendMessage(env, chatId, "Ketik /start untuk membuka menu utama.");
}

async function handleCallbackQuery(env, callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;

  await answerCallbackQuery(env, callbackQuery.id);

  // --- Pilih mode trading (Scalping/Day Trade/Swing) ---
  if (data.startsWith("mode_")) {
    const tradeModeKey = data.replace("mode_", "");
    if (!VALID_TRADE_MODES.includes(tradeModeKey)) return;

    await setTradeMode(env, chatId, tradeModeKey);
    await setMode(env, chatId, "awaiting_symbol");
    await editMessageText(env, chatId, messageId, symbolPromptText(tradeModeKey), symbolPromptKeyboard());
    return;
  }

  // --- Pilih trade mode SETELAH tap tombol Strategi 1/2 di keyboard
  // permanen (lihat "choosing_auto_trademode_s1/s2" di handleMessage).
  // callback_data generik (auto_scalping dst) -- strategi mana yang
  // dimaksud dibaca dari state `mode` sesi saat ini, BUKAN dari
  // callback_data itu sendiri, supaya tidak perlu 6 variasi tombol.
  if (data === "auto_scalping" || data === "auto_daytrade" || data === "auto_swing") {
    const tradeMode = data.replace("auto_", "");
    const currentMode = await getMode(env, chatId);
    if (currentMode !== "choosing_auto_trademode_s1" && currentMode !== "choosing_auto_trademode_s2") return; // tombol basi

    const strategy = currentMode === "choosing_auto_trademode_s2" ? "s2" : "s1";
    await setMode(env, chatId, "idle");

    // Strategi 1 = "lengkap" (10 AI, analisa menyeluruh, cocok
    // daytrade/swing). Strategi 2 = "fiboqm" (6 AI, fokus Fibonacci
    // Retracement + pola Quasimodo sebagai dasar utama entry -- filter
    // presisi, level entry dari struktur harga bukan cuma indikator biasa),
    // ditunjang Trend/Momentum/Volume/Risk Management. Eksekusi & risk
    // management-nya (1 posisi/waktu, native SL/TP, lot % risiko, circuit
    // breaker harian) SAMA PERSIS buat keduanya -- bedanya cuma dasar
    // analisa buat nentuin entry-nya.
    const aiMode = strategy === "s2" ? "fiboqm" : "lengkap";
    await startAutoSignal(env, chatId, { symbol: "XAUUSD", tradeMode, aiMode, strategy });

    const modeLabel = TRADE_MODES[tradeMode]?.label || tradeMode;
    const text =
      strategy === "s2"
        ? `🎯 <b>Strategi 2 AKTIF</b> — XAUUSD, mode ${escapeHtml(modeLabel)}, 6 AI (Fibo & QM — entry presisi)\n\nEntry ditentukan dari level Fibonacci Retracement (arah otomatis) & pola Quasimodo sebagai dasar utama, ditunjang Trend/Momentum/Volume/Risk Management. 1 posisi dalam satu waktu, native SL/TP dari AI Penyimpul, lot dihitung otomatis (risiko ≈1% balance ke SL). Force-close tambahan di floating +2%/-1% balance.\n\n⚠️ Limit trade/hari & circuit breaker rugi harian SEMENTARA DIMATIKAN (mode testing win-rate) — trading bisa jalan terus tanpa batas harian sampai kamu stop manual.\n\n<i>Filosofinya: satu pendekatan sederhana yang sama, dipakai konsisten tiap kali, dengan risk management yang ketat — bedanya cuma level entry-nya lebih presisi dari struktur harga.</i>\n\nKetik /stop_auto atau tap "⏹️ Stop Auto" buat berhenti kapan aja.`
        : `🧭 <b>Strategi 1 AKTIF</b> — XAUUSD, mode ${escapeHtml(modeLabel)}, 10 AI (analisa menyeluruh)\n\n1 posisi, native SL/TP dari AI Penyimpul, lot dihitung otomatis (risiko ≈1% balance ke SL). Force-close tambahan di floating +2%/-1% balance.\n\nKetik /stop_auto atau tap "⏹️ Stop Auto" buat berhenti kapan aja.`;
    await editMessageText(env, chatId, messageId, text);
    return;
  }

  // --- Tombol pintasan simbol (saat ini cuma XAUUSD/MT5) ---
  if (data.startsWith("symbol_")) {
    const currentMode = await getMode(env, chatId);
    if (currentMode !== "awaiting_symbol") return; // tombol basi

    const symbol = normalizeSymbol(data.replace("symbol_", ""));
    await setSymbol(env, chatId, symbol);
    await setMode(env, chatId, "choosing_ai_mode");
    await editMessageText(env, chatId, messageId, aiModePromptText(symbol), aiModeKeyboard());
    return;
  }

  // --- Pilih mode analisis: Cepat vs Lengkap vs Fibo & QM ---
  if (data === "ai_mode_cepat" || data === "ai_mode_lengkap" || data === "ai_mode_fiboqm") {
    const aiMode = data === "ai_mode_cepat" ? "cepat" : data === "ai_mode_lengkap" ? "lengkap" : "fiboqm";
    await setAiMode(env, chatId, aiMode);

    // Semua mode (Cepat, Lengkap, Fibo & QM) sekarang murni berbasis data
    // numerik — tidak ada AI yang butuh foto chart lagi (AI 7 Price Action
    // sudah diganti jadi analisa OHLC mentah, bukan analisa gambar), jadi
    // semua mode langsung mulai analisa tanpa perlu nunggu foto dari user.
    await editMessageText(env, chatId, messageId, "⏳ Mengambil data pasar & memulai analisis...");
    await beginAnalysis(env, chatId, messageId, null);
    return;
  }

  // --- Tombol "Analisa Sekarang" (dari alur kirim foto chart mode Lengkap) ---
  if (data === "analyze_now") {
    const currentMode = await getMode(env, chatId);
    if (currentMode !== "awaiting_chart") return; // tombol basi (sudah diproses/dibatalkan)

    const total = await countPhotos(env, chatId);
    if (total === 0) {
      await editMessageText(
        env,
        chatId,
        messageId,
        "⚠️ Belum ada foto yang dikirim. Kirim minimal 1 foto chart dulu, baru tekan tombol ini.",
        chartPhotoKeyboard(0)
      );
      return;
    }

    await editMessageText(env, chatId, messageId, `⏳ Mengambil data pasar & memulai analisis dengan ${total} foto...`);
    await beginAnalysis(env, chatId, messageId);
    return;
  }

  // --- Tombol "Tandai Hasil" di pesan sinyal (TP kena / SL kena) ---
  if (data.startsWith("mark_win_") || data.startsWith("mark_loss_")) {
    const isWin = data.startsWith("mark_win_");
    const signalId = data.replace(isWin ? "mark_win_" : "mark_loss_", "");
    const result = await markSignalResult(env, signalId, isWin ? "win" : "loss");

    if (!result.ok) {
      // Sinyal ini entah kenapa tidak ketemu di riwayat (harusnya jarang terjadi)
      await editMessageReplyMarkup(env, chatId, messageId, mainMenuKeyboard());
      return;
    }

    // Lepas tombol "Tandai Hasil" dari pesan itu (sudah ditandai, tidak boleh
    // ditandai dua kali) — sisain menu utama biasa aja.
    await editMessageReplyMarkup(env, chatId, messageId, mainMenuKeyboard());
    await sendMessage(
      env,
      chatId,
      isWin
        ? "✅ Dicatat sebagai <b>Menang (TP)</b>. Makasih udah nandain, ini yang bikin data Riwayat & Akurasi jadi jujur 👍"
        : "❌ Dicatat sebagai <b>Kalah (SL)</b>. Wajar, nggak semua sinyal akan tembus — yang penting risk management-nya udah dijaga."
    );
    return;
  }

  switch (data) {
    case "menu_riwayat": {
      const entries = await listSignals(env, chatId);
      const stats = summarizeSignalStats(entries);
      await editMessageText(env, chatId, messageId, riwayatStatsText(stats), backOnlyKeyboard("back_main"));
      return;
    }

    case "menu_news":
      await editMessageText(env, chatId, messageId, NEWS_MENU_TEXT, newsMenuKeyboard());
      return;

    case "back_main": {
      const oldPhotoPromptMsgId = await resetSession(env, chatId);
      if (oldPhotoPromptMsgId && oldPhotoPromptMsgId !== messageId) {
        await editMessageReplyMarkup(env, chatId, oldPhotoPromptMsgId);
      }
      await editMessageText(env, chatId, messageId, MAIN_MENU_TEXT, mainMenuKeyboard());
      return;
    }

    case "menu_signal":
      await editMessageText(env, chatId, messageId, TRADE_MODE_SELECT_TEXT, tradeModeKeyboard());
      return;

    case "news_segera": {
      await editMessageText(env, chatId, messageId, formatUpcomingAllText(), backOnlyKeyboard("menu_news"));
      return;
    }

    case "news_fomc":
    case "news_nfp":
    case "news_ppi":
    case "news_cpi": {
      const key = data.replace("news_", "");
      const label = NEWS_ITEM_LABELS[data];
      await editMessageText(
        env,
        chatId,
        messageId,
        formatNewsScheduleText(key, label),
        backOnlyKeyboard("menu_news")
      );
      return;
    }

    default:
      await editMessageText(env, chatId, messageId, MAIN_MENU_TEXT, mainMenuKeyboard());
  }
}

/**
 * Ambil data pasar (candle + indikator + SMC + pivot + makro) lalu mulai
 * proses multi-AI (dijalankan lewat Durable Object Alarm).
 * Dipanggil baik dari mode Cepat (langsung setelah pilih mode analisis)
 * maupun mode Lengkap (setelah foto chart diterima).
 *
 * @param {number|null} callbackMessageId - message_id dari pesan yang mau di-edit
 *   (kalau dipicu dari callback query). Kalau null, kirim pesan baru dulu.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pastikan cuma ADA SATU pesan "Foto ke-N diterima" per sesi, walau beberapa
 * foto masuk hampir bersamaan (misal dikirim sebagai album). Pakai pola claim:
 * - Kalau BELUM ada pesan sama sekali -> caller ini "menang", kirim pesan baru,
 *   simpan message_id-nya, return id itu.
 * - Kalau SUDAH ada -> langsung edit pesan itu, return id-nya.
 * - Kalau lagi "PENDING" (request LAIN yang hampir bersamaan sedang dalam
 *   proses kirim pesan baru) -> tunggu sebentar (polling), lalu coba lagi,
 *   sampai id-nya siap dipakai buat edit.
 */
async function resolvePhotoPromptMsgId(env, chatId, text, keyboard) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const claim = await claimPhotoPromptMsgId(env, chatId);

    if (claim.status === "ready") {
      await editMessageText(env, chatId, claim.messageId, text, keyboard);
      return claim.messageId;
    }

    if (claim.status === "claim") {
      const sent = await sendMessage(env, chatId, text, keyboard);
      const newMsgId = sent?.result?.message_id;
      if (newMsgId) {
        await setPhotoPromptMsgId(env, chatId, newMsgId);
        return newMsgId;
      }
      // Kalau sendMessage entah kenapa gagal dapat message_id, lepas klaimnya
      // (set ke null lagi) supaya tidak nyangkut "PENDING" selamanya.
      await setPhotoPromptMsgId(env, chatId, null);
      return null;
    }

    // status === "pending" -> foto lain lagi diproses duluan, tunggu sebentar
    await sleep(150);
  }
  return null; // fallback langka: nyerah nunggu, biarkan router yang manggil menangani
}

async function beginAnalysis(env, chatId, callbackMessageId) {
  const symbol = await getSymbol(env, chatId);
  const tradeMode = await getTradeMode(env, chatId);

  let messageId = callbackMessageId;
  if (!messageId) {
    const sent = await sendMessage(env, chatId, "⏳ Mengambil data pasar & memulai analisis...");
    messageId = sent?.result?.message_id;
  }

  try {
    const dataPackage = await buildMarketDataPackage(env, symbol, tradeMode);
    await startAnalysis(env, chatId, messageId, dataPackage);
  } catch (err) {
    console.error("Gagal ambil data pasar:", err);
    await editMessageText(
      env,
      chatId,
      messageId,
      `⚠️ Gagal ambil data pasar untuk <b>${escapeHtml(symbol)}</b>:\n${escapeHtml(err.message)}\n\nPastikan simbol benar (contoh: BTCUSDT) dan coba lagi lewat /start.`,
      mainMenuKeyboard()
    );
    const oldPhotoPromptMsgId = await resetSession(env, chatId);
    if (oldPhotoPromptMsgId && oldPhotoPromptMsgId !== messageId) {
      await editMessageReplyMarkup(env, chatId, oldPhotoPromptMsgId);
    }
  }
}
