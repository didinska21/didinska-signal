import { handleUpdate } from "./handlers/router.js";
import { sendMessage } from "./telegram.js";
import { escapeHtml } from "./htmlUtil.js";
import { markSignalResult } from "./signalLog.js";

export { SessionDO } from "./session_do.js";
export { SignalLogDO } from "./signal_log_do.js";
export { Mt5BridgeDO } from "./mt5_bridge_do.js";

/**
 * Cek header X-Bridge-Secret cocok dengan env.MT5_BRIDGE_SECRET.
 * Endpoint /mt5-bridge/* ini dipanggil oleh mt5_bridge.py (jalan di
 * laptop/VPS kamu), BUKAN dari Telegram — jadi butuh proteksi terpisah
 * dari TELEGRAM_WEBHOOK_SECRET supaya orang lain tidak bisa nge-push
 * candle palsu atau nyolong hasil sinyal lewat endpoint ini.
 */
function isAuthorizedBridge(request, env) {
  if (!env.MT5_BRIDGE_SECRET) return true; // tidak di-set = terbuka (tidak disarankan, sama seperti ALLOWED_CHAT_IDS)
  return request.headers.get("X-Bridge-Secret") === env.MT5_BRIDGE_SECRET;
}

function getMt5Stub(env, symbol) {
  const id = env.MT5_BRIDGE_DO.idFromName(symbol);
  return env.MT5_BRIDGE_DO.get(id);
}

async function handleMt5BridgeRequest(request, env, pathname) {
  if (!isAuthorizedBridge(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // --- Bridge push candle terbaru: POST /mt5-bridge/candles ---
  if (pathname === "/mt5-bridge/candles" && request.method === "POST") {
    const body = await request.json();
    const { symbol, interval, candles } = body;
    if (!symbol || !interval || !Array.isArray(candles)) {
      return Response.json({ ok: false, error: "symbol/interval/candles wajib diisi" }, { status: 400 });
    }
    const stub = getMt5Stub(env, symbol);
    const res = await stub.fetch("https://mt5-bridge/pushCandles", {
      method: "POST",
      body: JSON.stringify({ interval, candles }),
    });
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  }

  // --- Bridge polling sinyal yang perlu dieksekusi: GET /mt5-bridge/signal?symbol=XAUUSD ---
  if (pathname === "/mt5-bridge/signal" && request.method === "GET") {
    const url = new URL(request.url);
    const symbol = url.searchParams.get("symbol");
    if (!symbol) return Response.json({ ok: false, error: "parameter symbol wajib diisi" }, { status: 400 });
    const stub = getMt5Stub(env, symbol);
    const res = await stub.fetch("https://mt5-bridge/pollSignal");
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  }

  // --- Bridge lapor status akun (balance/equity/posisi terbuka), dipakai
  // buat kontrol risiko mode otonom: POST /mt5-bridge/status ---
  if (pathname === "/mt5-bridge/status" && request.method === "POST") {
    const body = await request.json();
    const { symbol, balance, equity, openPositionTicket } = body;
    if (!symbol) return Response.json({ ok: false, error: "symbol wajib diisi" }, { status: 400 });
    const stub = getMt5Stub(env, symbol);
    const res = await stub.fetch("https://mt5-bridge/reportStatus", {
      method: "POST",
      body: JSON.stringify({ balance, equity, openPositionTicket }),
    });
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  }

  // --- Bridge lapor hasil eksekusi: POST /mt5-bridge/execution ---
  if (pathname === "/mt5-bridge/execution" && request.method === "POST") {
    const body = await request.json();
    const { symbol, signalId, chatId, status, ticket, fillPrice, message, strategy } = body;
    if (!symbol || !signalId) {
      return Response.json({ ok: false, error: "symbol/signalId wajib diisi" }, { status: 400 });
    }
    const stub = getMt5Stub(env, symbol);
    const res = await stub.fetch("https://mt5-bridge/reportExecution", {
      method: "POST",
      body: JSON.stringify({ signalId, status, ticket, fillPrice, message }),
    });

    // Notifikasi ke user Telegram tentang hasil eksekusi (best-effort, tidak
    // menggagalkan response ke bridge kalau notifikasi gagal terkirim).
    if (chatId) {
      try {
        const strategyLabel = strategy === "s2" ? " (Strategi 2)" : "";
        const text =
          status === "filled"
            ? `✅ <b>Order tereksekusi di MT5${strategyLabel}</b>\nSimbol: ${escapeHtml(symbol)}\nTicket: ${escapeHtml(String(ticket ?? "-"))}\nHarga fill: ${escapeHtml(String(fillPrice ?? "-"))}`
            : `❌ <b>Order GAGAL dieksekusi di MT5${strategyLabel}</b>\nSimbol: ${escapeHtml(symbol)}\nAlasan: ${escapeHtml(message || "tidak diketahui")}`;
        await sendMessage(env, chatId, text);
      } catch (err) {
        console.error("Gagal kirim notifikasi hasil eksekusi MT5:", err);
      }
    }

    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  }

  // --- Bridge lapor force-close otomatis: POST /mt5-bridge/forceclose ---
  // Floating % dari balance nyentuh ambang, SEBELUM harga sempat sampai ke
  // level SL/TP asli sinyal (yang native, di order) -- berlaku SAMA untuk
  // Strategi 1 maupun Strategi 2.
  if (pathname === "/mt5-bridge/forceclose" && request.method === "POST") {
    const body = await request.json();
    const { symbol, ticket, reason, profitPct, closePrice, volume } = body;
    if (!symbol || ticket == null) {
      return Response.json({ ok: false, error: "symbol/ticket wajib diisi" }, { status: 400 });
    }
    const stub = getMt5Stub(env, symbol);
    const res = await stub.fetch("https://mt5-bridge/reportForceClose", {
      method: "POST",
      body: JSON.stringify({ ticket, reason, profitPct, closePrice, volume }),
    });
    const resultJson = await res.json();

    // Auto-catat hasil ke menu "📊 Riwayat & Akurasi" -- TANPA perlu user
    // tap tombol "TP Kena"/"SL Kena" manual. Penting buat auto-mode
    // (Strategi 1/2) yang jalan tanpa pengawasan -- kalau ini tidak ada,
    // statistik Riwayat & Akurasi cuma berisi sinyal manual yang sempat
    // ditandai user, tidak jujur buat menilai performa auto-signal.
    if (resultJson.signalId) {
      const status = (typeof profitPct === "number" ? profitPct : 0) > 0 ? "win" : "loss";
      try {
        await markSignalResult(env, resultJson.signalId, status);
      } catch (err) {
        console.error("Gagal auto-mark hasil sinyal (forceclose):", err);
      }
    }

    // Notifikasi ke user Telegram (best-effort, tidak menggagalkan response
    // ke bridge kalau notifikasi gagal terkirim) -- cuma bisa dikirim kalau
    // ticket ini ketemu pemetaan chatId-nya (lihat reportExecution/ticketMap
    // di mt5_bridge_do.js).
    if (resultJson.chatId) {
      try {
        const strategyLabel = resultJson.strategy === "s2" ? " (Strategi 2)" : "";
        const isTp = reason === "tp_pct";
        const pctLabel = typeof profitPct === "number" ? profitPct.toFixed(2) : String(profitPct ?? "-");

        const text =
          `${isTp ? "🔒✅ Profit Lock (floating % balance)" : "🔒❌ Cut Loss (floating % balance)"}${strategyLabel}\nSimbol: ${escapeHtml(symbol)}\nTicket: ${escapeHtml(String(ticket))}\n` +
          `Floating saat ditutup: ${escapeHtml(pctLabel)}% dari balance\n` +
          `Harga tutup: ${escapeHtml(String(closePrice ?? "-"))} | Lot: ${escapeHtml(String(volume ?? "-"))}\n\n` +
          `<i>Ditutup otomatis oleh bridge karena floating sudah mencapai ambang %, sebelum harga sempat sampai ke level SL/TP asli sinyal ini.</i>`;
        await sendMessage(env, resultJson.chatId, text);
      } catch (err) {
        console.error("Gagal kirim notifikasi force-close MT5:", err);
      }
    }

    return Response.json(resultJson, { status: res.status });
  }

  // --- Bridge lapor posisi yang TIBA-TIBA HILANG dari open positions
  // (dibanding siklus sebelumnya): POST /mt5-bridge/closed ---
  // Ini yang nangkep NATIVE SL/TP kena (kasus PALING UMUM -- order native
  // itu sendiri tidak pernah lapor apa-apa balik begitu tereksekusi di
  // sisi broker) dan penutupan manual dari terminal/HP. Beda dari
  // /mt5-bridge/forceclose yang khusus force-close % OLEH bridge sendiri.
  // Lihat check_closed_positions() di mt5_bridge.py.
  if (pathname === "/mt5-bridge/closed" && request.method === "POST") {
    const body = await request.json();
    const { symbol, ticket, profit, reasonLabel, closePrice, volume } = body;
    if (!symbol || ticket == null) {
      return Response.json({ ok: false, error: "symbol/ticket wajib diisi" }, { status: 400 });
    }
    const stub = getMt5Stub(env, symbol);
    const res = await stub.fetch("https://mt5-bridge/reportClosedPosition", {
      method: "POST",
      body: JSON.stringify({ ticket, profit, reasonLabel, closePrice, volume }),
    });
    const resultJson = await res.json();

    // Auto-catat hasil ke menu "📊 Riwayat & Akurasi" -- TANPA perlu user
    // tap tombol manual. Ini jalur PALING PENTING karena native SL/TP
    // adalah cara PALING UMUM posisi ditutup.
    if (resultJson.signalId) {
      const status = (typeof profit === "number" ? profit : 0) > 0 ? "win" : "loss";
      try {
        await markSignalResult(env, resultJson.signalId, status);
      } catch (err) {
        console.error("Gagal auto-mark hasil sinyal (closed):", err);
      }
    }

    if (resultJson.chatId) {
      try {
        const strategyLabel = resultJson.strategy === "s2" ? " (Strategi 2)" : " (Strategi 1)";
        const isWin = (typeof profit === "number" ? profit : 0) > 0;
        const profitLabel = typeof profit === "number" ? profit.toFixed(2) : String(profit ?? "-");

        const text =
          `${isWin ? "✅ Posisi Ditutup — PROFIT" : "❌ Posisi Ditutup — RUGI"}${strategyLabel}\n` +
          `Simbol: ${escapeHtml(symbol)}\nTicket: ${escapeHtml(String(ticket))}\n` +
          `P/L bersih: $${escapeHtml(profitLabel)}\nAlasan: ${escapeHtml(reasonLabel || "-")}\n` +
          `Harga tutup: ${escapeHtml(String(closePrice ?? "-"))} | Lot: ${escapeHtml(String(volume ?? "-"))}\n\n` +
          `<i>Otomatis tercatat ke 📊 Riwayat & Akurasi — tidak perlu tap tombol manual.</i>`;
        await sendMessage(env, resultJson.chatId, text);
      } catch (err) {
        console.error("Gagal kirim notifikasi posisi closed:", err);
      }
    }

    return Response.json(resultJson, { status: res.status });
  }

  return new Response("Not found", { status: 404 });
}

/**
 * Bot ini sekarang berbasis WEBHOOK (interaktif), bukan cron push otomatis.
 * Telegram akan mengirim setiap update (pesan/klik tombol) ke endpoint ini
 * secara real-time via POST request.
 *
 * Setup webhook cukup dilakukan SEKALI (lihat README) dengan membuka:
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL_WORKER_INI>/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
 *
 * KEAMANAN: kalau secret TELEGRAM_WEBHOOK_SECRET di-set, endpoint ini akan
 * menolak request yang tidak membawa header "X-Telegram-Bot-Api-Secret-Token"
 * yang cocok — supaya orang lain tidak bisa mengirim update palsu ke worker
 * ini walau tahu URL-nya (URL workers.dev gampang ditebak).
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/telegram-webhook") {
      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
          console.warn("Webhook ditolak: secret token tidak ada / tidak cocok.");
          return new Response("Unauthorized", { status: 401 });
        }
      }

      try {
        const update = await request.json();
        // waitUntil supaya Telegram cepat dapat response 200 OK,
        // sementara proses balasan tetap jalan di background.
        ctx.waitUntil(handleUpdate(env, update));
        return new Response("OK");
      } catch (err) {
        console.error("Webhook error:", err);
        return new Response("Error", { status: 500 });
      }
    }

    if (url.pathname.startsWith("/mt5-bridge/")) {
      return handleMt5BridgeRequest(request, env, url.pathname);
    }

    // Endpoint root: sekadar health-check manual, bukan trigger sinyal.
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Didinska Signal Bot is running. Webhook aktif di /telegram-webhook");
    }

    return new Response("Not found", { status: 404 });
  },
};
