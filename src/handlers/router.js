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
  SIGNAL_TRADE_PROMPT,
} from "../menus.js";
import { getMode, setMode, addPhoto, countPhotos, resetSession } from "../state.js";

/**
 * Titik masuk utama: terima 1 update dari Telegram, arahkan ke handler yang sesuai.
 */
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
    // Bersihkan custom keyboard lama (dari bot/sesi sebelumnya) yang mungkin masih nempel
    await clearOldReplyKeyboard(env, chatId);
    await sendMessage(env, chatId, MAIN_MENU_TEXT, mainMenuKeyboard());
    return;
  }

  if (text === "/batal") {
    await resetSession(env, chatId);
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

      // TODO: panggil fungsi analisis multi-timeframe (Groq Vision) di sini nanti.
      await sendMessage(
        env,
        chatId,
        `📥 Menerima <b>${total} foto chart</b>.\n\n⚙️ Fitur analisis otomatis masih dalam pengembangan, belum bisa memproses gambar untuk saat ini.`,
        mainMenuKeyboard()
      );
      await resetSession(env, chatId);
      return;
    }

    await sendMessage(
      env,
      chatId,
      "Mohon kirim <b>foto chart</b> (bukan teks). Ketik /selesai jika sudah selesai kirim foto, atau /batal untuk keluar."
    );
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

  switch (data) {
    case "menu_news":
      await editMessageText(env, chatId, messageId, NEWS_MENU_TEXT, newsMenuKeyboard());
      return;

    case "back_main":
      await resetSession(env, chatId);
      await editMessageText(env, chatId, messageId, MAIN_MENU_TEXT, mainMenuKeyboard());
      return;

    case "menu_signal":
      await setMode(env, chatId, "awaiting_chart");
      await editMessageText(env, chatId, messageId, SIGNAL_TRADE_PROMPT, backOnlyKeyboard("back_main"));
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
