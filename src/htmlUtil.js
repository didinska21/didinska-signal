/**
 * Utility kecil untuk escape teks sebelum dikirim ke Telegram dengan
 * parse_mode: "HTML". Dipakai untuk teks apa pun yang BUKAN literal yang
 * kita tulis sendiri di kode — misal opini AI, ringkasan akhir AI Penyimpul,
 * atau pesan error dari API luar (Binance/Bybit/Groq) — karena semuanya
 * bisa saja mengandung karakter "<", ">", atau "&" yang membuat Telegram
 * menolak seluruh pesan kalau tidak di-escape.
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
