import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDirectionalFibonacci, detectQuasimodo } from "../src/fiboQm.js";

/** Helper: bikin candle sintetis dari daftar harga close (open/high/low = close, biar simpel) */
function makeCandles(closes, startTime = 1000, stepMs = 60000) {
  return closes.map((c, i) => ({
    openTime: startTime + i * stepMs,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 100,
    closeTime: startTime + i * stepMs,
  }));
}

test("buildDirectionalFibonacci: uptrend (swing high lebih baru) -> retracement_turun, level 0 = high", () => {
  // Naik dari 100 (low) ke 200 (high), swing low duluan lalu swing high di akhir.
  const closes = [150, 140, 130, 120, 110, 100, 110, 130, 150, 170, 190, 200, 195, 190];
  const candles = makeCandles(closes);
  const result = buildDirectionalFibonacci(candles, 60, 2);

  assert.ok(result, "harus dapat hasil (bukan null)");
  assert.equal(result.direction, "retracement_turun");
  assert.equal(result.swingEnd.price, 200);
  assert.equal(result.swingStart.price, 100);
  assert.equal(result.levels["0"], 200);
  assert.equal(result.levels["1"], 100);
  assert.equal(result.levels["0.5"], 150);
});

test("buildDirectionalFibonacci: downtrend (swing low lebih baru) -> retracement_naik, level 0 = low", () => {
  // Turun dari 200 (high) ke 100 (low), swing high duluan lalu swing low di akhir.
  const closes = [150, 160, 170, 180, 190, 200, 190, 170, 150, 130, 110, 100, 105, 110];
  const candles = makeCandles(closes);
  const result = buildDirectionalFibonacci(candles, 60, 2);

  assert.ok(result);
  assert.equal(result.direction, "retracement_naik");
  assert.equal(result.swingEnd.price, 100);
  assert.equal(result.swingStart.price, 200);
  assert.equal(result.levels["0"], 100);
  assert.equal(result.levels["1"], 200);
});

test("buildDirectionalFibonacci: contoh angka tervalidasi dari screenshot (0.236 = 4152.70)", () => {
  const closes = [
    4100, 4080, 4065.43, 4070, 4090, 4110, 4130, 4150, 4170, 4179.66, 4170, 4165,
  ];
  const candles = makeCandles(closes);
  const result = buildDirectionalFibonacci(candles, 60, 2);

  assert.ok(result);
  assert.equal(result.swingEnd.price, 4179.66);
  assert.equal(result.swingStart.price, 4065.43);
  const expected0236 = 4179.66 - (4179.66 - 4065.43) * 0.236;
  assert.ok(Math.abs(result.levels["0.236"] - expected0236) < 0.001);
  assert.ok(Math.abs(result.levels["0.236"] - 4152.7) < 0.05);
});

test("buildDirectionalFibonacci: data terlalu sedikit -> null", () => {
  const candles = makeCandles([100, 101]);
  assert.equal(buildDirectionalFibonacci(candles), null);
});

// Zigzag murni (high=low=close) supaya swing point ke-detect presisi lewat
// window strength=2: turun ke P1 (low) -> naik ke P2 (high) -> turun lebih
// dalam ke P3 (low, lebih rendah dari P1) -> naik breakout lewat P2 (MONOTON
// naik terus sampai akhir, sengaja, supaya breakout-nya sendiri TIDAK ikut
// kebaca sebagai swing high baru yang bisa nyerempet ke pola bearish yang
// "kebetulan" cocok juga dari titik neckline yang sama).
const BULLISH_QM_CLOSES = [
  150, 140, 130, 120, 110, 100, 110, 120, 130, 140, 150, // idx5 = P1 low(100), idx10 = P2/neckline high(150)
  140, 130, 120, 110, 90, // idx15 = P3 low(90), lebih rendah dari P1
  95, 105, 115, 130, 145, 160, 175, // breakout monoton naik, lewat neckline 150
];

test("detectQuasimodo: pola bullish QM valid (P1 low -> P2 high -> P3 low lebih rendah -> breakout balik)", () => {
  const candles = makeCandles(BULLISH_QM_CLOSES);
  const result = detectQuasimodo(candles, 80, 2);

  assert.ok(result, "harus terdeteksi pola QM");
  assert.equal(result.direction, "bullish");
  assert.equal(result.qmLevel, 150);
  assert.equal(result.confirmed, true);
});

// Mirror sempurna dari data bullish (dibalik terhadap 250 supaya arah kebalik)
const BEARISH_QM_CLOSES = BULLISH_QM_CLOSES.map((v) => 250 - v);

test("detectQuasimodo: pola bearish QM valid (mirror dari bullish)", () => {
  const candles = makeCandles(BEARISH_QM_CLOSES);
  const result = detectQuasimodo(candles, 80, 2);

  assert.ok(result, "harus terdeteksi pola QM");
  assert.equal(result.direction, "bearish");
  assert.equal(result.qmLevel, 100); // 250 - 150 (neckline)
  assert.equal(result.confirmed, true);
});

test("detectQuasimodo: belum breakout balik -> confirmed false (pola masih 'forming')", () => {
  // Sama seperti data bullish, tapi dipotong SEBELUM breakout terjadi.
  const closes = BULLISH_QM_CLOSES.slice(0, 18); // berhenti di idx17 (115), belum tembus neckline 150
  const candles = makeCandles(closes);
  const result = detectQuasimodo(candles, 80, 2);

  assert.ok(result, "pola P1-P2-P3 harus tetap kedetek walau belum breakout");
  assert.equal(result.confirmed, false);
});

test("detectQuasimodo: data flat/tanpa pola jelas -> null", () => {
  const candles = makeCandles(Array(20).fill(100));
  const result = detectQuasimodo(candles, 80, 2);
  assert.equal(result, null);
});

test("detectQuasimodo: data terlalu sedikit -> null", () => {
  const candles = makeCandles([100, 101]);
  assert.equal(detectQuasimodo(candles), null);
});
