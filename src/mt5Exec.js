/**
 * Helper kecil untuk antre sinyal eksekusi ke Mt5BridgeDO (dipanggil dari
 * session_do.js setelah AI Penyimpul mengeluarkan keputusan BUY/SELL untuk
 * simbol yang datanya dari MT5, misal XAUUSD).
 * `strategy`: "s1" (default, native SL/TP dikirim) atau "s2" (market order
 * murni, sl/tp diabaikan bridge Python meski dikirim null).
 */
export async function enqueueMt5Execution(env, symbol, { signalId, chatId, decision, entry, sl, tp, lot, strategy = "s1" }) {
  const id = env.MT5_BRIDGE_DO.idFromName(symbol);
  const stub = env.MT5_BRIDGE_DO.get(id);

  const res = await stub.fetch("https://mt5-bridge/enqueueSignal", {
    method: "POST",
    body: JSON.stringify({ signalId, chatId, decision, entry, sl, tp, lot, symbol, strategy }),
  });

  if (!res.ok) {
    throw new Error(`Gagal antre sinyal ke MT5 bridge: ${res.status}`);
  }
  return res.json();
}

/**
 * Cek 3 kontrol risiko mode OTONOM (1 posisi terbuka, limit trade/hari,
 * circuit breaker rugi harian) sebelum mengizinkan siklus auto-signal
 * mengeksekusi trade baru ke MT5. Kalau `allowed: false`, JANGAN enqueue
 * eksekusi apa pun — cukup catat alasannya ke user.
 */
export async function checkMt5AutonomousGuardrails(env, symbol, { maxTradesPerDay, maxDailyLossPct }) {
  const id = env.MT5_BRIDGE_DO.idFromName(symbol);
  const stub = env.MT5_BRIDGE_DO.get(id);

  const res = await stub.fetch("https://mt5-bridge/checkAutonomousGuardrails", {
    method: "POST",
    body: JSON.stringify({ maxTradesPerDay, maxDailyLossPct }),
  });

  if (!res.ok) {
    return { allowed: false, reason: `Gagal cek guardrail (HTTP ${res.status})` };
  }
  return res.json();
}

/**
 * Ambil snapshot ringan status risiko (posisi terbuka & balance) TANPA efek
 * samping apa pun (TIDAK increment counter trade harian, beda dengan
 * checkMt5AutonomousGuardrails). Dipakai session_do.js buat cek "masih ada
 * posisi terbuka?" SEBELUM mulai siklus auto-signal (ambil data pasar +
 * panggil AI) — supaya kalau memang masih ada posisi, siklus bisa di-skip
 * lebih awal dan tidak buang-buang limit API Groq untuk sinyal yang toh
 * bakal ditolak guardrail juga nantinya.
 */
export async function getMt5RiskSnapshot(env, symbol) {
  const id = env.MT5_BRIDGE_DO.idFromName(symbol);
  const stub = env.MT5_BRIDGE_DO.get(id);

  const res = await stub.fetch("https://mt5-bridge/getRiskSnapshot");
  if (!res.ok) {
    // Gagal ambil snapshot -> anggap TIDAK ADA posisi terbuka (jangan
    // sampai skip siklus gara-gara error jaringan sesaat). Guardrail
    // eksekusi yang sebenarnya tetap jalan normal di tahap enqueue nanti.
    return { openPositionTicket: null, balance: null, stale: true };
  }
  return res.json();
}

/**
 * Cek guardrail Strategi 2: cuma 1 syarat, jumlah layer terbuka < 10 (TIDAK
 * ada limit trade/hari atau circuit breaker rugi harian, sesuai keputusan
 * user -- murni TP $2/SL $1 flat per layer). Kalau `allowed: false`, JANGAN
 * enqueue eksekusi apa pun.
 */
export async function checkMt5LayerGuardrails(env, symbol) {
  const id = env.MT5_BRIDGE_DO.idFromName(symbol);
  const stub = env.MT5_BRIDGE_DO.get(id);

  const res = await stub.fetch("https://mt5-bridge/checkLayerGuardrails", { method: "POST" });
  if (!res.ok) {
    return { allowed: false, reason: `Gagal cek guardrail layer (HTTP ${res.status})`, openLayerCount: null };
  }
  return res.json();
}

/**
 * Snapshot ringan jumlah layer Strategi 2 yang lagi terbuka, TANPA efek
 * samping. Dipakai session_do.js buat skip siklus auto (sebelum panggil AI
 * sama sekali) begitu sudah pas 10 layer.
 */
export async function getMt5LayerSnapshot(env, symbol) {
  const id = env.MT5_BRIDGE_DO.idFromName(symbol);
  const stub = env.MT5_BRIDGE_DO.get(id);

  const res = await stub.fetch("https://mt5-bridge/getLayerSnapshot");
  if (!res.ok) {
    return { openLayerCount: 0, stale: true };
  }
  return res.json();
}
