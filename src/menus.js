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
    ],
  };
}

// --- Jadwal News ---
export const NEWS_MENU_TEXT = `📅 <b>Jadwal News</b>

Pilih kalender ekonomi yang ingin dilihat:`;

export function newsMenuKeyboard() {
  return {
    inline_keyboard: [
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

export function signalTradePrompt(tradeModeKey) {
  const mode = TRADE_MODES[tradeModeKey];
  return `📈 <b>Signal Trade — ${mode.label}</b>

Timeframe disarankan: <b>${mode.tfHint}</b>

Kirim <b>foto chart</b> sesuai timeframe di atas (boleh lebih dari 1 foto, kirim satu per satu, maksimal 5 foto karena batas dari AI vision-nya).

Setelah semua foto terkirim, ketik /selesai untuk lanjut.
Ketik /batal untuk membatalkan.`;
}

// --- Pilih jumlah AI analisa ---
export const AI_COUNT_PROMPT_TEXT = `📥 Foto chart diterima.

Pilih jumlah AI yang akan menganalisa chart kamu. Tiap AI akan kasih opini terpisah (loading satu-satu), lalu 1 <b>AI Penyimpul</b> merangkum semuanya jadi 1 sinyal final:`;

export function aiCountKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🤖 5 AI", callback_data: "ai_count_5" },
        { text: "🤖 10 AI", callback_data: "ai_count_10" },
      ],
    ],
  };
}
