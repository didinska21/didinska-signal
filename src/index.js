import { handleUpdate } from "./handlers/router.js";

export { SessionDO } from "./session_do.js";

/**
 * Bot ini sekarang berbasis WEBHOOK (interaktif), bukan cron push otomatis.
 * Telegram akan mengirim setiap update (pesan/klik tombol) ke endpoint ini
 * secara real-time via POST request.
 *
 * Setup webhook cukup dilakukan SEKALI (lihat README) dengan membuka:
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL_WORKER_INI>/telegram-webhook
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/telegram-webhook") {
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

    // Endpoint root: sekadar health-check manual, bukan trigger sinyal.
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Didinska Signal Bot is running. Webhook aktif di /telegram-webhook");
    }

    return new Response("Not found", { status: 404 });
  },
};
