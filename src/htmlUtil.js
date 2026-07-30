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

/**
 * Escape teks lalu ubah gaya Markdown umum (**bold**, __bold__, *italic*,
 * _italic_) jadi tag HTML asli yang dimengerti Telegram (<b>, <i>).
 *
 * KENAPA INI PERLU: model AI (Groq) sering menulis jawaban pakai gaya
 * Markdown ("**Keputusan:**") walau prompt sudah minta format tertentu.
 * Karena bot ini kirim pesan dengan parse_mode: "HTML", Telegram TIDAK
 * mengenali sintaks Markdown itu — hasilnya tanda bintang muncul mentah
 * di chat, bukan jadi tebal. Fungsi ini menerjemahkan gaya Markdown yang
 * paling umum dipakai model ke tag HTML yang benar-benar didukung Telegram.
 *
 * Escape HTML dilakukan LEBIH DULU (supaya teks asli dari AI tetap aman),
 * baru replace pola Markdown-nya — jadi tag <b>/<i> yang dihasilkan di sini
 * dijamin valid, tidak ikut ter-escape.
 */
export function formatTelegramHtml(str) {
  const escaped = escapeHtml(str);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/__(.+?)__/g, "<b>$1</b>")
    .replace(/(?<![*_])\*([^*\n]+?)\*(?![*_])/g, "<i>$1</i>")
    .replace(/(?<![*_])_([^_\n]+?)_(?![*_])/g, "<i>$1</i>");
}
