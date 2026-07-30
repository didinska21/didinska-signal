/**
 * Durable Object untuk session per chat_id, SEKALIGUS mesin proses
 * "multi-AI analysis" (AI 1 -> AI 2 -> ... -> AI Penyimpul).
 *
 * Kenapa proses AI-nya juga di sini (bukan langsung di webhook handler)?
 * Karena proses 5-10 AI berurutan + jeda 1-2 detik bisa makan waktu lebih
 * dari 30 detik, melebihi jatah waktu yang diizinkan Cloudflare setelah
 * webhook membalas "OK" ke Telegram. Solusinya: pakai fitur ALARM dari
 * Durable Object — tiap "langkah AI" adalah 1 invocation terpisah yang
 * menjadwalkan langkah berikutnya sendiri, jadi tidak kena limit itu sama
 * sekali.
 */
import { editMessageText } from "./telegram.js";
import { analyzeChartImages, summarizeSignals } from "./groqVision.js";
import { mainMenuKeyboard } from "./menus.js";

const STEP_DELAY_MS = 1800; // jeda antar "AI" biar kelihatan seperti proses satu-satu

export class SessionDO {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);

    switch (action) {
      case "getMode": {
        const mode = (await this.storage.get("mode")) || "idle";
        return Response.json({ mode });
      }

      case "setMode": {
        const { mode } = await request.json();
        await this.storage.put("mode", mode);
        return Response.json({ ok: true });
      }

      case "setTradeMode": {
        const { tradeMode } = await request.json();
        await this.storage.put("tradeMode", tradeMode);
        return Response.json({ ok: true });
      }

      case "getTradeMode": {
        const tradeMode = await this.storage.get("tradeMode");
        return Response.json({ tradeMode });
      }

      case "addPhoto": {
        const { fileId } = await request.json();
        const photos = (await this.storage.get("photos")) || [];
        photos.push(fileId);
        await this.storage.put("photos", photos);
        return Response.json({ total: photos.length });
      }

      case "countPhotos": {
        const photos = (await this.storage.get("photos")) || [];
        return Response.json({ total: photos.length });
      }

      case "listPhotos": {
        const photos = (await this.storage.get("photos")) || [];
        return Response.json({ photos });
      }

      case "reset": {
        await this.storage.put("mode", "idle");
        await this.storage.delete("photos");
        await this.storage.delete("tradeMode");
        await this.storage.delete("job");
        await this.storage.deleteAlarm();
        return Response.json({ ok: true });
      }

      case "startAnalysis": {
        const { chatId, messageId, aiCount } = await request.json();
        const photos = (await this.storage.get("photos")) || [];
        const tradeMode = (await this.storage.get("tradeMode")) || "scalping";

        await this.storage.put("job", {
          chatId,
          messageId,
          aiCount,
          tradeMode,
          photos,
          step: 0,
          opinions: [],
        });
        await this.storage.put("mode", "processing");

        // Trigger langkah pertama secepatnya
        await this.storage.setAlarm(Date.now());
        return Response.json({ ok: true });
      }

      default:
        return new Response("Unknown action", { status: 404 });
    }
  }

  /**
   * Dipanggil otomatis oleh Cloudflare tiap kali alarm terpicu.
   * Ini "mesin" yang menjalankan 1 langkah proses, lalu menjadwalkan
   * langkah berikutnya (kalau masih ada).
   */
  async alarm() {
    const job = await this.storage.get("job");
    if (!job) return; // sudah selesai / dibatalkan lewat /batal

    const { chatId, messageId, aiCount, tradeMode, photos, step, opinions } = job;

    try {
      if (step < aiCount) {
        // --- Langkah: 1 AI analyst menganalisa ---
        await safeEdit(
          this.env,
          chatId,
          messageId,
          `🤖 AI ${step + 1}/${aiCount} sedang menganalisa chart...`
        );

        const opinion = await analyzeChartImages(this.env, photos, tradeMode, step + 1);
        opinions.push(opinion);

        const preview = opinion.length > 250 ? opinion.slice(0, 250) + "..." : opinion;
        await safeEdit(
          this.env,
          chatId,
          messageId,
          `✅ AI ${step + 1}/${aiCount} selesai:\n\n<i>${escapeHtml(preview)}</i>`
        );

        job.step = step + 1;
        job.opinions = opinions;
        await this.storage.put("job", job);
        await this.storage.setAlarm(Date.now() + STEP_DELAY_MS);
        return;
      }

      // --- Semua AI analyst selesai -> giliran AI Penyimpul ---
      await safeEdit(
        this.env,
        chatId,
        messageId,
        `🧠 AI Penyimpul sedang merangkum ${aiCount} hasil analisa menjadi 1 sinyal final...`
      );

      const finalSignal = await summarizeSignals(this.env, opinions, tradeMode);

      await safeEdit(this.env, chatId, messageId, finalSignal, mainMenuKeyboard());

      // Beres — bersihkan job & session
      await this.storage.delete("job");
      await this.storage.put("mode", "idle");
      await this.storage.delete("photos");
      await this.storage.delete("tradeMode");
    } catch (err) {
      console.error("Analysis alarm error:", err);
      await safeEdit(
        this.env,
        chatId,
        messageId,
        `⚠️ Terjadi kesalahan saat proses analisis:\n${err.message}\n\nSilakan coba lagi lewat /start.`,
        mainMenuKeyboard()
      );
      await this.storage.delete("job");
      await this.storage.put("mode", "idle");
    }
  }
}

/** Edit pesan, tapi abaikan error "message is not modified" (bukan error fatal) */
async function safeEdit(env, chatId, messageId, text, replyMarkup) {
  try {
    await editMessageText(env, chatId, messageId, text, replyMarkup);
  } catch (err) {
    if (!String(err.message).includes("message is not modified")) {
      throw err;
    }
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
