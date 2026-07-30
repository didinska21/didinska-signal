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
 * Urutan prioritas: GROQ_API_KEY_<n> (key khusus AI ke-n) -> GROQ_API_KEY (fallback bersama).
 * Tujuannya: tiap AI analyst pakai akun/kuota Groq sendiri-sendiri supaya tidak
 * saling kena rate limit (429 Too Many Requests) saat dipanggil berurutan.
 */
function getAnalystApiKey(env, analystNumber) {
  const dedicatedKey = env[`GROQ_API_KEY_${analystNumber}`];
  return dedicatedKey || env.GROQ_API_KEY;
}

/** Label untuk pesan error: biar kelihatan key khusus atau fallback yang dipakai */
function dedicatedKeyLabel(env, analystNumber) {
  return env[`GROQ_API_KEY_${analystNumber}`]
    ? `GROQ_API_KEY_${analystNumber}`
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
      `Tidak ada API key untuk AI ${analystNumber}. Set secret GROQ_API_KEY_${analystNumber} atau GROQ_API_KEY.`
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

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      max_tokens: 400,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Groq Vision error (AI ${analystNumber}, key: ${dedicatedKeyLabel(env, analystNumber)}): ${res.status} - ${errText}`
    );
  }

  const data = await res.json();
  return data.choices[0].message.content;
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

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: opinionsText },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq Summarizer error: ${res.status} - ${errText}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}
