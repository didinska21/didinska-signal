/**
 * Simpan/ambil session state per chat_id menggunakan Cloudflare KV.
 * Dibutuhkan karena Worker itu stateless — tanpa ini, bot tidak akan ingat
 * bahwa user sedang di tengah proses "kirim foto chart".
 *
 * Butuh binding KV bernama SESSIONS di wrangler.toml.
 */

const DEFAULT_SESSION = { mode: "idle", photos: [] };
const SESSION_TTL_SECONDS = 60 * 30; // sesi kadaluarsa otomatis setelah 30 menit idle

export async function getSession(env, chatId) {
  const raw = await env.SESSIONS.get(`session:${chatId}`);
  if (!raw) return { ...DEFAULT_SESSION };
  try {
    return JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SESSION };
  }
}

export async function setSession(env, chatId, session) {
  await env.SESSIONS.put(`session:${chatId}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

export async function resetSession(env, chatId) {
  await setSession(env, chatId, { ...DEFAULT_SESSION });
}
