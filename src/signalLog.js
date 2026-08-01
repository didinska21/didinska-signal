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

/** Ambil riwayat sinyal (opsional difilter per chat & status), terbaru duluan. */
export async function listSignals(env, chatId, status, limit) {
  const res = await getLogStub(env).fetch("https://log/listSignals", {
    method: "POST",
    body: JSON.stringify({ chatId, status, limit }),
  });
  const data = await res.json();
  return data.entries;
}

/**
 * Hitung ringkasan win-rate dari daftar sinyal. Sinyal berstatus "open"
 * (belum ditandai user) TIDAK dihitung ke win-rate — cuma ditampilkan
 * jumlahnya, supaya persentasenya jujur (bukan dianggap kalah/menang
 * padahal user belum sempat nandain).
 */
export function summarizeSignalStats(entries) {
  const total = entries.length;
  const win = entries.filter((e) => e.status === "win").length;
  const loss = entries.filter((e) => e.status === "loss").length;
  const open = entries.filter((e) => e.status === "open").length;
  const decided = win + loss;
  const winRatePct = decided > 0 ? Math.round((win / decided) * 1000) / 10 : null;
  return { total, win, loss, open, decided, winRatePct };
}
