import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  clearOldReplyKeyboard,
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
  aiModePromptText,
  aiModeKeyboard,
  chartPhotoPromptText,
  chartPhotoReceivedText,
  chartPhotoKeyboard,
  MAX_CHART_PHOTOS,
} from "../menus.js";
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
  resetSession,
  startAnalysis,
} from "../state.js";
import { buildMarketDataPackage, normalizeSymbol } from "../marketData.js";
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
    await resetSession(env, chatId);
    await clearOldReplyKeyboard(env, chatId);
    await sendMessage(env, chatId, MAIN_MENU_TEXT, mainMenuKeyboard());
    return;
  }

  if (text === "/batal") {
    await resetSession(env, chatId); // ini juga membatalkan proses AI kalau sedang berjalan
    await sendMessage(env, chatId, "❌ Dibatalkan. Kembali ke menu utama.", mainMenuKeyboard());
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

  // --- Mode: sedang menunggu foto chart (khusus mode Lengkap, untuk AI Price Action) ---
  // Bisa terima lebih dari 1 foto (misal beda timeframe). Foto ditampung dulu,
  // analisis baru dijalankan setelah user tekan tombol "Analisa Sekarang".
  if (mode === "awaiting_chart") {
    if (message.photo && message.photo.length > 0) {
      const fileId = message.photo[message.photo.length - 1].file_id;
      const total = await addPhoto(env, chatId, fileId);

      if (total >= MAX_CHART_PHOTOS) {
        await sendMessage(
          env,
          chatId,
          `✅ Foto ke-${total} diterima (batas maksimal ${MAX_CHART_PHOTOS} foto tercapai). Memulai analisis...`
        );
        await beginAnalysis(env, chatId, null);
        return;
      }

      await sendMessage(env, chatId, chartPhotoReceivedText(total), chartPhotoKeyboard(total));
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
    await editMessageText(env, chatId, messageId, symbolPromptText(tradeModeKey), backOnlyKeyboard("back_main"));
    return;
  }

  // --- Pilih mode analisis: Cepat vs Lengkap ---
  if (data === "ai_mode_cepat" || data === "ai_mode_lengkap") {
    const aiMode = data === "ai_mode_cepat" ? "cepat" : "lengkap";
    await setAiMode(env, chatId, aiMode);

    if (aiMode === "lengkap") {
      const tradeMode = await getTradeMode(env, chatId);
      await setMode(env, chatId, "awaiting_chart");
      await editMessageText(env, chatId, messageId, chartPhotoPromptText(tradeMode), backOnlyKeyboard("back_main"));
      return;
    }

    // Mode Cepat: langsung mulai, tidak perlu foto
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

  switch (data) {
    case "menu_news":
      await editMessageText(env, chatId, messageId, NEWS_MENU_TEXT, newsMenuKeyboard());
      return;

    case "back_main":
      await resetSession(env, chatId);
      await editMessageText(env, chatId, messageId, MAIN_MENU_TEXT, mainMenuKeyboard());
      return;

    case "menu_signal":
      await editMessageText(env, chatId, messageId, TRADE_MODE_SELECT_TEXT, tradeModeKeyboard());
      return;

    case "news_fomc":
    case "news_nfp":
    case "news_ppi":
    case "news_cpi": {
      const label = NEWS_ITEM_LABELS[data];
      await editMessageText(
        env,
        chatId,
        messageId,
        `📌 <b>${label}</b>\n\n⚙️ Fitur ini belum bisa digunakan, masih menunggu perbaikan.`,
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
async function beginAnalysis(env, chatId, callbackMessageId) {
  const symbol = await getSymbol(env, chatId);
  const tradeMode = await getTradeMode(env, chatId);

  let messageId = callbackMessageId;
  if (!messageId) {
    const sent = await sendMessage(env, chatId, "⏳ Mengambil data pasar & memulai analisis...");
    messageId = sent?.result?.message_id;
  }

  try {
    const dataPackage = await buildMarketDataPackage(symbol, tradeMode);
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
    await resetSession(env, chatId);
  }
}
