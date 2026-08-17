/**
 * Modul analisis chart pakai Groq Vision — khusus dipakai untuk AI "Price
 * Action" (baca pola candlestick dari gambar), dan untuk AI Penyimpul
 * (rangkum semua opini AI spesialis jadi 1 sinyal final).
 *
 * CATATAN MODEL: Groq cukup sering ganti/deprecate model. Kalau suatu saat
 * dapat error soal model tidak ditemukan/deprecated, cek daftar model
 * vision terbaru di https://console.groq.com/docs/vision dan ganti nilai
 * default di bawah, atau isi env var GROQ_VISION_MODEL / GROQ_SUMMARY_MODEL
 * tanpa perlu ubah kode.
 */
import { getFile } from "./telegram.js";
import { callGroqChatCompletion, getAnalystApiKey, dedicatedKeyLabel } from "./groqClient.js";

const DEFAULT_VISION_MODEL = "qwen/qwen3.6-27b";
const DEFAULT_SUMMARY_MODEL = "openai/gpt-oss-120b";

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function telegramPhotosToDataUrls(env, fileIds) {
  const limited = fileIds.slice(0, 3); // model Groq Vision (qwen3.6-27b) cuma support maks 3 gambar per request
  const urls = [];
  for (const fileId of limited) {
    const buffer = await getFile(env, fileId);
    urls.push(`data:image/jpeg;base64,${arrayBufferToBase64(buffer)}`);
  }
  return urls;
}

/**
 * AI "Price Action": baca chart dari foto, fokus pola candlestick & struktur
 * harga yang sulit direpresentasikan hanya lewat angka (Head & Shoulders,
 * Flag, Engulfing, Pin Bar, dll).
 */
export async function analyzeChartImages(env, fileIds, tradeMode, analystNumber, symbol) {
  const dataUrls = await telegramPhotosToDataUrls(env, fileIds);
  const model = env.GROQ_VISION_MODEL || DEFAULT_VISION_MODEL;
  const apiKey = getAnalystApiKey(env, analystNumber);

  const systemPrompt = `Anda adalah AI spesialis Price Action & pola candlestick untuk trading futures ${symbol || ""}.
Mode trading yang dipakai user: ${tradeMode}.
Analisa gambar chart yang diberikan. Fokus HANYA pada:
- Pola candlestick (Engulfing, Pin Bar, Doji, dll)
- Pola chart klasik (Head & Shoulders, Flag, Triangle, dll) kalau terlihat
- Struktur price action (higher high/low, lower high/low)
Beri opini SINGKAT (maksimal 5 kalimat): bias arah, pola yang terdeteksi, dan area entry potensial berdasarkan pola tsb.
Bahasa Indonesia, langsung ke inti, tanpa basa-basi.
WAJIB akhiri jawaban Anda dengan baris baru PERSIS berformat: "Bias: Bullish" atau "Bias: Bearish" atau "Bias: Netral" (pilih satu, tanpa tambahan kata lain di baris itu — ini dipakai sistem untuk menghitung tally otomatis).`;

  const content = [
    { type: "text", text: "Analisa chart berikut:" },
    ...dataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];

  return callGroqChatCompletion(
    apiKey,
    {
      model,
      temperature: 0.6,
      max_tokens: 800,
      reasoning_effort: "low", // sama alasannya dengan groqText.js: jaga-jaga kalau model vision-nya juga model reasoning
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
    },
    `Groq Vision Price Action (AI ${analystNumber}, key: ${dedicatedKeyLabel(env, analystNumber)})`
  );
}

/**
 * AI Penyimpul: baca semua opini dari AI spesialis sebelumnya, hasilkan 1
 * keputusan final tegas (BUY/SELL/WAIT) beserta level & probabilitas.
 * Pakai API key TERPISAH (GROQ_SUMMARIZER_API_KEY) kalau di-set, supaya bisa
 * pakai akun/kuota Groq yang beda khusus untuk tahap ini. Kalau tidak di-set,
 * fallback pakai GROQ_API_KEY yang sama seperti AI analyst.
 *
 * @param {Array<{label: string, opinion: string}>} opinions - opini tiap AI spesialis, dengan label perannya
 * @param {string} [aiMode] - "cepat" | "lengkap" | "fiboqm". Kalau "fiboqm",
 *   prompt diberi instruksi bobot penimbangan KHUSUS (2 AI Fibo & QM jadi
 *   pertimbangan utama, sisanya cuma konfirmasi) — lihat FIBO_QM_WEIGHT_NOTE.
 */
const FIBO_QM_WEIGHT_NOTE = `

CATATAN KHUSUS MODE "FIBO & QM" — PENTING, BEDA DARI MODE BIASA:
Dari ${"{OPINION_COUNT}"} opini di atas, opini AI 1 (Spesialis Fibonacci Retracement) dan AI 2 (Spesialis Pola Quasimodo/QM) adalah PERTIMBANGAN UTAMA — dasar keputusan bias arah & level kunci HARUS mengacu ke temuan mereka berdua (level Fibonacci & neckline QM yang mereka sebutkan, dengan angka).
Opini AI 3-6 (Trend/Momentum/Volume/Risk Management) HANYA KONFIRMASI/PENDUKUNG — JANGAN samakan bobotnya dengan AI 1 & 2 walau tally bias di atas menghitung semuanya rata. Kalau AI 3-6 mayoritas BERTENTANGAN kuat dengan bias AI 1/2, sebutkan itu sebagai PERINGATAN RISIKO di jawaban Anda (bukan otomatis membalik keputusan).
📍 Level Kunci WAJIB mencantumkan level Fibonacci relevan (dengan rasio & angka harga, misal "Fibo 0.618 di 64109") dan level QM/neckline (kalau ada polanya, dengan angka harga) — bukan cuma support/resistance historis biasa.`;

export async function summarizeSignals(env, opinions, tradeMode, symbol, biasTally, aiMode) {
  const apiKey = env.GROQ_SUMMARIZER_API_KEY || env.GROQ_API_KEY;
  const model = env.GROQ_SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL;

  const tallyLine = biasTally
    ? `${biasTally.bullish} Bullish, ${biasTally.bearish} Bearish, ${biasTally.netral} Netral`
    : null;

  const isFiboQm = aiMode === "fiboqm";

  const systemPrompt = `Anda adalah analis teknikal dan ahli perdagangan futures profesional yang bertugas SEBAGAI HAKIM/PENYIMPUL.
Anda menerima TEPAT ${opinions.length} opini dari AI spesialis lain${isFiboQm ? ", fokus mode analisis \"Fibo & QM\" (Fibonacci Retracement & pola Quasimodo sebagai pertimbangan utama, sisanya konfirmasi)" : ", masing-masing fokus di dimensi berbeda (trend, momentum, volatilitas, volume, support/resistance, smart money concept, price action, multi-timeframe, konteks makro, risk management)"}. Bisa jadi ada yang berbeda pendapat.
${tallyLine ? `\nTally bias SUDAH DIHITUNG OTOMATIS OLEH SISTEM dari ${opinions.length} opini di atas (bukan tugas Anda menghitung ulang): ${tallyLine}. ${isFiboQm ? "Tally ini menghitung SEMUA opini secara RATA — perlakukan sebagai info tambahan saja, BUKAN acuan bobot (lihat catatan khusus di bawah)." : "Pakai ini sebagai salah satu pertimbangan keputusan Anda."}\n` : ""}
Tugas Anda:
1. ${isFiboQm ? "Timbang temuan Fibonacci & QM sebagai dasar utama, lalu nilai apakah AI penunjang (trend/momentum/volume) mendukung atau memperingatkan." : "Timbang tally bias di atas, dan apakah indikator Volume mendukung indikator Trend."}
2. Simpulkan jadi SATU keputusan tegas. Simbol: ${symbol || "-"}. Mode trading: ${tradeMode}.

Gunakan bahasa Indonesia yang profesional, ringkas, dan langsung pada intinya.

Format WAJIB jawaban (gunakan struktur ini persis):
🎯 Keputusan: (BUY / SELL / WAIT)
📊 Bias Arah: (Bullish / Bearish / Netral)
📍 Level Kunci: (Support & Resistance utama)
🎯 Skenario Entry: (area Long/Short)
🛡️ Manajemen Risiko:
- Stop-Loss: (WAJIB tulis HARGA ABSOLUT dulu, persis setelah tanda titik dua, baru boleh tambah penjelasan setelahnya — misal "Stop-Loss: 63200 (≈1,5×ATR di atas entry)". JANGAN tulis jarak/poin duluan sebelum harga absolutnya.)
- Take-Profit: (format sama: HARGA ABSOLUT dulu, penjelasan setelahnya — misal "Take-Profit: 62600 (rasio Risk:Reward ≈1:2)")
📈 Probabilitas: (HANYA tulis perkiraan persentase keyakinan, misal "±65%" — JANGAN tulis rincian jumlah AI di baris ini, itu akan ditambahkan otomatis oleh sistem)

Akhiri dengan satu kalimat: sebutkan ini hasil gabungan ${opinions.length} AI spesialis, berdasarkan probabilitas matematis, dan risiko sepenuhnya ditanggung trader.${isFiboQm ? FIBO_QM_WEIGHT_NOTE.replace("{OPINION_COUNT}", String(opinions.length)) : ""}`;

  const opinionsText = opinions.map((op) => `${op.label}:\n${op.opinion}`).join("\n\n");

  return callGroqChatCompletion(
    apiKey,
    {
      model,
      temperature: 0.3,
      max_tokens: 1200, // gpt-oss-120b "mikir" dulu (reasoning tokens)
      reasoning_effort: "low", // biar reasoning-nya nggak makan banyak jatah token, sisa buat jawaban akhir
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: opinionsText },
      ],
    },
    "Groq Summarizer"
  );
}
