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
import { sendMessage, sendPhoto, editMessageText } from "./telegram.js";
import { analyzeChartImages, summarizeSignals } from "./groqVision.js";
import { analyzeWithGroqText } from "./groqText.js";
import { getAnalystsForMode } from "./analysts.js";
import { mainMenuKeyboard, signalResultKeyboard } from "./menus.js";
import { escapeHtml, formatTelegramHtml } from "./htmlUtil.js";
import { logSignal, listSignals, markSignalResult } from "./signalLog.js";
import { buildMarketDataPackage } from "./marketData.js";
import { fetchCurrentPrice, isMt5Symbol } from "./marketSource.js";
import { buildSignalChartImage } from "./ChartImage.js";
import { enqueueMt5Execution } from "./mt5Exec.js";

const AUTO_INTERVAL_MS = 10 * 60 * 1000; // 10 menit

const STEP_DELAY_MS = 1800; // jeda antar "AI" biar kelihatan seperti proses satu-satu

// Lot default untuk eksekusi otomatis ke MT5 (demo). Bisa dioverride lewat
// env var MT5_DEFAULT_LOT. Ini SENGAJA fixed-lot sederhana (bukan position
// sizing berbasis % risiko akun) — cukup untuk tahap demo/testing awal.
const DEFAULT_MT5_LOT = 0.01;

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
        const total = await this.storage.transaction(async (txn) => {
          const photos = (await txn.get("photos")) || [];
          photos.push(fileId);
          await txn.put("photos", photos);
          return photos.length;
        });
        return Response.json({ total });
      }

      case "claimPhotoPromptMsgId": {
        const result = await this.storage.transaction(async (txn) => {
          const current = await txn.get("photoPromptMsgId");
          if (current && current !== "PENDING") {
            return { status: "ready", messageId: current };
          }
          if (current === "PENDING") {
            return { status: "pending" };
          }
          await txn.put("photoPromptMsgId", "PENDING");
          return { status: "claim" };
        });
        return Response.json(result);
      }

      case "setPhotoPromptMsgId": {
        const { messageId } = await request.json();
        if (messageId) {
          await this.storage.put("photoPromptMsgId", messageId);
        } else {
          await this.storage.delete("photoPromptMsgId");
        }
        return Response.json({ ok: true });
      }

      case "getPhotoPromptMsgId": {
        const messageId = (await this.storage.get("photoPromptMsgId")) || null;
        return Response.json({ messageId: messageId === "PENDING" ? null : messageId });
      }

      case "countPhotos": {
        const photos = (await this.storage.get("photos")) || [];
        return Response.json({ total: photos.length });
      }

      case "reset": {
        const storedPhotoPromptMsgId = (await this.storage.get("photoPromptMsgId")) || null;
        const oldPhotoPromptMsgId = storedPhotoPromptMsgId === "PENDING" ? null : storedPhotoPromptMsgId;
        await this.storage.put("mode", "idle");
        await this.storage.delete("photos");
        await this.storage.delete("photoPromptMsgId");
        await this.storage.delete("tradeMode");
        await this.storage.delete("symbol");
        await this.storage.delete("aiMode");
        await this.storage.delete("job");
        await this.storage.deleteAlarm();
        return Response.json({ ok: true, photoPromptMsgId: oldPhotoPromptMsgId });
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

      case "startAuto": {
        const { chatId, symbol, tradeMode, aiMode } = await request.json();
        await this.storage.put("autoMode", true);
        await this.storage.put("autoChatId", chatId);
        await this.storage.put("autoNextRun", { symbol, tradeMode, aiMode });
        const job = await this.storage.get("job");
        if (!job) await this.storage.setAlarm(Date.now());
        return Response.json({ ok: true });
      }

      case "stopAuto": {
        await this.storage.put("autoMode", false);
        const job = await this.storage.get("job");
        if (!job) {
          await this.storage.delete("autoNextRun");
          await this.storage.deleteAlarm();
        }
        return Response.json({ ok: true });
      }

      case "getAutoMode": {
        const autoMode = (await this.storage.get("autoMode")) || false;
        return Response.json({ autoMode });
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
        await this.storage.delete("photoPromptMsgId");

        await this.storage.setAlarm(Date.now());
        return Response.json({ ok: true });
      }

      default:
        return new Response("Unknown action", { status: 404 });
    }
  }

  async alarm() {
    const job = await this.storage.get("job");

    if (!job) {
      const autoNextRun = await this.storage.get("autoNextRun");
      if (autoNextRun) {
        await this.storage.delete("autoNextRun");
        await this.runAutoCycle(autoNextRun);
      }
      return;
    }

    const { chatId, messageId, aiMode, tradeMode, symbol, photos, dataPackage, step, opinions } = job;
    const analystsList = getAnalystsForMode(aiMode);

    try {
      if (step < analystsList.length) {
        const analyst = analystsList[step];

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

      await safeEdit(
        this.env,
        chatId,
        messageId,
        `🧠 AI Penyimpul sedang merangkum ${analystsList.length} hasil analisa jadi 1 keputusan final...`
      );

      const biasTally = tallyBias(opinions);
      const finalSignal = await summarizeSignals(this.env, opinions, tradeMode, symbol, biasTally, aiMode);
      const finalSignalFixed = enforceBiasTally(finalSignal, biasTally, opinions.length);
      const decision = detectDecision(finalSignalFixed);

      // AI sering menulis label dibungkus markdown, misal "**Keputusan:** SELL"
      // bukan "Keputusan: SELL" polos — detectDecision() & extractPriceAfterLabel()
      // sudah menangani ini (lihat komentar masing-masing fungsi).
      const plainSignal = finalSignalFixed.replace(/\*/g, "");

      let resultKeyboard = mainMenuKeyboard();
      let signalId = null;
      let slPrice = null;
      let tpPrice = null;
      let entryPrice = null;
      if (decision && decision !== "WAIT") {
        // Pola dash "[\\s\\-–—]*" dipakai karena AI kadang nulis "Stop–Loss"
        // atau "Take—Profit" pakai en dash/em dash (bukan hyphen "-" biasa) —
        // kalau cuma cari string "Stop-Loss" persis, pencarian gagal TOTAL
        // begitu karakter dash-nya beda, dan SL/TP jadi null (pernah kejadian,
        // lihat test/session_do.test.js untuk kasus nyatanya).
        // dataPackage.lastPrice = harga pasar terakhir, dipakai sebagai acuan
        // supaya extractPriceAfterLabel bisa milih angka yang masuk akal
        // sebagai harga (lihat komentar di definisi fungsinya).
        const lastPrice = dataPackage?.lastPrice ?? null;
        slPrice = extractPriceAfterLabel(plainSignal, "Stop[\\s\\-–—]*Loss", lastPrice);
        tpPrice = extractPriceAfterLabel(plainSignal, "Take[\\s\\-–—]*Profit", lastPrice);
        entryPrice = extractPriceAfterLabel(plainSignal, "Skenario[\\s\\-–—]*Entry", lastPrice);

        signalId = await logSignal(this.env, {
          chatId,
          symbol,
          tradeMode,
          aiMode,
          decision,
          slPrice,
          tpPrice,
          createdAt: Date.now(),
        });
        resultKeyboard = signalResultKeyboard(signalId);

        // --- Eksekusi otomatis ke MT5 (khusus simbol yang datanya dari MT5
        // bridge, misal XAUUSD) — antre sinyal buat diambil & dieksekusi
        // bridge Python di laptop/VPS kamu.
        if (isMt5Symbol(symbol) && !job.isAuto) {
          // Guard 1: SL/TP/Entry gagal ke-parse (null) — JANGAN antre
          // eksekusi, lebih aman diam & kasih tahu user, daripada bridge
          // eksekusi order tanpa SL/TP yang jelas.
          if (entryPrice == null || slPrice == null || tpPrice == null) {
            await sendMessage(
              this.env,
              chatId,
              `⚠️ Sinyal ${decision} muncul tapi Entry/SL/TP gagal terbaca lengkap dari teks AI Penyimpul — eksekusi otomatis ke MT5 DIBATALKAN demi keamanan. Silakan cek manual teks sinyal di atas.`
            );
          }
          // Guard 2: susunan Entry/SL/TP harus logis. BUY: TP > Entry > SL.
          // SELL: TP < Entry < SL. Kalau kebalik/aneh (misalnya AI keliru
          // menganalisa data candle yang beku saat pasar tutup), sinyal ini
          // TIDAK BOLEH dieksekusi otomatis — order jadi tidak masuk akal
          // (contoh nyata yang pernah kejadian: BUY dengan TP di BAWAH SL).
          else if (
            (decision === "BUY" && !(tpPrice > entryPrice && entryPrice > slPrice)) ||
            (decision === "SELL" && !(tpPrice < entryPrice && entryPrice < slPrice))
          ) {
            await sendMessage(
              this.env,
              chatId,
              `⚠️ Sinyal ${decision} dengan Entry ${entryPrice} / SL ${slPrice} / TP ${tpPrice} susunannya TIDAK LOGIS (untuk ${decision}, seharusnya ${
                decision === "BUY" ? "TP > Entry > SL" : "TP < Entry < SL"
              }) — eksekusi otomatis ke MT5 DIBATALKAN demi keamanan. Kemungkinan penyebab: AI menganalisa data candle yang sudah tidak update (misal saat pasar tutup). Cek manual teks sinyal di atas sebelum entry sendiri.`
            );
          } else {
            try {
              const lot = Number(this.env.MT5_DEFAULT_LOT) || DEFAULT_MT5_LOT;
              await enqueueMt5Execution(this.env, symbol, {
                signalId,
                chatId,
                decision,
                entry: entryPrice,
                sl: slPrice,
                tp: tpPrice,
                lot,
              });
              await sendMessage(
                this.env,
                chatId,
                `🔗 Sinyal ${decision} sudah diantre ke MT5 bridge (lot ${lot}). Menunggu bridge Python di laptop kamu mengambil & mengeksekusi — kamu akan dikirimi notifikasi begitu order tereksekusi (atau gagal).`
              );
            } catch (err) {
              console.error("Gagal antre eksekusi MT5:", err);
              await sendMessage(
                this.env,
                chatId,
                `⚠️ Gagal mengantre sinyal ${decision} ke MT5 bridge: ${escapeHtml(err.message)}\n\n(Sinyal teks di atas tetap valid, cuma eksekusi otomatisnya gagal — bisa entry manual kalau perlu.)`
              );
            }
          }
        }
      }


      await safeEdit(this.env, chatId, messageId, formatTelegramHtml(finalSignalFixed), resultKeyboard);

      if (!job.isAuto && decision && decision !== "WAIT") {
        try {
          const primaryInterval = dataPackage?.primaryInterval || "15m";
          const isFiboQmMode = aiMode === "fiboqm";
          const imageBytes = await buildSignalChartImage({
            env: this.env,
            symbol,
            interval: primaryInterval,
            entry: entryPrice,
            sl: slPrice,
            tp: tpPrice,
            decision,
            fiboLevels: isFiboQmMode ? dataPackage?.fiboQm?.fibonacci?.levels ?? null : null,
            qmLevel: isFiboQmMode ? dataPackage?.fiboQm?.quasimodo?.qmLevel ?? null : null,
          });
          await sendPhoto(
            this.env,
            chatId,
            imageBytes,
            `📊 ${symbol} (${primaryInterval}) — 🟡 Entry ${entryPrice ?? "-"} | 🟢 TP ${tpPrice ?? "-"} | 🔴 SL ${slPrice ?? "-"}`
          );
        } catch (err) {
          console.error("Gagal generate/kirim chart:", err);
          try {
            await sendMessage(
              this.env,
              chatId,
              `⚠️ Gagal membuat gambar chart bergaris untuk ${escapeHtml(symbol)}: ${escapeHtml(err.message)}\n\n(Sinyal teks di atas tetap valid, ini cuma gambar tambahannya yang gagal.)`
            );
          } catch (notifyErr) {
            // Kalau notifikasi error-nya sendiri ikut gagal (misal masalah
            // jaringan sesaat), minimal jangan sampai bikin exception ini
            // ikut "menelan" pesan aslinya tanpa jejak sama sekali di log.
            console.error("Gagal juga kirim notifikasi error chart:", notifyErr);
          }
        }
      }

      await this.storage.delete("job");
      await this.storage.put("mode", "idle");
      await this.storage.delete("photos");
      await this.storage.delete("tradeMode");
      await this.storage.delete("symbol");
      await this.storage.delete("aiMode");

      const autoMode = await this.storage.get("autoMode");
      if (autoMode) {
        await this.storage.put("autoNextRun", { symbol, tradeMode, aiMode });
        await this.storage.setAlarm(Date.now() + AUTO_INTERVAL_MS);
      }
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

      const autoMode = await this.storage.get("autoMode");
      if (autoMode) {
        await this.storage.put("autoNextRun", { symbol, tradeMode, aiMode });
        await this.storage.setAlarm(Date.now() + AUTO_INTERVAL_MS);
      }
    }
  }

  async runAutoCycle({ symbol, tradeMode, aiMode }) {
    const stillAuto = await this.storage.get("autoMode");
    if (!stillAuto) return;

    const chatId = await this.storage.get("autoChatId");
    if (!chatId) return;

    await this.checkOpenSignalsAgainstPrice(symbol, chatId);

    try {
      const sent = await sendMessage(this.env, chatId, `🤖 <b>Auto-Signal</b> — mengambil data pasar ${symbol}...`);
      const messageId = sent?.result?.message_id;
      const dataPackage = await buildMarketDataPackage(this.env, symbol, tradeMode);

      await this.storage.put("job", {
        chatId,
        messageId,
        aiMode,
        tradeMode,
        symbol,
        photos: [],
        dataPackage,
        step: 0,
        opinions: [],
        isAuto: true,
      });
      await this.storage.put("mode", "processing");
      await this.storage.setAlarm(Date.now());
    } catch (err) {
      console.error("Auto-signal cycle error:", err);
      await sendMessage(
        this.env,
        chatId,
        `⚠️ Auto-signal gagal ambil data pasar: ${escapeHtml(err.message)}. Coba lagi ${AUTO_INTERVAL_MS / 60000} menit berikutnya.`
      );
      const stillAutoAfterFail = await this.storage.get("autoMode");
      if (stillAutoAfterFail) {
        await this.storage.put("autoNextRun", { symbol, tradeMode, aiMode });
        await this.storage.setAlarm(Date.now() + AUTO_INTERVAL_MS);
      }
    }
  }

  async checkOpenSignalsAgainstPrice(symbol, chatId) {
    let entries;
    try {
      entries = await listSignals(this.env, chatId, "open");
    } catch (err) {
      console.error("Gagal ambil daftar sinyal open:", err);
      return;
    }

    const relevant = entries.filter((e) => e.symbol === symbol && e.slPrice != null && e.tpPrice != null);
    if (relevant.length === 0) return;

    let currentPrice;
    try {
      currentPrice = await fetchCurrentPrice(this.env, symbol);
    } catch (err) {
      console.error("Gagal ambil harga terkini buat cek TP/SL:", err);
      return;
    }

    for (const entry of relevant) {
      const isLong = entry.decision === "BUY";
      const hitTp = isLong ? currentPrice >= entry.tpPrice : currentPrice <= entry.tpPrice;
      const hitSl = isLong ? currentPrice <= entry.slPrice : currentPrice >= entry.slPrice;

      if (!hitTp && !hitSl) continue;

      const status = hitTp ? "win" : "loss";
      try {
        await markSignalResult(this.env, entry.id, status);
        await sendMessage(
          this.env,
          chatId,
          hitTp
            ? `🤖✅ <b>Auto-tandai: TP Kena (Menang)</b>\nSinyal ${entry.symbol} ${entry.decision} (${new Date(entry.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB) — harga sekarang ${currentPrice}.`
            : `🤖❌ <b>Auto-tandai: SL Kena (Kalah)</b>\nSinyal ${entry.symbol} ${entry.decision} (${new Date(entry.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB) — harga sekarang ${currentPrice}.`
        );
      } catch (err) {
        console.error("Gagal auto-tandai sinyal:", err);
      }
    }
  }
}

/**
 * Ambil estimasi harga (Entry/SL/TP) dari teks final AI Penyimpul.
 *
 * Kenapa tidak sekadar "angka pertama setelah label": AI sering menulis
 * jarak dalam poin/persentase duluan (misal "Stop-Loss: 79.5 poin di atas
 * entry (≈ 63130)"), sementara harga ASLI-nya baru muncul di dalam kurung
 * setelah tanda "≈". Kalau langsung ambil angka pertama, yang ke-ambil
 * malah "79.5" (jarak poin), bukan harga sebenarnya. Jadi pola "≈ <angka>"
 * diprioritaskan dulu, baru fallback ke angka pertama setelah label kalau
 * pola itu tidak ditemukan (misal baris Skenario Entry yang biasanya
 * langsung sebut harga tanpa tanda "≈").
 */
/**
 * Deteksi keputusan final (BUY/SELL/WAIT) dari teks AI Penyimpul.
 *
 * AI kadang menulis "**Keputusan:** SELL" (markdown bold), bukan
 * "Keputusan: SELL" polos. Kalau di-regex langsung, tanda "**" yang nempel
 * pas di antara label dan nilainya bikin match GAGAL TOTAL (bukan cuma
 * kurang rapi) — akibatnya sinyal tidak ke-log DAN gambar chart bergaris
 * juga ikut tidak pernah dibuat, karena keduanya butuh decision yang valid.
 * Makanya "*" dibuang dulu sebelum di-match.
 */
export function detectDecision(text) {
  const plain = String(text).replace(/\*/g, "");
  const match = /Keputusan:\s*(BUY|SELL|WAIT)/i.exec(plain);
  return match ? match[1].toUpperCase() : null;
}

// Marker section lain yang jadi BATAS AKHIR window pencarian suatu label,
// supaya window milik 1 label (mis. "Stop-Loss") tidak nyerempet ke isi
// label lain (mis. "Take-Profit" atau "Probabilitas") yang kebetulan disebut
// tepat setelahnya dalam 160 karakter berikutnya.
const SECTION_BOUNDARY_RE = /(Manajemen\s*Risiko|Stop[\s\-–—]*Loss|Take[\s\-–—]*Profit|📈|Probabilitas)/i;

/**
 * Ambil angka harga yang mengikuti sebuah label (mis. "Stop-Loss", "Skenario
 * Entry") dari teks AI Penyimpul.
 *
 * @param {string} text - teks AI Penyimpul (sudah dibuang markdown "*"-nya).
 * @param {string} label - pola regex label, mis. "Stop[\\s\\-–—]*Loss".
 * @param {number|null} referencePrice - harga pasar terakhir (mis.
 *   dataPackage.lastPrice), dipakai sebagai "jangkar" untuk milih angka mana
 *   di dalam window yang paling masuk akal sebagai harga. Opsional — kalau
 *   tidak diisi/null, fungsi jalan pakai heuristik lama saja (lihat di bawah).
 *
 * KENAPA PAKAI referencePrice:
 * Sebelumnya fungsi ini nebak lewat posisi kurung/simbol "≈", tapi itu rapuh
 * karena gaya nulis AI berubah-ubah. Contoh bug nyata dari laporan user:
 * AI nulis "Stop-Loss: 62400 (≈1,5×ATR di bawah entry...)" — di sini "≈"
 * dipakai untuk rasio MULTIPLIER (1,5), bukan harga, tapi heuristik lama
 * nangkep "1,5" itu jadi "15" dan dikira harga SL (harusnya 62400, harga yang
 * sudah jelas-jelas ditulis PERSIS setelah label). Chart jadi salah total
 * (Entry 15 | TP 1 | SL 15 — semua angka rasio, bukan harga).
 *
 * Dengan referencePrice, sistem sekarang milih kandidat angka yang jaraknya
 * paling dekat ke harga pasar (dalam rentang wajar 0.5x–1.5x) — SL/TP/Entry
 * itu pasti dekat harga pasar, sedangkan angka rasio/multiplier (1.5, 2, 1:2)
 * jauh lebih kecil dan otomatis kefilter, apapun gaya nulis AI-nya.
 */
export function extractPriceAfterLabel(text, label, referencePrice = null) {
  const searchRe = new RegExp(label, "i");
  const labelExec = searchRe.exec(text);
  if (!labelExec) return null;

  const idx = labelExec.index;
  const afterLabelIdx = idx + labelExec[0].length;

  // Batasi window supaya berhenti sebelum section BERIKUTNYA (kalau ada),
  // bukan asal potong 160 karakter yang bisa nyerempet ke label lain.
  const rest = text.slice(afterLabelIdx, afterLabelIdx + 200);
  const boundary = SECTION_BOUNDARY_RE.exec(rest);
  const windowEnd = afterLabelIdx + (boundary ? boundary.index : Math.min(rest.length, 160));
  const window = text.slice(idx, windowEnd);

  // Prioritas 1 (paling robust, dipakai kalau referencePrice tersedia):
  // kumpulkan SEMUA angka di window, lalu pilih yang paling dekat ke harga
  // pasar terakhir, asal masih dalam rentang wajar (0.5x-1.5x).
  if (referencePrice != null && referencePrice > 0) {
    const numberRe = /[\d][\d.,\s]*\d|\d/g;
    const candidates = [];
    let m;
    while ((m = numberRe.exec(window)) !== null) {
      const val = parsePriceString(m[0]);
      if (val != null) candidates.push(val);
    }
    const inRange = candidates.filter((c) => c >= referencePrice * 0.5 && c <= referencePrice * 1.5);
    if (inRange.length > 0) {
      inRange.sort((a, b) => Math.abs(a - referencePrice) - Math.abs(b - referencePrice));
      return inRange[0];
    }
  }

  // Prioritas 2 (fallback, dipakai kalau referencePrice tidak ada/tidak
  // ketemu kandidat masuk akal): angka di dalam kurung yang eksplisit
  // didahului "≈", misal "(≈ 63 200)" — konvensi lama AI Penyimpul untuk
  // menyatakan harga asli.
  const parenMatch = /\(\s*≈\s*([\d][\d.,\s]*\d|\d)/.exec(window);
  if (parenMatch) return parsePriceString(parenMatch[1]);

  // Prioritas 3: angka setelah "≈" tanpa kurung (mis. "≈ 63130" polos).
  const approxMatch = /≈\s*([\d][\d.,\s]*\d|\d)/.exec(window);
  if (approxMatch) return parsePriceString(approxMatch[1]);

  // Prioritas 4 (fallback terakhir): angka pertama yang cukup dekat setelah
  // label, dipakai kalau AI sama sekali tidak menulis simbol "≈".
  const fallbackMatch = new RegExp(`${label}[^\\d]{0,60}([\\d][\\d.,\\s]*\\d|\\d)`, "i").exec(window);
  return fallbackMatch ? parsePriceString(fallbackMatch[1]) : null;
}

function parsePriceString(raw) {
  const cleaned = raw.replace(/\s/g, "").replace(/,/g, "");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

const BIAS_LINE_RE = /Bias:\s*(Bullish|Bearish|Netral)\b/i;

export function tallyBias(opinions) {
  const tally = { bullish: 0, bearish: 0, netral: 0 };
  for (const op of opinions) {
    const plainOpinion = (op.opinion || "").replace(/\*/g, "");
    const match = BIAS_LINE_RE.exec(plainOpinion);
    const bias = match ? match[1].toLowerCase() : "netral";
    if (bias === "bullish") tally.bullish++;
    else if (bias === "bearish") tally.bearish++;
    else tally.netral++;
  }
  return tally;
}

function enforceBiasTally(text, tally, total) {
  const tallyStr = `(${tally.bullish} Bullish, ${tally.bearish} Bearish, ${tally.netral} Netral dari total ${total} AI spesialis)`;
  const probLineRe = /(📈\s*Probabilitas:[^\n]*)/i;

  if (probLineRe.test(text)) {
    return text.replace(probLineRe, (line) => {
      const withoutOldParenthetical = line.replace(/\([^)]*\)\s*$/, "").trim();
      return `${withoutOldParenthetical} ${tallyStr}`;
    });
  }

  return `${text}\n\n📈 Probabilitas: ${tallyStr}`;
}

async function safeEdit(env, chatId, messageId, text, replyMarkup) {
  try {
    await editMessageText(env, chatId, messageId, text, replyMarkup);
  } catch (err) {
    if (!String(err.message).includes("message is not modified")) {
      throw err;
    }
  }
}
