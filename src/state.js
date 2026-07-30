/**
 * Wrapper untuk berinteraksi dengan SessionDO (Durable Object).
 * Tiap chat_id punya instance Durable Object sendiri (di-address lewat idFromName),
 * sehingga operasi baca-tulis per user dijamin berurutan & konsisten.
 */

function getStub(env, chatId) {
  const id = env.SESSION_DO.idFromName(String(chatId));
  return env.SESSION_DO.get(id);
}

export async function getMode(env, chatId) {
  const res = await getStub(env, chatId).fetch("https://session/getMode");
  const data = await res.json();
  return data.mode;
}

export async function setMode(env, chatId, mode) {
  await getStub(env, chatId).fetch("https://session/setMode", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export async function setTradeMode(env, chatId, tradeMode) {
  await getStub(env, chatId).fetch("https://session/setTradeMode", {
    method: "POST",
    body: JSON.stringify({ tradeMode }),
  });
}

export async function getTradeMode(env, chatId) {
  const res = await getStub(env, chatId).fetch("https://session/getTradeMode");
  const data = await res.json();
  return data.tradeMode;
}

/** Tambah 1 foto, langsung dapat total terbaru (atomik, tidak perlu panggilan terpisah) */
export async function addPhoto(env, chatId, fileId) {
  const res = await getStub(env, chatId).fetch("https://session/addPhoto", {
    method: "POST",
    body: JSON.stringify({ fileId }),
  });
  const data = await res.json();
  return data.total;
}

export async function countPhotos(env, chatId) {
  const res = await getStub(env, chatId).fetch("https://session/countPhotos");
  const data = await res.json();
  return data.total;
}

export async function listPhotos(env, chatId) {
  const res = await getStub(env, chatId).fetch("https://session/listPhotos");
  const data = await res.json();
  return data.photos;
}

export async function resetSession(env, chatId) {
  await getStub(env, chatId).fetch("https://session/reset", { method: "POST" });
}

/** Mulai proses multi-AI analysis (dijalankan via Durable Object Alarm) */
export async function startAnalysis(env, chatId, messageId, aiCount) {
  await getStub(env, chatId).fetch("https://session/startAnalysis", {
    method: "POST",
    body: JSON.stringify({ chatId, messageId, aiCount }),
  });
}
