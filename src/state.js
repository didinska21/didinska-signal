/**
 * Simpan/ambil session state per chat_id menggunakan Cloudflare KV.
 *
 * PENTING soal desain penyimpanan foto:
 * Foto TIDAK disimpan sebagai satu array di dalam satu key (read-modify-write),
 * karena kalau user kirim beberapa foto dengan cepat, tiap foto diproses sebagai
 * request terpisah dan bisa saling menimpa (race condition) akibat KV yang
 * eventually-consistent. Sebagai gantinya, tiap foto disimpan sebagai KEY
 * TERPISAH yang unik, supaya penulisannya independen dan tidak saling tabrakan.
 */

const SESSION_TTL_SECONDS = 60 * 30; // 30 menit

// --- Mode (idle / awaiting_chart) ---
export async function getMode(env, chatId) {
  const mode = await env.SESSIONS.get(`mode:${chatId}`);
  return mode || "idle";
}

export async function setMode(env, chatId, mode) {
  await env.SESSIONS.put(`mode:${chatId}`, mode, { expirationTtl: SESSION_TTL_SECONDS });
}

// --- Foto chart (disimpan per-key, bukan array) ---
export async function addPhoto(env, chatId, fileId) {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await env.SESSIONS.put(`photo:${chatId}:${uniqueSuffix}`, fileId, {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

export async function listPhotos(env, chatId) {
  const { keys } = await env.SESSIONS.list({ prefix: `photo:${chatId}:` });
  const fileIds = await Promise.all(keys.map((k) => env.SESSIONS.get(k.name)));
  return fileIds.filter(Boolean);
}

export async function countPhotos(env, chatId) {
  const { keys } = await env.SESSIONS.list({ prefix: `photo:${chatId}:` });
  return keys.length;
}

export async function clearPhotos(env, chatId) {
  const { keys } = await env.SESSIONS.list({ prefix: `photo:${chatId}:` });
  await Promise.all(keys.map((k) => env.SESSIONS.delete(k.name)));
}

// --- Reset total (dipanggil saat /start, /batal, atau selesai proses) ---
export async function resetSession(env, chatId) {
  await setMode(env, chatId, "idle");
  await clearPhotos(env, chatId);
}
