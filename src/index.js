import { fetchKlines } from "./binance.js";
import { buildIndicatorSummary } from "./indicators.js";
import { generateSignal } from "./groq.js";
import { sendTelegramMessage } from "./telegram.js";

async function runSignalPipeline(env) {
  const symbol = env.SYMBOL || "BTCUSDT";
  const interval = env.INTERVAL || "15m";
  const limit = parseInt(env.CANDLE_LIMIT || "100", 10);

  // 1. Ambil data candle
  const candles = await fetchKlines(symbol, interval, limit);

  // 2. Hitung indikator
  const summary = buildIndicatorSummary(candles);

  // 3. Generate narasi sinyal via Groq
  const signalText = await generateSignal(env, symbol, summary);

  // 4. Format pesan final untuk Telegram
  const message = `<b>🔔 SINYAL FUTURES — ${symbol} (${interval})</b>\n\n${signalText}`;

  // 5. Kirim ke Telegram
  await sendTelegramMessage(env, message);

  return { symbol, interval, summary, signalText };
}

export default {
  // Dipanggil otomatis sesuai jadwal cron di wrangler.toml
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSignalPipeline(env));
  },

  // Endpoint HTTP manual untuk testing: buka URL worker langsung di browser
  async fetch(request, env, ctx) {
    try {
      const result = await runSignalPipeline(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  },
};
