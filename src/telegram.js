/**
 * Wrapper lengkap untuk Telegram Bot API — dipakai oleh bot interaktif (webhook).
 */

const API_BASE = (token) => `https://api.telegram.org/bot${token}`;

async function call(env, method, payload) {
  const res = await fetch(`${API_BASE(env.TELEGRAM_BOT_TOKEN)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Telegram API error (${method}): ${res.status} - ${errText}`);
  }

  return res.json();
}

/** Kirim pesan teks biasa, bisa dengan inline keyboard opsional */
export async function sendMessage(env, chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return call(env, "sendMessage", payload);
}

/** Edit pesan yang sudah ada (dipakai saat user klik tombol menu) */
export async function editMessageText(env, chatId, messageId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return call(env, "editMessageText", payload);
}

/** Wajib dipanggil setelah callback_query supaya tombol tidak "loading" terus di UI Telegram */
export async function answerCallbackQuery(env, callbackQueryId, text = "") {
  return call(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

/** Daftarkan URL webhook Worker ke Telegram (dipanggil manual sekali via browser, bukan dari kode) */
export async function setWebhook(env, url) {
  return call(env, "setWebhook", { url });
}
