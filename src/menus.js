/**
 * Definisi seluruh menu (inline keyboard) bot.
 */

export const MAIN_MENU_TEXT = `👋 <b>Selamat datang di Didinska Signal Bot</b>

Pilih menu di bawah ini:`;

export function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📅 Jadwal News", callback_data: "menu_news" }],
      [{ text: "📈 Signal Trade", callback_data: "menu_signal" }],
      [{ text: "📊 Riwayat & Akurasi", callback_data: "menu_riwayat" }],
    ],
  };
}

/**
 * Keyboard yang ditempel di pesan hasil sinyal: tombol buat user nandain
 * sendiri hasil akhirnya (TP kena / SL kena), digabung sama menu utama
 * biasa. Ini yang jadi data dasar hitungan win-rate beneran di menu Riwayat.
 */
export function signalResultKeyboard(signalId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ TP Kena (Menang)", callback_data: `mark_win_${signalId}` },
        { text: "❌ SL Kena (Kalah)", callback_data: `mark_loss_${signalId}` },
      ],
      [{ text: "📅 Jadwal News", callback_data: "menu_news" }],
      [{ text: "📈 Signal Trade", callback_data: "menu_signal" }],
      [{ text: "📊 Riwayat & Akurasi", callback_data: "menu_riwayat" }],
    ],
  };
}

/** Teks ringkasan win-rate untuk menu "Riwayat & Akurasi", DIPECAH per
 * strategi (🧭 Strategi 1 auto, 🎯 Strategi 2 auto, ✋ manual) selain total
 * keseluruhan -- biar kelihatan mana yang win-rate-nya lebih bagus. */
export function riwayatStatsText({ overall, s1, s2, manual }) {
  if (overall.total === 0) {
    return `📊 <b>Riwayat & Akurasi</b>

Belum ada sinyal yang tercatat. Coba "Signal Trade" dulu (atau nyalain Strategi 1/2 lewat keyboard permanen) -- trade yang dieksekusi ke MT5 tercatat OTOMATIS begitu closed, atau bisa kamu tandai manual (TP/SL kena) lewat tombol di pesan sinyalnya. Dari situ baru kelihatan win-rate yang sebenarnya (bukan tebakan AI).`;
  }

  const section = (label, stats) => {
    if (stats.total === 0) return `${label}: belum ada data.`;
    const winRateLine =
      stats.winRatePct === null
        ? "belum ada yang ditandai/closed"
        : `<b>${stats.winRatePct}%</b> win-rate (${stats.win}W/${stats.loss}L dari ${stats.decided})`;
    return `${label}: ${stats.total} sinyal — ${winRateLine}${stats.open > 0 ? `, ${stats.open} belum ditandai` : ""}`;
  };

  const overallRate = overall.winRatePct === null ? "belum ada yang ditandai/closed" : `${overall.winRatePct}% win-rate (${overall.win}W/${overall.loss}L)`;

  return `📊 <b>Riwayat & Akurasi</b>

${section("🧭 Strategi 1", s1)}
${section("🎯 Strategi 2", s2)}
${section("✋ Manual", manual)}

<b>Total keseluruhan</b>: ${overall.total} sinyal — ${overallRate}

<i>Trade yang dieksekusi ke MT5 (native SL/TP, force-close, dst) tercatat OTOMATIS begitu closed. Sinyal manual yang cuma ditampilkan teksnya (tidak dieksekusi ke MT5) perlu kamu tandai sendiri lewat tombol TP/SL Kena di pesannya.</i>`;
}

// --- Jadwal News ---
export const NEWS_MENU_TEXT = `📅 <b>Jadwal News</b>

Pilih kalender ekonomi yang ingin dilihat:`;

export function newsMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "⏰ Segera Terjadi", callback_data: "news_segera" }],
      [
        { text: "FOMC", callback_data: "news_fomc" },
        { text: "NFP", callback_data: "news_nfp" },
      ],
      [
        { text: "PPI", callback_data: "news_ppi" },
        { text: "CPI", callback_data: "news_cpi" },
      ],
      [{ text: "⬅️ Kembali", callback_data: "back_main" }],
    ],
  };
}

export const NEWS_ITEM_LABELS = {
  news_fomc: "FOMC (Federal Open Market Committee)",
  news_nfp: "NFP (Non-Farm Payroll)",
  news_ppi: "PPI (Producer Price Index)",
  news_cpi: "CPI (Consumer Price Index)",
};

export function backOnlyKeyboard(target = "menu_news") {
  return {
    inline_keyboard: [[{ text: "⬅️ Kembali", callback_data: target }]],
  };
}

// --- Signal Trade: pilih mode trading dulu ---
export const TRADE_MODES = {
  scalping: { label: "⚡ Scalping", tfHint: "1m, 5m, 15m" },
  daytrade: { label: "📊 Day Trade", tfHint: "15m, 1H, 4H" },
  swing: { label: "📈 Swing", tfHint: "4H, 1D, 1W" },
};

export const TRADE_MODE_SELECT_TEXT = `📈 <b>Signal Trade</b>

Pilih mode trading:`;

export function tradeModeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: TRADE_MODES.scalping.label, callback_data: "mode_scalping" }],
      [{ text: TRADE_MODES.daytrade.label, callback_data: "mode_daytrade" }],
      [{ text: TRADE_MODES.swing.label, callback_data: "mode_swing" }],
      [{ text: "⬅️ Kembali", callback_data: "back_main" }],
    ],
  };
}

// --- Keyboard PERMANEN (ReplyKeyboardMarkup, nempel di atas kolom ketik,
// BEDA dari semua keyboard lain di file ini yang nempel per-pesan/inline)
// buat pilih Strategi 1 (10 AI, analisa menyeluruh) vs Strategi 2 (6 AI,
// fokus Fibonacci Retracement + pola Quasimodo untuk entry presisi).
// Eksekusi & risk management KEDUANYA SAMA
// PERSIS: 1 posisi dalam satu waktu, native SL/TP dari AI, lot dihitung
// otomatis dari % risiko, force-close tambahan di floating %, limit
// trade/hari & circuit breaker rugi harian. Keduanya SALING EKSKLUSIF —
// mulai salah satu otomatis mengganti siklus auto yang lain (lihat
// startAuto di session_do.js).
// Ditampilkan lewat sendMessage(..., strategyReplyKeyboard()), bukan
// editMessageReplyMarkup, karena ReplyKeyboardMarkup cuma bisa dikirim
// nempel ke pesan BARU, tidak bisa "ditempelkan" ke pesan lama.
export function strategyReplyKeyboard() {
  return {
    keyboard: [
      [{ text: "🧭 Strategi 1 (XAUUSD)" }, { text: "🎯 Strategi 2 (Pro)" }],
      [{ text: "⏹️ Stop Auto" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export const STRATEGY_KEYBOARD_INTRO_TEXT = `👇 Keyboard strategi XAUUSD nempel permanen di bawah kolom ketik.

Kedua strategi sekarang pakai risk management yang SAMA: 1 posisi dalam satu waktu, native SL/TP dari AI Penyimpul, lot otomatis dari % risiko balance, plus force-close tambahan di floating %, limit trade/hari, dan circuit breaker rugi harian. Bedanya cuma DASAR ANALISA buat nentuin entry-nya:

🧭 <b>Strategi 1</b> — 10 AI, analisa menyeluruh (trend, momentum, volume, SMC, price action, multi-timeframe, makro, dll).
🎯 <b>Strategi 2</b> — 6 AI, fokus Fibonacci Retracement & pola Quasimodo sebagai dasar utama entry (level presisi dari struktur harga), ditunjang Trend/Momentum/Volume/Risk Management.

Cuma 1 yang aktif dalam satu waktu — pilih salah satu tombol di bawah kapan aja buat mulai (otomatis gantiin yang lain kalau ada yang lagi jalan).`;

// --- Pilih mode trading (Scalping/Day Trade/Swing) KHUSUS setelah pilih
// Strategi 1/2 lewat keyboard permanen di atas. callback_data SENGAJA beda
// dari tradeModeKeyboard() punya "Signal Trade" manual (mode_...) supaya
// dua alur ini tidak pernah ketuker, meski keliatan mirip.
export function autoTradeModeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: TRADE_MODES.scalping.label, callback_data: "auto_scalping" }],
      [{ text: TRADE_MODES.daytrade.label, callback_data: "auto_daytrade" }],
      [{ text: TRADE_MODES.swing.label, callback_data: "auto_swing" }],
    ],
  };
}

// --- Input simbol/pair trading ---
export function symbolPromptText(tradeModeKey) {
  const mode = TRADE_MODES[tradeModeKey];
  return `📈 <b>Signal Trade — ${mode.label}</b>

Ketik simbol pair futures yang mau dianalisa, contoh: <b>BTCUSDT</b>, <b>ETHUSDT</b>, <b>SOLUSDT</b>.

Atau tekan tombol <b>XAUUSD</b> di bawah untuk pair Gold via MT5 (data & harga dari broker kamu sendiri, lihat README bagian MT5 Bridge).

(Data candle pair kripto diambil otomatis dari Binance Futures, fallback ke Bybit kalau gagal)
Ketik /batal untuk membatalkan.`;
}

export function symbolPromptKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🥇 XAUUSD (Gold/MT5)", callback_data: "symbol_XAUUSD" }],
      [{ text: "⬅️ Kembali", callback_data: "back_main" }],
    ],
  };
}

// --- Pilih mode analisis: Cepat (5 AI, data API) vs Lengkap (10 AI) vs Fibo & QM (6 AI) ---
export function aiModePromptText(symbol) {
  return `✅ Simbol <b>${symbol}</b> diterima.

Pilih mode analisis:
🚀 <b>Cepat</b> — 5 AI spesialis (Trend, Momentum, Volatilitas, Support/Resistance, Risk Management), berbasis data numerik.
🔬 <b>Lengkap</b> — 10 AI spesialis (termasuk Volume, Smart Money Concept, Price Action, Multi-Timeframe, & Konteks Makro), semua berbasis data numerik, tanpa perlu kirim foto.
🔢 <b>Fibo & QM</b> — 6 AI spesialis, fokus Fibonacci Retracement (arah otomatis) & pola Quasimodo sebagai pertimbangan utama, ditunjang Trend/Momentum/Volume/Risk Management.`;
}

export function aiModeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🚀 Cepat (5 AI)", callback_data: "ai_mode_cepat" },
        { text: "🔬 Lengkap (10 AI)", callback_data: "ai_mode_lengkap" },
      ],
      [{ text: "🔢 Fibo & QM (6 AI)", callback_data: "ai_mode_fiboqm" }],
    ],
  };
}

// --- Prompt kirim foto (hanya untuk mode Lengkap, khusus AI Price Action) ---
export const MAX_CHART_PHOTOS = 3; // model Groq Vision (qwen3.6-27b) cuma support maks 3 gambar per request

export function chartPhotoPromptText(tradeModeKey) {
  const mode = TRADE_MODES[tradeModeKey];
  return `📸 Kirim <b>foto chart</b> untuk AI Price Action (timeframe disarankan: <b>${mode.tfHint}</b>).

Bisa kirim <b>lebih dari 1 foto</b> (misal beda timeframe), maksimal ${MAX_CHART_PHOTOS}. Kirim satu-satu, lalu tekan tombol <b>Analisa Sekarang</b> kalau sudah selesai.

Ketik /batal untuk membatalkan.`;
}

// --- Konfirmasi tiap foto diterima, sambil kasih tombol buat mulai analisis ---
export function chartPhotoReceivedText(total) {
  return `✅ Foto ke-${total} diterima.

Kirim foto lagi kalau masih ada (maks ${MAX_CHART_PHOTOS}), atau tekan tombol di bawah untuk mulai analisis.`;
}

export function chartPhotoKeyboard(total) {
  return {
    inline_keyboard: [
      [{ text: `🔍 Analisa Sekarang (${total} foto)`, callback_data: "analyze_now" }],
      [{ text: "⬅️ Batal", callback_data: "back_main" }],
    ],
  };
}
