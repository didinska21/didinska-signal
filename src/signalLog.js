/**
 * Wrapper untuk manggil SignalLogDO. Selalu 1 instance yang sama (idFromName
 * dengan nama tetap "global") supaya semua sinyal (dari chat mana pun) masuk
 * ke satu tempat penyimpanan yang sama, gampang direkap.
 */
function getLogStub(env) {
  const id = env.SIGNAL_LOG_DO.idFromName("global");
  return env.SIGNAL_LOG_DO.get(id);
}

/**
 * Catat 1 sinyal yang baru saja dikeluarkan bot.
 * entry: { chatId, symbol, tradeMode, aiMode, decision, biasArah, probabilityText, createdAt }
 * Return: id sinyal itu (dipakai buat tombol "Tandai Hasil" & callback_data).
 */
export async function logSignal(env, entry) {
  const res = await getLogStub(env).fetch("https://log/logSignal", {
    method: "POST",
    body: JSON.stringify(entry),
  });
  const data = await res.json();
  return data.id;
}

/** Tandai hasil 1 sinyal: status "win" (TP kena) atau "loss" (SL kena). */
export async function markSignalResult(env, id, status) {
  const res = await getLogStub(env).fetch("https://log/markResult", {
    method: "POST",
    body: JSON.stringify({ id, status }),
  });
  return res.json();
}

export async function getSignal(env, id) {
  const res = await getLogStub(env).fetch("https://log/getSignal", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  return data.record;
}

/** HAPUS SEMUA riwayat sinyal (GLOBAL, seluruh chat) -- IRREVERSIBLE. Dipakai
 * buat reset statistik win-rate dari nol (misal mulai sesi testing baru). */
export async function clearSignalHistory(env) {
  const res = await getLogStub(env).fetch("https://log/clearAll", { method: "POST" });
  return res.json();
}

/** Ambil riwayat sinyal (opsional difilter per chat, status, & strategi
 * "s1"/"s2" -- null/undefined berarti tidak difilter berdasarkan itu),
 * terbaru duluan. */
export async function listSignals(env, chatId, status, limit, strategy) {
  const res = await getLogStub(env).fetch("https://log/listSignals", {
    method: "POST",
    body: JSON.stringify({ chatId, status, limit, strategy }),
  });
  const data = await res.json();
  return data.entries;
}

/**
 * Hitung ringkasan win-rate dari daftar sinyal. Status yang mungkin:
 * "open" (belum ditandai/belum closed), "win", "loss", atau "skipped"
 * (KHUSUS auto-mode -- sinyal yang TIDAK PERNAH benar-benar dieksekusi ke
 * MT5 sama sekali: entry/SL/TP tidak valid, kena guardrail harian, lot di
 * bawah minimum, atau gagal antre -- lihat session_do.js). "skipped" itu
 * BUKAN kalah & BUKAN "belum ditandai" -- itu "tidak pernah jadi trade
 * sama sekali", jadi DIKECUALIKAN TOTAL dari statistik di bawah (tidak
 * masuk total/win/loss/open sama sekali), supaya angkanya tidak nyangkut
 * "open" selamanya cuma gara-gara sinyal yang memang tidak pernah jalan.
 */
export function summarizeSignalStats(entries) {
  const counted = entries.filter((e) => e.status !== "skipped");
  const total = counted.length;
  const win = counted.filter((e) => e.status === "win").length;
  const loss = counted.filter((e) => e.status === "loss").length;
  const open = counted.filter((e) => e.status === "open").length;
  const decided = win + loss;
  const winRatePct = decided > 0 ? Math.round((win / decided) * 1000) / 10 : null;
  return { total, win, loss, open, decided, winRatePct };
}
