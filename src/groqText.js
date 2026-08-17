/**
 * Modul pemanggilan Groq untuk AI spesialis yang bekerja dari DATA JSON
 * (bukan foto) — dipakai oleh 9 dari 10 AI spesialis (semua kecuali AI
 * Price Action yang baca foto lewat groqVision.js).
 *
 * Alasan pakai data JSON, bukan foto, untuk AI-AI ini: akurasi absolut
 * (AI baca angka RSI=72.5 persis, bukan menebak dari gambar), lebih murah
 * & cepat (teks jauh lebih ringan dari gambar beresolusi tinggi).
 */
import { callGroqChatCompletion, getAnalystApiKey, dedicatedKeyLabel } from "./groqClient.js";

const DEFAULT_TEXT_MODEL = "openai/gpt-oss-120b";

/**
 * @param {object} env - Cloudflare env (secrets & vars)
 * @param {number} analystNumber - nomor AI (dipakai untuk pilih API key khusus)
 * @param {string} systemPrompt - system prompt spesifik peran AI ini
 * @param {object} dataSlice - potongan data JSON relevan untuk peran AI ini
 * @param {string} roleLabel - label untuk pesan error/log, misal "AI 1 - Trend"
 */
export async function analyzeWithGroqText(env, analystNumber, systemPrompt, dataSlice, roleLabel) {
  const model = env.GROQ_TEXT_MODEL || DEFAULT_TEXT_MODEL;
  const apiKey = getAnalystApiKey(env, analystNumber);

  const userContent = `Data pasar (JSON):\n${JSON.stringify(dataSlice, null, 2)}`;

  return callGroqChatCompletion(
    apiKey,
    {
      model,
      temperature: 0.4,
      max_tokens: 400,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    },
    `${roleLabel} (key: ${dedicatedKeyLabel(env, analystNumber)})`
  );
}
