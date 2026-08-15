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
