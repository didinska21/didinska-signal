/**
 * Orkestrator data pasar: gabungkan candle (Binance/Bybit) + semua indikator
 * + SMC + pivot points + data makro jadi 1 paket JSON, siap dikirim sebagai
 * konteks ke tiap AI spesialis (kecuali AI Price Action yang pakai foto).
 */
import { fetchKlines } from "./binance.js";
import { buildIndicatorSummary } from "./indicators.js";
import { buildSmcSummary } from "./smc.js";
import { buildMacroSummary } from "./macroData.js";
import { pivotPoints } from "./indicators.js";

// Interval "primer" (analisis utama) & "HTF" (higher timeframe, buat cek MTF alignment)
// per mode trading. Lihat menus.js untuk tfHint yang ditampilkan ke user.
const TIMEFRAME_CONFIG = {
  scalping: { primary: "5m", htf: "1h" },
  daytrade: { primary: "15m", htf: "4h" },
  swing: { primary: "4h", htf: "1d" },
};

const CANDLE_LIMIT = 300; // cukup untuk EMA200

export function normalizeSymbol(rawSymbol) {
  return rawSymbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function buildMarketDataPackage(symbol, tradeMode) {
  const tf = TIMEFRAME_CONFIG[tradeMode] || TIMEFRAME_CONFIG.scalping;

  const [primaryCandles, htfCandles, dailyCandles] = await Promise.all([
    fetchKlines(symbol, tf.primary, CANDLE_LIMIT),
    fetchKlines(symbol, tf.htf, CANDLE_LIMIT),
    fetchKlines(symbol, "1d", 3),
  ]);

  const primaryIndicators = buildIndicatorSummary(primaryCandles);
  const htfIndicators = buildIndicatorSummary(htfCandles);
  const smc = buildSmcSummary(primaryCandles, 60);

  // Candle terakhir di array adalah hari ini (mungkin belum tutup),
  // jadi pivot point pakai candle SEBELUMNYA (hari kemarin, sudah closed).
  const prevDailyCandle = dailyCandles[dailyCandles.length - 2] || dailyCandles[0];
  const pivot = pivotPoints(prevDailyCandle);

  const macro = await buildMacroSummary();

  return {
    symbol,
    tradeMode,
    primaryInterval: tf.primary,
    htfInterval: tf.htf,
    lastPrice: primaryCandles[primaryCandles.length - 1].close,
    primary: { interval: tf.primary, indicators: primaryIndicators },
    htf: { interval: tf.htf, indicators: htfIndicators },
    pivot,
    smc,
    macro,
  };
}
