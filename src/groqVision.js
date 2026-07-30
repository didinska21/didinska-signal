/**
 * Modul analisis chart pakai Groq Vision (multi-AI + AI Penyimpul).
 *
 * CATATAN MODEL: Groq cukup sering ganti/deprecate model. Kalau suatu saat
 * dapat error soal model tidak ditemukan/deprecated, cek daftar model
 * vision terbaru di https://console.groq.com/docs/vision dan ganti nilai
 * default di bawah, atau isi env var GROQ_VISION_MODEL / GROQ_SUMMARY_MODEL
 * tanpa perlu ubah kode.
 */
import { getFile } from "./telegram.js";

const DEFAULT_VISION_MODEL = "qwen/qwen3.6-27b";
const DEFAULT_SUMMARY_MODEL = "openai/gpt-oss-120b";

// Tiap "AI analyst" dikasih sudut pandang beda, biar hasilnya bervariasi
// walau modelnya sama — bukan cuma pengulangan pertanyaan yang identik.
const ANALYST_PERSONAS = [
  "fokus pada price action dan struktur candlestick",
  "fokus pada indikator momentum (RSI, MACD)",
  "fokus pada volume dan order flow",
  "fokus pada level support/resistance & psikologis",
  "fokus pada moving average dan arah trend",
];

/** Jeda (ms) */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Panggil Groq chat completion, dengan retry otomatis kalau kena rate limit (429).
 * Groq biasanya kasih header "retry-after" (detik) yang bilang berapa lama harus
 * nunggu sebelum boleh coba lagi — kita ikuti angka itu persis, bukan tebak-tebakan.
 */
async function callGroqChatCompletion(apiKey, body, label) {
  const MAX_RETRIES = 3;
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.choices[0].message.content;

      if (!content || !content.trim()) {
        // Khusus model reasoning (gpt-oss dkk): kadang semua token abis buat "mikir",
        // hasil akhirnya jadi kosong. Ini bukan error jaringan, jadi kasih pesan yang jelas.
        throw new Error(
          `${label}: model mengembalikan jawaban kosong (kemungkinan token habis untuk reasoning). Coba naikkan max_tokens atau turunkan reasoning_effort.`
        );
      }

      return content;
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfterHeader = res.headers.get("retry-after");
      const waitSeconds = retryAfterHeader ? parseFloat(retryAfterHeader) : (attempt + 1) * 5;
      console.warn(`${label}: kena rate limit (429), tunggu ${waitSeconds}s lalu coba lagi (percobaan ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(waitSeconds * 1000);
      continue;
    }

    const errText = await res.text();
    lastError = new Error(`${label}: ${res.status} - ${errText}`);
    if (res.status !== 429) throw lastError; // error selain rate limit, jangan diulang
  }

  throw lastError || new Error(`${label}: gagal setelah beberapa percobaan (rate limit terus-terusan)`);
}

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
  const limited = fileIds.slice(0, 5); // Groq membatasi maks 5 gambar per request
  const urls = [];
  for (const fileId of limited) {
    const buffer = await getFile(env, fileId);
    urls.push(`data:image/jpeg;base64,${arrayBufferToBase64(buffer)}`);
  }
  return urls;
}

/**
 * Ambil API key khusus untuk 1 nomor AI analyst.
 * Urutan prioritas: GROQ_API_KEY<n> (key khusus AI ke-n) -> GROQ_API_KEY (fallback bersama).
 * Tujuannya: tiap AI analyst pakai akun/kuota Groq sendiri-sendiri supaya tidak
 * saling kena rate limit (429 Too Many Requests) saat dipanggil berurutan.
 */
function getAnalystApiKey(env, analystNumber) {
  const dedicatedKey = env[`GROQ_API_KEY${analystNumber}`];
  return dedicatedKey || env.GROQ_API_KEY;
}

/** Label untuk pesan error: biar kelihatan key khusus atau fallback yang dipakai */
function dedicatedKeyLabel(env, analystNumber) {
  return env[`GROQ_API_KEY${analystNumber}`]
    ? `GROQ_API_KEY${analystNumber}`
    : "GROQ_API_KEY (fallback)";
}

/** 1 "AI analyst" menganalisa chart, kembalikan opini singkat (teks) */
export async function analyzeChartImages(env, fileIds, tradeMode, analystNumber) {
  const dataUrls = await telegramPhotosToDataUrls(env, fileIds);
  const persona = ANALYST_PERSONAS[(analystNumber - 1) % ANALYST_PERSONAS.length];
  const model = env.GROQ_VISION_MODEL || DEFAULT_VISION_MODEL;
  const apiKey = getAnalystApiKey(env, analystNumber);

  if (!apiKey) {
    throw new Error(
      `Tidak ada API key untuk AI ${analystNumber}. Set secret GROQ_API_KEY${analystNumber} atau GROQ_API_KEY.`
    );
  }

  const systemPrompt = `Anda adalah analis teknikal futures AI ke-${analystNumber}, dengan gaya analisis ${persona}.
Mode trading yang dipakai user: ${tradeMode}.
Analisa gambar chart yang diberikan (bisa lebih dari 1 timeframe).
Beri opini SINGKAT (maksimal 5 kalimat): bias arah, level kunci yang kelihatan di chart, dan area entry potensial.
Bahasa Indonesia, langsung ke inti, tanpa basa-basi.`;

  const content = [
    { type: "text", text: "Analisa chart berikut:" },
    ...dataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];

  return callGroqChatCompletion(
    apiKey,
    {
      model,
      temperature: 0.6,
      max_tokens: 400,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
    },
    `Groq Vision (AI ${analystNumber}, key: ${dedicatedKeyLabel(env, analystNumber)})`
  );
}

/**
 * AI Penyimpul: baca semua opini dari AI analyst sebelumnya, hasilkan 1 sinyal final.
 * Pakai API key TERPISAH (GROQ_SUMMARIZER_API_KEY) kalau di-set, supaya bisa
 * pakai akun/kuota Groq yang beda khusus untuk tahap ini. Kalau tidak di-set,
 * fallback pakai GROQ_API_KEY yang sama seperti AI analyst.
 */
export async function summarizeSignals(env, opinions, tradeMode) {
  const apiKey = env.GROQ_SUMMARIZER_API_KEY || env.GROQ_API_KEY;
  const model = env.GROQ_SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL;

  const systemPrompt = `Anda adalah analis teknikal dan ahli perdagangan futures profesional yang bertugas SEBAGAI PENYIMPUL.
Anda menerima ${opinions.length} opini dari AI analyst lain (bisa jadi ada yang berbeda pendapat).
Tugas Anda: simpulkan jadi SATU sinyal final yang paling masuk akal. Mode trading: ${tradeMode}.

Gunakan bahasa Indonesia yang profesional, ringkas, dan langsung pada intinya.

Format WAJIB jawaban (gunakan struktur ini persis):
📊 Bias Arah: (Bullish / Bearish / Netral)
📍 Level Kunci: (Support & Resistance utama)
🎯 Skenario Entry: (area Long/Short)
🛡️ Manajemen Risiko: (Stop-Loss & Take-Profit yang logis)

Akhiri dengan satu kalimat: sebutkan ini hasil gabungan ${opinions.length} AI, berdasarkan probabilitas matematis, dan risiko sepenuhnya ditanggung trader.`;

  const opinionsText = opinions.map((op, i) => `Opini AI ${i + 1}:\n${op}`).join("\n\n");

  return callGroqChatCompletion(
    apiKey,
    {
      model,
      temperature: 0.3,
      max_tokens: 1200, // dinaikin dari 600 -> gpt-oss-120b "mikir" dulu (reasoning tokens)
      reasoning_effort: "low", // biar reasoning-nya nggak makan banyak jatah token, sisa buat jawaban akhir
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: opinionsText },
      ],
    },
    "Groq Summarizer"
  );
}
