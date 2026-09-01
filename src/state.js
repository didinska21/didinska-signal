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

export async function setSymbol(env, chatId, symbol) {
  await getStub(env, chatId).fetch("https://session/setSymbol", {
    method: "POST",
    body: JSON.stringify({ symbol }),
  });
}

export async function getSymbol(env, chatId) {
  const res = await getStub(env, chatId).fetch("https://session/getSymbol");
  const data = await res.json();
  return data.symbol;
}

export async function setAiMode(env, chatId, aiMode) {
  await getStub(env, chatId).fetch("https://session/setAiMode", {
    method: "POST",
    body: JSON.stringify({ aiMode }),
  });
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

/**
 * Klaim slot "pesan konfirmasi foto" secara atomik. Dipakai supaya kalau
 * beberapa foto masuk hampir bersamaan (misal user kirim album), cuma SATU
 * yang bikin pesan baru — sisanya nunggu id pesan itu siap lalu ikut EDIT
 * pesan yang sama. Return salah satu dari:
 *  - { status: "claim" }               -> caller ini yang harus bikin pesan baru
 *  - { status: "pending" }             -> lagi ditunggu, request lain sedang bikin pesan
 *  - { status: "ready", messageId }    -> sudah ada, tinggal edit pesan ini
 */
export async function claimPhotoPromptMsgId(env, chatId) {
  const res = await getStub(env, chatId).fetch("https://session/claimPhotoPromptMsgId", { method: "POST" });
  return res.json();
}

/** Simpan message_id pesan konfirmasi foto, supaya foto berikutnya bisa EDIT pesan itu (bukan kirim baru) */
export async function setPhotoPromptMsgId(env, chatId, messageId) {
  await getStub(env, chatId).fetch("https://session/setPhotoPromptMsgId", {
    method: "POST",
    body: JSON.stringify({ messageId }),
  });
}

export async function getPhotoPromptMsgId(env, chatId) {
  const res = await getStub(env, chatId).fetch("https://session/getPhotoPromptMsgId");
  const data = await res.json();
  return data.messageId;
}

/** Reset sesi. Balikin message_id pesan konfirmasi foto lama (kalau ada), supaya
 * caller bisa melumpuhkan tombolnya (biar tombol basi nggak nyangkut di chat). */
export async function resetSession(env, chatId) {
  const res = await getStub(env, chatId).fetch("https://session/reset", { method: "POST" });
  const data = await res.json();
  return data.photoPromptMsgId || null;
}

/** Mulai proses multi-AI analysis (dijalankan via Durable Object Alarm) */
export async function startAnalysis(env, chatId, messageId, dataPackage) {
  await getStub(env, chatId).fetch("https://session/startAnalysis", {
    method: "POST",
    body: JSON.stringify({ chatId, messageId, dataPackage }),
  });
}

/** Nyalain auto-signal (dipicu /auto, atau tombol Strategi 1/2): analisis otomatis berulang tiap 10 menit.
 * `strategy`: "s1" (default, 10 AI/analisa menyeluruh) atau "s2" (6 AI, mode
 * "Fibo & QM" -- Fibonacci Retracement + pola Quasimodo sebagai dasar
 * utama entry) -- eksekusi & risk management KEDUANYA SAMA: 1 posisi/waktu,
 * native SL/TP, lot % risiko, guardrail harian. */
export async function startAutoSignal(env, chatId, { symbol, tradeMode, aiMode, strategy = "s1" }) {
  await getStub(env, chatId).fetch("https://session/startAuto", {
    method: "POST",
    body: JSON.stringify({ chatId, symbol, tradeMode, aiMode, strategy }),
  });
}

/** Matiin auto-signal (dipicu /stop_auto) */
export async function stopAutoSignal(env, chatId) {
  await getStub(env, chatId).fetch("https://session/stopAuto", { method: "POST" });
}

export async function getAutoMode(env, chatId) {
  const res = await getStub(env, chatId).fetch("https://session/getAutoMode");
  const data = await res.json();
  return data.autoMode;
}
