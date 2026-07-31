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

/** Teks ringkasan win-rate untuk menu "Riwayat & Akurasi" */
export function riwayatStatsText(stats) {
  const { total, win, loss, open, winRatePct } = stats;

  if (total === 0) {
    return `📊 <b>Riwayat & Akurasi</b>

Belum ada sinyal yang tercatat. Coba "Signal Trade" dulu, nanti tiap hasil sinyal bisa kamu tandai (TP/SL kena) lewat tombol di pesannya — dari situ baru kelihatan win-rate yang sebenarnya (bukan tebakan AI).`;
  }

  const winRateLine =
    winRatePct === null
      ? "Belum ada yang ditandai hasilnya."
      : `<b>${winRatePct}%</b> (dari ${win + loss} sinyal yang sudah ditandai)`;

  return `📊 <b>Riwayat & Akurasi</b>

Total sinyal tercatat: <b>${total}</b>
✅ Menang (TP): ${win}
❌ Kalah (SL): ${loss}
⏳ Belum ditandai: ${open}

📈 Win-rate: ${winRateLine}

<i>Angka ini dari hasil yang KAMU tandai sendiri di tiap sinyal — bukan tebakan probabilitas dari AI. Makin rajin ditandai, makin akurat gambarannya.</i>`;
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

// --- Input simbol/pair trading ---
export function symbolPromptText(tradeModeKey) {
  const mode = TRADE_MODES[tradeModeKey];
  return `📈 <b>Signal Trade — ${mode.label}</b>

Ketik simbol pair futures yang mau dianalisa, contoh: <b>BTCUSDT</b>, <b>ETHUSDT</b>, <b>SOLUSDT</b>.

(Data candle diambil otomatis dari Binance Futures, fallback ke Bybit kalau gagal)
Ketik /batal untuk membatalkan.`;
}

// --- Pilih mode analisis: Cepat (5 AI, murni data API) vs Lengkap (10 AI + foto) ---
export function aiModePromptText(symbol) {
  return `✅ Simbol <b>${symbol}</b> diterima.

Pilih mode analisis:
🚀 <b>Cepat</b> — 5 AI spesialis (Trend, Momentum, Volatilitas, Support/Resistance, Risk Management), semua berbasis data numerik, tanpa perlu kirim foto.
🔬 <b>Lengkap</b> — 10 AI spesialis (termasuk Volume, Smart Money Concept, Price Action, Multi-Timeframe, & Konteks Makro). Perlu kirim 1 foto chart untuk AI Price Action.`;
}

export function aiModeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🚀 Cepat (5 AI)", callback_data: "ai_mode_cepat" },
        { text: "🔬 Lengkap (10 AI)", callback_data: "ai_mode_lengkap" },
      ],
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
