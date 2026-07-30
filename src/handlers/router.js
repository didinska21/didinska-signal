import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  clearOldReplyKeyboard,
} from "../telegram.js";
import {
  MAIN_MENU_TEXT,
  mainMenuKeyboard,
  NEWS_MENU_TEXT,
  newsMenuKeyboard,
  backOnlyKeyboard,
  NEWS_ITEM_LABELS,
  TRADE_MODE_SELECT_TEXT,
  tradeModeKeyboard,
  signalTradePrompt,
  AI_COUNT_PROMPT_TEXT,
  aiCountKeyboard,
} from "../menus.js";
import {
  getMode,
  setMode,
  setTradeMode,
  addPhoto,
  countPhotos,
  resetSession,
  startAnalysis,
} from "../state.js";

const VALID_TRADE_MODES = ["scalping", "daytrade", "swing"];

export async function handleUpdate(env, update) {
  if (update.callback_query) {
    return handleCallbackQuery(env, update.callback_query);
  }
  if (update.message) {
    return handleMessage(env, update.message);
  }
}

async function handleMessage(env, message) {
  const chatId = message.chat.id;
  const text = message.text?.trim();

  // --- Perintah global ---
  if (text === "/start") {
    await resetSession(env, chatId);
    await clearOldReplyKeyboard(env, chatId);
    await sendMessage(env, chatId, MAIN_MENU_TEXT, mainMenuKeyboard());
    return;
  }

  if (text === "/batal") {
    await resetSession(env, chatId); // ini juga membatalkan proses AI kalau sedang berjalan
    await sendMessage(env, chatId, "❌ Dibatalkan. Kembali ke menu utama.", mainMenuKeyboard());
    return;
  }

  const mode = await getMode(env, chatId);

  // --- Mode: sedang menunggu foto chart untuk Signal Trade ---
  if (mode === "awaiting_chart") {
    if (message.photo && message.photo.length > 0) {
      const fileId = message.photo[message.photo.length - 1].file_id;
      const total = await addPhoto(env, chatId, fileId);

      await sendMessage(
        env,
        chatId,
        `✅ Foto chart diterima (total: <b>${total}</b>).\n\nKirim foto timeframe lain, atau ketik /selesai jika sudah cukup.`
      );
      return;
    }

    if (text === "/selesai") {
      const total = await countPhotos(env, chatId);

      if (total === 0) {
        await sendMessage(env, chatId, "Belum ada foto yang dikirim. Kirim minimal 1 foto chart dulu, atau ketik /batal.");
        return;
      }

      await setMode(env, chatId, "choosing_ai_count");
      await sendMessage(env, chatId, AI_COUNT_PROMPT_TEXT, aiCountKeyboard());
      return;
    }

    await sendMessage(
      env,
      chatId,
      "Mohon kirim <b>foto chart</b> (bukan teks). Ketik /selesai jika sudah selesai kirim foto, atau /batal untuk keluar."
    );
    return;
  }

  // --- Mode: sedang pilih jumlah AI, tapi user malah kirim teks ---
  if (mode === "choosing_ai_count") {
    await sendMessage(env, chatId, "Silakan pilih jumlah AI lewat tombol di atas, atau ketik /batal.");
    return;
  }

  // --- Mode: sedang diproses AI, jangan ganggu ---
  if (mode === "processing") {
    await sendMessage(env, chatId, "⏳ Analisis sedang berjalan, mohon tunggu... (ketik /batal untuk membatalkan)");
    return;
  }

  // --- Default ---
  await sendMessage(env, chatId, "Ketik /start untuk membuka menu utama.");
}

async function handleCallbackQuery(env, callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;

  await answerCallbackQuery(env, callbackQuery.id);

  // --- Pilih mode trading (Scalping/Day Trade/Swing) ---
  if (data.startsWith("mode_")) {
    const tradeModeKey = data.replace("mode_", "");
    if (!VALID_TRADE_MODES.includes(tradeModeKey)) return;

    await setTradeMode(env, chatId, tradeModeKey);
    await setMode(env, chatId, "awaiting_chart");
    await editMessageText(env, chatId, messageId, signalTradePrompt(tradeModeKey), backOnlyKeyboard("back_main"));
    return;
  }

  // --- Pilih jumlah AI analisa ---
  if (data === "ai_count_5" || data === "ai_count_10") {
    const aiCount = data === "ai_count_5" ? 5 : 10;
    await editMessageText(env, chatId, messageId, "⏳ Memulai analisis, mohon tunggu...");
    await startAnalysis(env, chatId, messageId, aiCount);
    return;
  }

  switch (data) {
    case "menu_news":
      await editMessageText(env, chatId, messageId, NEWS_MENU_TEXT, newsMenuKeyboard());
      return;

    case "back_main":
      await resetSession(env, chatId);
      await editMessageText(env, chatId, messageId, MAIN_MENU_TEXT, mainMenuKeyboard());
      return;

    case "menu_signal":
      await editMessageText(env, chatId, messageId, TRADE_MODE_SELECT_TEXT, tradeModeKeyboard());
      return;

    case "news_fomc":
    case "news_nfp":
    case "news_ppi":
    case "news_cpi": {
      const label = NEWS_ITEM_LABELS[data];
      await editMessageText(
        env,
        chatId,
        messageId,
        `📌 <b>${label}</b>\n\n⚙️ Fitur ini belum bisa digunakan, masih menunggu perbaikan.`,
        backOnlyKeyboard("menu_news")
      );
      return;
    }

    default:
      await editMessageText(env, chatId, messageId, MAIN_MENU_TEXT, mainMenuKeyboard());
  }
}
