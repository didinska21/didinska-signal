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
import { getAnalystsForMode, PILLAR_MAP } from "./analysts.js";
import { mainMenuKeyboard, signalResultKeyboard } from "./menus.js";
import { escapeHtml, formatTelegramHtml } from "./htmlUtil.js";
import { logSignal, listSignals, markSignalResult } from "./signalLog.js";
import { buildMarketDataPackage } from "./marketData.js";
import { fetchCurrentPrice, isMt5Symbol } from "./marketSource.js";
import { buildSignalChartImage } from "./ChartImage.js";
import { enqueueMt5Execution, checkMt5AutonomousGuardrails, getMt5RiskSnapshot, checkMt5LayerGuardrails, getMt5LayerSnapshot } from "./mt5Exec.js";

const AUTO_INTERVAL_MS = 10 * 60 * 1000; // 10 menit

const STEP_DELAY_MS = 1800; // jeda antar "AI" biar kelihatan seperti proses satu-satu

// Lot default untuk eksekusi MANUAL ke MT5 (demo) — dipakai waktu user
// SENDIRI klik tombol "Signal Trade" di Telegram, jadi tetap fixed-lot
// sederhana (bukan position sizing % risiko). Bisa dioverride lewat env var
// MT5_DEFAULT_LOT. Jalur OTONOM (/auto XAUUSD) TIDAK memakai ini lagi — lot
// di jalur itu dihitung dinamis dari % risiko, lihat RISK_SL_PCT &
// calcRiskBasedLot di bawah.
const DEFAULT_MT5_LOT = 0.01;

// --- Kontrol risiko mode OTONOM (khusus XAUUSD, siklus auto-signal tanpa
// pengawasan manual) ---
// Saklar utama: HARUS "true" secara eksplisit di env var, kalau tidak
// di-set sama sekali (atau apa pun selain "true"), siklus auto TIDAK AKAN
// PERNAH eksekusi ke MT5 — cuma kirim sinyal teks seperti sebelumnya. Ini
// supaya trading otonom beneran tidak nyala tanpa sengaja/tanpa sadar.
const AUTONOMOUS_XAUUSD_ENABLED = (env) => env.MT5_AUTONOMOUS_XAUUSD === "true";
const DEFAULT_MAX_TRADES_PER_DAY = 5;
const DEFAULT_MAX_DAILY_LOSS_PCT = 3;

// --- Position sizing dinamis berbasis % risiko (KHUSUS jalur OTONOM XAUUSD)
// ---
// Harga SL/TP TETAP dari AI Penyimpul, dikirim apa adanya sebagai native
// SL/TP order ke MT5 (tidak diubah) — jadi tetap jadi jaring pengaman utama
// walau bridge Python di laptop mati/disconnect. Yang dihitung ulang TIAP
// ENTRY cuma LOT-nya, dari BALANCE saat itu, supaya kalau SL asli itu
// sampai kena, kerugian selalu ≈ RISK_SL_PCT% dari balance -- bukan nominal
// $ tetap seperti lot fixed sebelumnya (yang persentasenya "geser" seiring
// balance naik/turun).
//
// RISK_TP_PCT dipakai bridge Python (mt5_bridge.py, check_and_force_close())
// untuk memantau floating profit/rugi posisi & force-close SEBELUM harga
// sempat sampai ke level SL/TP asli, kalau ambang % itu kena duluan. Jadi
// ada 2 lapis proteksi yang jalan paralel -- native SL/TP (berbasis harga)
// dan force-close berbasis % (berbasis floating $) -- siapa pun yang kena
// duluan yang menentukan penutupan posisi.
const RISK_SL_PCT = 1;
const RISK_TP_PCT = 2;
// Asumsi kontrak standar XAUUSD: 1.00 lot = 100 troy oz, jadi pergerakan
// harga $1 = $100/lot (≈$1 per 0.01 lot). Kalau broker kamu ternyata beda
// (jarang, tapi ada), sesuaikan angka ini.
const XAUUSD_CONTRACT_SIZE = 100;
const MT5_LOT_STEP = 0.01;
const MT5_MIN_LOT = 0.01;

/**
 * Hitung lot supaya KALAU harga sampai kena SL asli (dari AI Penyimpul),
 * kerugian ≈ RISK_SL_PCT% dari balance saat ini. Dibulatkan KE BAWAH ke
 * kelipatan MT5_LOT_STEP terdekat — lebih aman risiko sedikit di BAWAH
 * target daripada melebihi tanpa sengaja karena pembulatan.
 *
 * Return null kalau balance/jarak SL tidak valid (harusnya sudah ketapis
 * oleh validasi Entry/SL/TP logis sebelum fungsi ini dipanggil, tapi tetap
 * dijaga di sini juga demi keamanan).
 */
function calcRiskBasedLot(balance, entryPrice, slPrice) {
  const slDistance = Math.abs(entryPrice - slPrice);
  if (!(balance > 0) || !(slDistance > 0)) return null;

  const riskAmount = (RISK_SL_PCT / 100) * balance;
  const rawLot = riskAmount / (slDistance * XAUUSD_CONTRACT_SIZE);
  const flooredLot = Math.floor(rawLot / MT5_LOT_STEP) * MT5_LOT_STEP;
  const lot = Number(flooredLot.toFixed(2)); // buang residu floating-point

  return { lot, slDistance, riskAmount };
}

// --- Strategi 2: sampai MAX_LAYERS posisi INDEPENDEN sekaligus (bukan cuma
// 1), market order MURNI (TANPA native SL/TP -- keputusan sadar user,
// artinya posisi ini 100% bergantung bridge Python nyala & polling normal,
// tidak ada jaring pengaman di level broker). Tiap layer auto-close SENDIRI
// (tidak saling terkait) begitu floating-nya nyentuh +LAYER_TP_USD atau
// -LAYER_SL_USD -- FLAT dollar, BUKAN % dari balance seperti Strategi 1.
// TIDAK ada limit trade/hari atau circuit breaker rugi harian (beda dari
// Strategi 1), sesuai permintaan eksplisit user. Semua angka ini HARUS
// sinkron dengan mt5_bridge.py (MAGIC_NUMBER_LAYER/LAYER_TP_USD/
// LAYER_SL_USD) & mt5_bridge_do.js (MAX_LAYERS) -- kalau salah satu diubah,
// ubah juga yang lain.
const MAX_LAYERS = 10;
const LAYER_TP_USD = 2;
const LAYER_SL_USD = 1;
// Lot FIXED sama untuk semua layer (bukan dihitung dari % risiko seperti
// Strategi 1) -- bisa dioverride lewat env var MT5_LAYER_LOT.
const DEFAULT_LAYER_LOT = 0.01;

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
        const { chatId, symbol, tradeMode, aiMode, strategy } = await request.json();
        await this.storage.put("autoMode", true);
        await this.storage.put("autoChatId", chatId);
        await this.storage.put("autoNextRun", { symbol, tradeMode, aiMode, strategy: strategy || "s1" });
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

    const { chatId, messageId, aiMode, tradeMode, symbol, photos, dataPackage, step, opinions, strategy } = job;
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
      const pillarAlignment = computePillarAlignment(opinions, aiMode);
      const finalSignal = await summarizeSignals(this.env, opinions, tradeMode, symbol, biasTally, aiMode, pillarAlignment);
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
        // bridge, yaitu XAUUSD) — antre sinyal buat diambil & dieksekusi
        // bridge Python di laptop/VPS kamu. Dua jalur:
        //   (a) Manual (!job.isAuto) — user sendiri yang klik tombol
        //       Signal Trade di Telegram, jadi user sudah "mengawasi" saat
        //       itu. Guard yang berlaku: parsing SL/TP/Entry valid, & logika
        //       BUY/SELL masuk akal.
        //   (b) Otonom (job.isAuto) — sinyal dari siklus auto 10 menit,
        //       TANPA pengawasan user saat itu juga. Guard (a) tetap
        //       berlaku, DITAMBAH 3 lapis kontrol risiko (1 posisi
        //       terbuka, limit trade/hari, circuit breaker rugi harian),
        //       dan SEMUA itu hanya jalan kalau saklar MT5_AUTONOMOUS_XAUUSD
        //       di env di-set eksplisit ke "true".
        if (isMt5Symbol(symbol) && (!job.isAuto || AUTONOMOUS_XAUUSD_ENABLED(this.env))) {
          if (job.isAuto && strategy === "s2") {
            // --- Strategi 2: TIDAK butuh Entry/SL/TP sama sekali (levelnya
            // di teks AI cuma informasi teknikal) -- decision BUY/SELL saja
            // sudah cukup buat market order. TIDAK ada invalidReason gate
            // seperti Strategi 1/manual karena tidak ada harga yang perlu
            // divalidasi urutannya.
            const layerGuard = await checkMt5LayerGuardrails(this.env, symbol);

            if (!layerGuard.allowed) {
              await sendMessage(
                this.env,
                chatId,
                `🧱⛔ Sinyal ${decision} (Strategi 2) TIDAK dieksekusi: ${escapeHtml(layerGuard.reason)}`
              );
            } else {
              const lot = Number(this.env.MT5_LAYER_LOT) || DEFAULT_LAYER_LOT;
              try {
                await enqueueMt5Execution(this.env, symbol, {
                  signalId,
                  chatId,
                  decision,
                  strategy: "s2",
                  lot,
                });
                await sendMessage(
                  this.env,
                  chatId,
                  `🧱🔗 Sinyal ${decision} (Strategi 2, Layer) sudah diantre ke MT5 bridge.\nLot: ${lot} (fixed). Market order MURNI (tanpa native SL/TP) — layer ini auto-close SENDIRI begitu floating nyentuh +$${LAYER_TP_USD} (TP) atau -$${LAYER_SL_USD} (SL), dipantau bridge Python.\nLayer aktif setelah ini: ${layerGuard.openLayerCount + 1}/${MAX_LAYERS}.`
                );
              } catch (err) {
                console.error("Gagal antre eksekusi MT5 (layer):", err);
                await sendMessage(this.env, chatId, `⚠️ Strategi 2 gagal antre eksekusi MT5: ${escapeHtml(err.message)}`);
              }
            }
          } else {
          const invalidReason =
            entryPrice == null || slPrice == null || tpPrice == null
              ? "Entry/SL/TP gagal terbaca lengkap dari teks AI Penyimpul"
              : (decision === "BUY" && !(tpPrice > entryPrice && entryPrice > slPrice)) ||
                (decision === "SELL" && !(tpPrice < entryPrice && entryPrice < slPrice))
              ? `susunan Entry ${entryPrice} / SL ${slPrice} / TP ${tpPrice} tidak logis (untuk ${decision}, seharusnya ${
                  decision === "BUY" ? "TP > Entry > SL" : "TP < Entry < SL"
                })`
              : null;

          if (invalidReason) {
            await sendMessage(
              this.env,
              chatId,
              `⚠️ Sinyal ${decision}${job.isAuto ? " (Auto-Signal)" : ""}: ${invalidReason} — eksekusi otomatis ke MT5 DIBATALKAN demi keamanan.`
            );
          } else if (job.isAuto) {
            // Jalur otonom: cek 3 kontrol risiko dulu sebelum enqueue.
            const guard = await checkMt5AutonomousGuardrails(this.env, symbol, {
              maxTradesPerDay: Number(this.env.MT5_MAX_TRADES_PER_DAY) || DEFAULT_MAX_TRADES_PER_DAY,
              maxDailyLossPct: Number(this.env.MT5_MAX_DAILY_LOSS_PCT) || DEFAULT_MAX_DAILY_LOSS_PCT,
            });

            if (!guard.allowed) {
              await sendMessage(
                this.env,
                chatId,
                `🤖⛔ Sinyal ${decision} (Auto-Signal) TIDAK dieksekusi ke MT5: ${escapeHtml(guard.reason)}`
              );
            } else {
              // Lot DIHITUNG DINAMIS dari balance saat ini (bukan fixed lagi)
              // -- SL/TP harga TETAP dari AI Penyimpul, cuma lot-nya yang
              // disesuaikan supaya risiko ke SL asli ≈ RISK_SL_PCT% balance.
              const sizing = calcRiskBasedLot(guard.balance, entryPrice, slPrice);
              const slDistanceLabel = sizing ? sizing.slDistance.toFixed(2) : "?";
              const balanceLabel = typeof guard.balance === "number" ? guard.balance.toFixed(2) : "?";

              if (!sizing || sizing.lot < MT5_MIN_LOT) {
                await sendMessage(
                  this.env,
                  chatId,
                  `🤖⛔ Sinyal ${decision} (Auto-Signal) TIDAK dieksekusi ke MT5: lot hasil hitung risiko ${RISK_SL_PCT}% (balance $${balanceLabel}, jarak SL ${slDistanceLabel}) ada di bawah lot minimum ${MT5_MIN_LOT}. Modal kemungkinan terlalu kecil untuk jarak SL sinyal ini.`
                );
              } else {
                try {
                  await enqueueMt5Execution(this.env, symbol, {
                    signalId,
                    chatId,
                    decision,
                    entry: entryPrice,
                    sl: slPrice,
                    tp: tpPrice,
                    lot: sizing.lot,
                  });
                  await sendMessage(
                    this.env,
                    chatId,
                    `🤖🔗 Sinyal ${decision} (Auto-Signal) sudah diantre ke MT5 bridge.\nLot: ${sizing.lot} (≈${RISK_SL_PCT}% risiko = $${sizing.riskAmount.toFixed(2)} dari balance $${balanceLabel}, kalau SL asli kena).\nLapisan tambahan: force-close otomatis kalau floating duluan nyentuh +${RISK_TP_PCT}%/-${RISK_SL_PCT}% balance (jalan di bridge Python), sebelum harga sempat sampai level SL/TP asli sinyal ini.`
                  );
                } catch (err) {
                  console.error("Gagal antre eksekusi MT5 (auto):", err);
                  await sendMessage(this.env, chatId, `⚠️ Auto-Signal gagal antre eksekusi MT5: ${escapeHtml(err.message)}`);
                }
              }
            }
          } else {
            // Jalur manual: user sendiri yang minta, tidak perlu guardrail
            // risiko harian (itu khusus buat siklus tanpa pengawasan).
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
      }


      const codeBlock = buildSignalCodeBlock({
        symbol,
        decision,
        entryPrice,
        slPrice,
        tpPrice,
        pillarAlignment,
      });
      const finalMessageText = codeBlock
        ? `${codeBlock}\n${formatTelegramHtml(finalSignalFixed)}`
        : formatTelegramHtml(finalSignalFixed);

      await safeEdit(this.env, chatId, messageId, finalMessageText, resultKeyboard);

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
        await this.storage.put("autoNextRun", { symbol, tradeMode, aiMode, strategy });
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
        await this.storage.put("autoNextRun", { symbol, tradeMode, aiMode, strategy });
        await this.storage.setAlarm(Date.now() + AUTO_INTERVAL_MS);
      }
    }
  }

  async runAutoCycle({ symbol, tradeMode, aiMode, strategy }) {
    const stillAuto = await this.storage.get("autoMode");
    if (!stillAuto) return;

    const chatId = await this.storage.get("autoChatId");
    if (!chatId) return;

    await this.checkOpenSignalsAgainstPrice(symbol, chatId);

    // --- Skip siklus (TANPA ambil data pasar / panggil AI sama sekali)
    // kalau kondisi MT5 sudah "penuh" -- toh sinyal barunya bakal ditolak
    // guardrail juga nanti; jadi analisa AI + generate sinyal sekarang cuma
    // buang-buang limit API Groq. Beda syarat per strategi:
    //   Strategi 2: sudah pas MAX_LAYERS layer terbuka.
    //   Strategi 1 (default): masih ada 1 posisi terbuka.
    // Dicek pakai snapshot read-only (TIDAK increment counter apa pun).
    // Diam saja kalau di-skip (tidak kirim notifikasi tiap 10 menit ke
    // Telegram) supaya tidak spam -- cukup dijadwalkan ulang seperti biasa.
    if (isMt5Symbol(symbol)) {
      const isLayerStrategy = strategy === "s2";
      const full = isLayerStrategy
        ? (await getMt5LayerSnapshot(this.env, symbol)).openLayerCount >= MAX_LAYERS
        : Boolean((await getMt5RiskSnapshot(this.env, symbol)).openPositionTicket);

      if (full) {
        const stillAutoAfterSkip = await this.storage.get("autoMode");
        if (stillAutoAfterSkip) {
          await this.storage.put("autoNextRun", { symbol, tradeMode, aiMode, strategy });
          await this.storage.setAlarm(Date.now() + AUTO_INTERVAL_MS);
        }
        return;
      }
    }

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
        strategy: strategy || "s1",
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
        await this.storage.put("autoNextRun", { symbol, tradeMode, aiMode, strategy });
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

/**
 * Parse 1 angka harga dari potongan teks AI. Ada 2 gaya penulisan koma yang
 * SAMA-SAMA muncul dari AI Penyimpul (yang nulis Bahasa Indonesia):
 *   a) koma sebagai PEMISAH RIBUAN gaya Inggris, mis. "63,084" = 63084
 *      (sudah ditangani & di-tes sejak awal, lihat test/session_do.test.js)
 *   b) koma sebagai TITIK DESIMAL gaya Indonesia, mis. "4584,14" = 4584.14,
 *      "1,5" = 1.5 (kasus nyata yang bikin Entry/SL/TP XAUUSD ke-parse jadi
 *      "458414"/"15"/"1" — laporan user, screenshot Auto-Signal)
 * Dua gaya ini SECARA KEBETULAN bisa dibedakan dari jumlah digit di
 * belakang koma TERAKHIR: pemisah ribuan SELALU tepat 3 digit ("63,084"),
 * sedangkan AI ini nulis desimal harga/rasio 1-2 digit ("4584,14", "1,5").
 * Jadi: 3 digit di belakang koma -> ribuan (dibuang). Selain itu -> desimal
 * (diganti titik). Kalau ada TITIK dan KOMA sekaligus (mis. "1,234.5" atau
 * "4.584,14"), yang paling KANAN adalah desimal, sisanya ribuan (dibuang) —
 * tidak butuh tebak-tebakan jumlah digit lagi karena sudah eksplisit dari
 * urutannya. Kalau cuma titik (atau tanpa pemisah), dibiarkan apa adanya —
 * parseFloat native sudah benar, dan JANGAN diotak-atik pakai heuristik
 * jumlah-digit yang sama karena kripto lumrah punya harga 3+ desimal (mis.
 * altcoin "0.523") yang BUKAN pemisah ribuan.
 */
function parsePriceString(raw) {
  let cleaned = raw.replace(/\s/g, "");
  if (cleaned === "") return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    cleaned =
      lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".") // "4.584,14" -> "4584.14"
        : cleaned.replace(/,/g, ""); // "1,234.5" -> "1234.5"
  } else if (hasComma) {
    const lastComma = cleaned.lastIndexOf(",");
    const digitsAfterLastComma = cleaned.length - lastComma - 1;
    cleaned =
      digitsAfterLastComma === 3
        ? cleaned.replace(/,/g, "") // "63,084" -> "63084"
        : cleaned.slice(0, lastComma).replace(/,/g, "") + "." + cleaned.slice(lastComma + 1); // "4584,14" -> "4584.14"
  }
  // Cuma titik / tidak ada pemisah sama sekali -> dibiarkan apa adanya.

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

/**
 * Hitung keselarasan strategi "Konfluensi 3 Pilar" dari opini yang sudah
 * masuk, berdasarkan PILLAR_MAP di analysts.js (siapa AI nomor berapa jadi
 * pilar apa, per mode). SENGAJA dihitung di sini (kode biasa, bukan AI) —
 * supaya keselarasan pilar konsisten & tidak tergantung gaya tulis AI
 * Penyimpul. Kalau aiMode bukan "cepat"/"lengkap" (misal "fiboqm"), return
 * null (mode itu punya logika bobot sendiri, lihat FIBO_QM_WEIGHT_NOTE).
 */
export function computePillarAlignment(opinions, aiMode) {
  const map = PILLAR_MAP[aiMode];
  if (!map) return null;

  // opinions[i].label formatnya "AI <nomor> (<judul>)" — ambil nomornya.
  const biasByNumber = new Map();
  for (const op of opinions) {
    const numMatch = /^AI (\d+)/.exec(op.label || "");
    if (!numMatch) continue;
    const plainOpinion = (op.opinion || "").replace(/\*/g, "");
    const match = BIAS_LINE_RE.exec(plainOpinion);
    biasByNumber.set(Number(numMatch[1]), match ? match[1] : "Netral");
  }

  // Untuk tiap pilar (bisa terdiri dari >1 AI, misal Level Kunci di mode
  // Lengkap = AI #5 + #6): ambil bias MAYORITAS anggotanya. Kalau seri
  // (1 Bullish, 1 Bearish) -> pilar itu dianggap "Netral" (belum jelas).
  function pillarBias(numbers) {
    const biases = numbers.map((n) => biasByNumber.get(n)).filter(Boolean);
    if (biases.length === 0) return "Netral";
    const count = { Bullish: 0, Bearish: 0, Netral: 0 };
    for (const b of biases) count[b] = (count[b] || 0) + 1;
    if (count.Bullish > count.Bearish) return "Bullish";
    if (count.Bearish > count.Bullish) return "Bearish";
    return "Netral";
  }

  const pillars = {
    trend: pillarBias(map.trend),
    level: pillarBias(map.level),
    momentum: pillarBias(map.momentum),
  };

  const values = Object.values(pillars);
  const bullishCount = values.filter((v) => v === "Bullish").length;
  const bearishCount = values.filter((v) => v === "Bearish").length;

  let dominant = "Netral";
  let alignedCount = 0;
  if (bullishCount > bearishCount) {
    dominant = "Bullish";
    alignedCount = bullishCount;
  } else if (bearishCount > bullishCount) {
    dominant = "Bearish";
    alignedCount = bearishCount;
  } else {
    // Seri (termasuk 0-0-0 semua Netral) -> tidak ada dominasi arah jelas.
    alignedCount = 0;
  }

  return { alignedCount, dominant, pillars };
}

/**
 * Bangun block ringkasan sinyal ala "kode/terminal" (font monospace via
 * <pre>) untuk ditempel di ATAS teks penjelasan AI Penyimpul — Telegram
 * TIDAK mendukung syntax-highlight berwarna (baik di HP maupun sebagian
 * besar klien desktop), jadi "warna" di sini diwakili emoji + box border,
 * bukan warna asli. Dibangun dari angka yang SUDAH DIPARSING sistem
 * (entryPrice/slPrice/tpPrice), bukan dari teks bebas AI — supaya
 * formatnya selalu rapi & konsisten walau gaya tulis AI berubah-ubah.
 */
export function buildSignalCodeBlock({ symbol, decision, entryPrice, slPrice, tpPrice, pillarAlignment }) {
  if (!decision) return null;

  const decisionEmoji = decision === "BUY" ? "🟢" : decision === "SELL" ? "🔴" : "🟡";
  const lines = [`${decisionEmoji} ${symbol}  —  ${decision}`];

  const riskLines = [];
  if (entryPrice != null) riskLines.push(`Entry : ${entryPrice}`);
  if (slPrice != null) riskLines.push(`SL    : ${slPrice}  🔴`);
  if (tpPrice != null) riskLines.push(`TP    : ${tpPrice}  🟢`);
  if (entryPrice != null && slPrice != null && tpPrice != null) {
    const risk = Math.abs(entryPrice - slPrice);
    const reward = Math.abs(tpPrice - entryPrice);
    if (risk > 0) riskLines.push(`R:R   : 1 : ${(reward / risk).toFixed(2)}`);
  }
  // Cuma tambah garis pemisah + block risiko kalau memang ADA datanya --
  // mode WAIT tidak punya entry/SL/TP, jadi jangan tampilkan garis kosong.
  if (riskLines.length > 0) {
    lines.push("─────────────────────");
    lines.push(...riskLines);
  }

  if (pillarAlignment) {
    lines.push("─────────────────────");
    lines.push(`Pilar searah : ${pillarAlignment.alignedCount}/3 (${pillarAlignment.dominant})`);
  }

  return `<pre>${escapeHtml(lines.join("\n"))}</pre>`;
}

export function enforceBiasTally(text, tally, total) {
  const tallyStr = `(${tally.bullish} Bullish, ${tally.bearish} Bearish, ${tally.netral} Netral dari total ${total} AI spesialis)`;

  // Kadang AI (gpt-oss) nulis baris "📈 Probabilitas" LEBIH DARI SEKALI --
  // misal 1x normal di tengah jawaban + 1x lagi placeholder kosong dekat
  // kalimat penutup (kebingungan soal instruksi "akan ditambahkan otomatis
  // oleh sistem"), kadang juga dibungkus markdown **bold**. Supaya tidak
  // dobel di pesan final: cari SEMUA baris yang mengandung "📈" + kata
  // "Probabilitas" (case-insensitive, longgar soal markdown di sekitarnya),
  // ambil angka persentase dari kemunculan MANAPUN yang punya, buang semua
  // baris itu, lalu sisipkan SATU baris final bersih di posisi kemunculan
  // pertama.
  const lines = text.split("\n");
  const keptLines = [];
  let insertIndex = -1;
  let percentPart = "";

  for (const line of lines) {
    if (/📈/.test(line) && /probabilitas/i.test(line)) {
      if (insertIndex === -1) insertIndex = keptLines.length;
      if (!percentPart) {
        const found = /[±~]?\s*\d+(\.\d+)?\s*%/.exec(line);
        if (found) percentPart = found[0].trim();
      }
      continue; // baris ini dibuang, akan diganti 1 baris final di bawah
    }
    keptLines.push(line);
  }

  const canonicalLine = `📈 Probabilitas: ${percentPart ? `${percentPart} ` : ""}${tallyStr}`;

  if (insertIndex === -1) {
    return `${keptLines.join("\n")}\n\n${canonicalLine}`;
  }
  keptLines.splice(insertIndex, 0, canonicalLine);
  return keptLines.join("\n");
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
