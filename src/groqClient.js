/**
 * Modul bersama untuk memanggil Groq Chat Completion API.
 * Dipakai oleh groqVision.js (AI Price Action via foto) dan groqText.js
 * (9 AI spesialis lain via data JSON) supaya logic retry & pemilihan
 * API key tidak duplikat di 2 tempat.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ambil API key khusus untuk 1 nomor AI (analyst 1-10, atau "summarizer").
 * Urutan prioritas: GROQ_API_KEY_<n> (key khusus AI ke-n) -> GROQ_API_KEY (fallback bersama).
 * Tujuannya: tiap AI pakai akun/kuota Groq sendiri-sendiri supaya tidak
 * saling kena rate limit (429 Too Many Requests) saat dipanggil berurutan.
 */
export function getAnalystApiKey(env, analystNumber) {
  const dedicatedKey = env[`GROQ_API_KEY_${analystNumber}`];
  return dedicatedKey || env.GROQ_API_KEY;
}

/** Label untuk pesan error: biar kelihatan key khusus atau fallback yang dipakai */
export function dedicatedKeyLabel(env, analystNumber) {
  return env[`GROQ_API_KEY_${analystNumber}`]
    ? `GROQ_API_KEY_${analystNumber}`
    : "GROQ_API_KEY (fallback)";
}

/**
 * Panggil Groq chat completion, dengan retry otomatis kalau kena rate limit (429).
 * Groq biasanya kasih header "retry-after" (detik) yang bilang berapa lama harus
 * nunggu sebelum boleh coba lagi — kita ikuti angka itu persis, bukan tebak-tebakan.
 */
export async function callGroqChatCompletion(apiKey, body, label) {
  if (!apiKey) {
    throw new Error(`${label}: tidak ada API key yang tersedia (cek secret GROQ_API_KEY / GROQ_API_KEY_<n>).`);
  }

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
