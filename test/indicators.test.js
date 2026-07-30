import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ema,
  rsi,
  macd,
  atr,
  bollingerBands,
  stochastic,
  obv,
  pivotPoints,
  fibonacciRetracement,
  findSupportResistance,
  buildIndicatorSummary,
} from "../src/indicators.js";

// Helper: bikin candle sintetis dari array harga close (open=high=low=close,
// volume tetap) — cukup untuk uji logika, tidak perlu data real.
function makeCandles(closes, volumes) {
  return closes.map((c, i) => ({
    openTime: i,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: volumes ? volumes[i] : 100,
    closeTime: i,
  }));
}

test("ema: nilai pertama sama dengan input pertama", () => {
  const result = ema([10, 20, 30], 2);
  assert.equal(result[0], 10);
  assert.equal(result.length, 3);
});

test("ema: pada deret naik konstan, EMA ikut naik", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = ema(values, 3);
  // EMA harus monoton naik untuk deret input yang monoton naik
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i] > result[i - 1], `EMA[${i}] harus > EMA[${i - 1}]`);
  }
});

test("rsi: deret harga naik terus -> RSI sangat tinggi (tidak ada loss)", () => {
  const values = Array.from({ length: 20 }, (_, i) => 100 + i); // 100,101,...,119
  const value = rsi(values, 14);
  // avgLoss = 0 membuat rs di-set 100 (bukan Infinity) di kode, jadi hasilnya
  // sangat dekat 100 (≈99.01) tapi bukan tepat 100 — bukan bug, ini konsekuensi
  // desain penanganan divide-by-zero di rsi().
  assert.ok(value > 99, `RSI harus sangat tinggi saat tidak ada loss sama sekali, dapat ${value}`);
});

test("rsi: deret harga turun terus -> RSI mendekati 0 (tidak ada gain)", () => {
  const values = Array.from({ length: 20 }, (_, i) => 200 - i);
  const value = rsi(values, 14);
  assert.equal(value, 0);
});

test("macd: mengembalikan macd, signal, dan histogram sebagai angka", () => {
  const values = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 10);
  const result = macd(values);
  assert.equal(typeof result.macd, "number");
  assert.equal(typeof result.signal, "number");
  assert.equal(typeof result.histogram, "number");
  assert.ok(Number.isFinite(result.histogram));
});

test("atr: true range untuk candle flat (high=low=close) harus 0", () => {
  const candles = makeCandles([100, 100, 100, 100, 100]);
  const value = atr(candles, 3);
  assert.equal(value, 0);
});

test("bollingerBands: upper > mid > lower saat ada variasi harga", () => {
  const values = [10, 12, 11, 13, 15, 14, 16, 18, 17, 19, 20, 21, 19, 18, 17, 20, 22, 21, 23, 25];
  const bands = bollingerBands(values, 20);
  assert.ok(bands.upper > bands.mid);
  assert.ok(bands.mid > bands.lower);
});

test("bollingerBands: harga flat -> upper = mid = lower (stdDev = 0)", () => {
  const values = Array(20).fill(50);
  const bands = bollingerBands(values, 20);
  assert.equal(bands.upper, 50);
  assert.equal(bands.mid, 50);
  assert.equal(bands.lower, 50);
});

test("stochastic: highest === lowest -> %K default ke 50 (hindari divide by zero)", () => {
  const candles = makeCandles(Array(20).fill(100));
  const result = stochastic(candles, 14, 3);
  assert.equal(result.k, 50);
  assert.equal(result.d, 50);
});

test("obv: harga naik terus -> OBV naik & trend 'naik'", () => {
  const candles = makeCandles([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
  const result = obv(candles);
  assert.ok(result.value > 0);
  assert.equal(result.trend, "naik");
});

test("obv: harga turun terus -> OBV turun & trend 'turun'", () => {
  const candles = makeCandles([110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100]);
  const result = obv(candles);
  assert.ok(result.value < 0);
  assert.equal(result.trend, "turun");
});

test("pivotPoints: rumus pivot klasik sesuai standar (P, R1, S1)", () => {
  const prevCandle = { high: 110, low: 90, close: 100 };
  const result = pivotPoints(prevCandle);
  const expectedPivot = (110 + 90 + 100) / 3;
  assert.equal(result.pivot, expectedPivot);
  assert.equal(result.r1, 2 * expectedPivot - 90);
  assert.equal(result.s1, 2 * expectedPivot - 110);
});

test("fibonacciRetracement: level 0 = swing high, level 1 = swing low", () => {
  const candles = makeCandles([100, 120, 90, 110, 95, 130, 80]);
  const result = fibonacciRetracement(candles, 7);
  assert.equal(result.swingHigh, 130);
  assert.equal(result.swingLow, 80);
  assert.equal(result.levels[0], 130);
  assert.equal(result.levels[1], 80);
});

test("findSupportResistance: ambil high tertinggi & low terendah dalam lookback", () => {
  const candles = makeCandles([100, 105, 95, 110, 90, 108]);
  const result = findSupportResistance(candles, 6);
  assert.equal(result.resistance, 110);
  assert.equal(result.support, 90);
});

test("buildIndicatorSummary: integrasi semua indikator tanpa error, field lengkap", () => {
  const closes = Array.from({ length: 250 }, (_, i) => 100 + Math.sin(i / 10) * 5 + i * 0.05);
  const candles = makeCandles(closes);
  const summary = buildIndicatorSummary(candles);

  assert.equal(summary.lastClose, closes[closes.length - 1]);
  assert.equal(typeof summary.ema20, "number");
  assert.equal(typeof summary.ema50, "number");
  assert.equal(typeof summary.ema200, "number"); // >= 200 candle, jadi tidak null
  assert.equal(typeof summary.rsi14, "number");
  assert.ok(summary.macd);
  assert.ok(summary.bollinger);
  assert.ok(summary.stochastic);
  assert.ok(summary.obv);
  assert.ok(summary.fibonacci);
});

test("buildIndicatorSummary: ema200 null kalau candle < 200", () => {
  const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
  const candles = makeCandles(closes);
  const summary = buildIndicatorSummary(candles);
  assert.equal(summary.ema200, null);
});
