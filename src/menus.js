/**
 * Definisi seluruh menu (inline keyboard) bot.
 * Terpusat di satu file supaya gampang ditambah/diubah nanti.
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

export function backOnlyKeyboard(target = "menu_news") {
  return {
    inline_keyboard: [[{ text: "⬅️ Kembali", callback_data: target }]],
  };
}

export const NEWS_ITEM_LABELS = {
  news_fomc: "FOMC (Federal Open Market Committee)",
  news_nfp: "NFP (Non-Farm Payroll)",
  news_ppi: "PPI (Producer Price Index)",
  news_cpi: "CPI (Consumer Price Index)",
};

export const SIGNAL_TRADE_PROMPT = `📈 <b>Signal Trade</b>

Kirim <b>foto chart</b> yang ingin dianalisis.

Untuk hasil lebih akurat, kirim beberapa foto dari <b>timeframe berbeda</b> (misal: 15m, 1H, 4H) satu per satu.

Setelah semua foto terkirim, ketik /selesai untuk memproses.
Ketik /batal untuk membatalkan.`;
