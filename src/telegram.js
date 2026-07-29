/**
 * Kirim pesan teks ke chat/channel Telegram melalui Bot API.
 */
export async function sendTelegramMessage(env, text) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Telegram API error: ${res.status} - ${errText}`);
  }

  return res.json();
}
