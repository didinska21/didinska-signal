/**
 * Helper kecil untuk antre sinyal eksekusi ke Mt5BridgeDO (dipanggil dari
 * session_do.js setelah AI Penyimpul mengeluarkan keputusan BUY/SELL untuk
 * simbol yang datanya dari MT5, misal XAUUSD).
 */
export async function enqueueMt5Execution(env, symbol, { signalId, chatId, decision, entry, sl, tp, lot }) {
  const id = env.MT5_BRIDGE_DO.idFromName(symbol);
  const stub = env.MT5_BRIDGE_DO.get(id);

  const res = await stub.fetch("https://mt5-bridge/enqueueSignal", {
    method: "POST",
    body: JSON.stringify({ signalId, chatId, decision, entry, sl, tp, lot, symbol }),
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
