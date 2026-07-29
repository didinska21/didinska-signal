/**
 * Kumpulan fungsi indikator teknikal ringan, ditulis manual (tanpa dependency)
 * agar tetap ringan dijalankan di Cloudflare Workers.
 */

export function ema(values, period) {
  const k = 2 / (period + 1);
  const result = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export function rsi(values, period = 14) {
  const gains = [];
  const losses = [];
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }

  const avgGain = average(gains.slice(0, period));
  const avgLoss = average(losses.slice(0, period));
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsiValues = [100 - 100 / (1 + rs)];

  let ag = avgGain;
  let al = avgLoss;
  for (let i = period; i < gains.length; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
    rs = al === 0 ? 100 : ag / al;
    rsiValues.push(100 - 100 / (1 + rs));
  }

  return rsiValues[rsiValues.length - 1]; // ambil nilai terakhir
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = ema(macdLine, signal);
  const histogram = macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];

  return {
    macd: macdLine[macdLine.length - 1],
    signal: signalLine[signalLine.length - 1],
    histogram,
  };
}

export function atr(candles, period = 14) {
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trueRanges.push(tr);
  }
  return average(trueRanges.slice(-period));
}

export function bollingerBands(values, period = 20, stdDevMult = 2) {
  const slice = values.slice(-period);
  const mid = average(slice);
  const variance = average(slice.map((v) => (v - mid) ** 2));
  const stdDev = Math.sqrt(variance);

  return {
    upper: mid + stdDev * stdDevMult,
    mid,
    lower: mid - stdDev * stdDevMult,
  };
}

/** Deteksi support & resistance sederhana dari swing high/low N candle terakhir */
export function findSupportResistance(candles, lookback = 30) {
  const slice = candles.slice(-lookback);
  const resistance = Math.max(...slice.map((c) => c.high));
  const support = Math.min(...slice.map((c) => c.low));
  return { support, resistance };
}

function average(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Hitung semua indikator sekaligus dari array candle, kembalikan ringkasan
 * yang siap dikirim sebagai konteks ke Groq.
 */
export function buildIndicatorSummary(candles) {
  const closes = candles.map((c) => c.close);
  const lastClose = closes[closes.length - 1];

  const ema20 = ema(closes, 20).at(-1);
  const ema50 = ema(closes, 50).at(-1);
  const rsi14 = rsi(closes, 14);
  const macdData = macd(closes);
  const atr14 = atr(candles, 14);
  const bb = bollingerBands(closes, 20);
  const sr = findSupportResistance(candles, 30);

  return {
    lastClose,
    ema20,
    ema50,
    rsi14,
    macd: macdData,
    atr14,
    bollinger: bb,
    support: sr.support,
    resistance: sr.resistance,
  };
}
