/**
 * Durable Object untuk session per chat_id, SEKALIGUS mesin proses
 * "multi-AI analysis" (AI spesialis 1 -> 2 -> ... -> AI Penyimpul).
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
import { analyzeWithGroqText } from "./groqText.js";
import { getAnalystsForMode } from "./analysts.js";
import { mainMenuKeyboard } from "./menus.js";
import { escapeHtml, formatTelegramHtml } from "./htmlUtil.js";

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

      case "setSymbol": {
        const { symbol } = await request.json();
        await this.storage.put("symbol", symbol);
        return Response.json({ ok: true });
      }

      case "getSymbol": {
        const symbol = await this.storage.get("symbol");
        return Response.json({ symbol });
      }

      case "setAiMode": {
        const { aiMode } = await request.json();
        await this.storage.put("aiMode", aiMode);
        return Response.json({ ok: true });
      }

      case "addPhoto": {
        const { fileId } = await request.json();
        // Pakai transaction supaya read-modify-write ini atomik. Tanpa ini,
        // 2 request "addPhoto" yang masuk hampir bersamaan (misal user kirim
        // beberapa foto berurutan cepat) bisa saling selip di antara get()
        // dan put(), sehingga salah satu foto hilang (lost update).
        const total = await this.storage.transaction(async (txn) => {
          const photos = (await txn.get("photos")) || [];
          photos.push(fileId);
          await txn.put("photos", photos);
          return photos.length;
        });
        return Response.json({ total });
      }

      case "countPhotos": {
        const photos = (await this.storage.get("photos")) || [];
        return Response.json({ total: photos.length });
      }

      case "reset": {
        await this.storage.put("mode", "idle");
        await this.storage.delete("photos");
        await this.storage.delete("tradeMode");
        await this.storage.delete("symbol");
        await this.storage.delete("aiMode");
        await this.storage.delete("job");
        await this.storage.deleteAlarm();
        return Response.json({ ok: true });
      }

      case "setAccess": {
        const { expiresAt } = await request.json();
        await this.storage.put("access", { approved: true, expiresAt });
        return Response.json({ ok: true });
      }

      case "getAccess": {
        const access = (await this.storage.get("access")) || { approved: false, expiresAt: null };
        return Response.json(access);
      }

      case "startAnalysis": {
        const { chatId, messageId, dataPackage } = await request.json();
        const photos = (await this.storage.get("photos")) || [];
        const tradeMode = (await this.storage.get("tradeMode")) || "scalping";
        const symbol = (await this.storage.get("symbol")) || "";
        const aiMode = (await this.storage.get("aiMode")) || "lengkap";

        await this.storage.put("job", {
          chatId,
          messageId,
          aiMode,
          tradeMode,
          symbol,
          photos,
          dataPackage,
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

    const { chatId, messageId, aiMode, tradeMode, symbol, photos, dataPackage, step, opinions } = job;
    const analystsList = getAnalystsForMode(aiMode);

    try {
      if (step < analystsList.length) {
        const analyst = analystsList[step];

        // --- Langkah: 1 AI spesialis menganalisa ---
        await safeEdit(
          this.env,
          chatId,
          messageId,
          `🤖 AI ${step + 1}/${analystsList.length} — <b>${escapeHtml(analyst.title)}</b> sedang menganalisa...`
        );

        let opinionText;
        if (analyst.kind === "photo") {
          opinionText = await analyzeChartImages(this.env, photos, tradeMode, analyst.number, symbol);
        } else {
          const systemPrompt = analyst.buildSystemPrompt(symbol, tradeMode);
          const dataSlice = analyst.buildDataSlice(dataPackage);
          opinionText = await analyzeWithGroqText(
            this.env,
            analyst.number,
            systemPrompt,
            dataSlice,
            `AI ${analyst.number} - ${analyst.title}`
          );
        }

        opinions.push({ label: `AI ${analyst.number} (${analyst.title})`, opinion: opinionText });

        const preview = opinionText.length > 220 ? opinionText.slice(0, 220) + "..." : opinionText;
        await safeEdit(
          this.env,
          chatId,
          messageId,
          `✅ AI ${step + 1}/${analystsList.length} — <b>${escapeHtml(analyst.title)}</b> selesai:\n\n${formatTelegramHtml(preview)}`
        );

        job.step = step + 1;
        job.opinions = opinions;
        await this.storage.put("job", job);
        await this.storage.setAlarm(Date.now() + STEP_DELAY_MS);
        return;
      }

      // --- Semua AI spesialis selesai -> giliran AI Penyimpul ---
      await safeEdit(
        this.env,
        chatId,
        messageId,
        `🧠 AI Penyimpul sedang merangkum ${analystsList.length} hasil analisa jadi 1 keputusan final...`
      );

      const finalSignal = await summarizeSignals(this.env, opinions, tradeMode, symbol);

      // Escape dulu (parse_mode: HTML) supaya karakter "<" / "&" (misal "RSI < 30")
      // tidak bikin Telegram reject pesan, LALU ubah gaya Markdown yang sering
      // dipakai model ("**tebal**") jadi tag HTML asli (<b>) biar benar-benar tebal
      // di Telegram, bukan tampil sebagai tanda bintang mentah.
      await safeEdit(this.env, chatId, messageId, formatTelegramHtml(finalSignal), mainMenuKeyboard());

      // Beres — bersihkan job & session
      await this.storage.delete("job");
      await this.storage.put("mode", "idle");
      await this.storage.delete("photos");
      await this.storage.delete("tradeMode");
      await this.storage.delete("symbol");
      await this.storage.delete("aiMode");
    } catch (err) {
      console.error("Analysis alarm error:", err);
      await safeEdit(
        this.env,
        chatId,
        messageId,
        `⚠️ Terjadi kesalahan saat proses analisis:\n${escapeHtml(err.message)}\n\nSilakan coba lagi lewat /start.`,
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

