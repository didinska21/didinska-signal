import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findSwingPoints,
  detectOrderBlocks,
  detectFVG,
  detectBoS,
  detectLiquidityGrab,
  buildSmcSummary,
} from "../src/smc.js";

// Helper: bikin candle sintetis dari deskripsi {open, high, low, close}
function candle(open, high, low, close, time = 0, volume = 100) {
  return { openTime: time, open, high, low, close, volume, closeTime: time };
}

test("findSwingPoints: mendeteksi 1 swing high & 1 swing low yang jelas", () => {
  // Pola: naik ke puncak (index 3) lalu turun ke lembah (index 6) lalu naik lagi
  const candles = [
    candle(100, 101, 99, 100, 0),
    candle(100, 103, 100, 102, 1),
    candle(102, 106, 101, 105, 2),
    candle(105, 110, 104, 108, 3), // swing high di sini (high=110)
    candle(108, 108, 103, 104, 4),
    candle(104, 105, 98, 100, 5),
    candle(100, 101, 90, 95, 6), // swing low di sini (low=90)
    candle(95, 99, 94, 97, 7),
    candle(97, 102, 96, 100, 8),
  ];
  const { swingHighs, swingLows } = findSwingPoints(candles, 9, 2);
  assert.ok(swingHighs.some((s) => s.price === 110), "harus menemukan swing high 110");
  assert.ok(swingLows.some((s) => s.price === 90), "harus menemukan swing low 90");
});

test("detectOrderBlocks: candle bearish diikuti candle bullish kuat -> bullish order block", () => {
  const candles = [
    candle(100, 101, 95, 96, 0), // bearish, body kecil
    candle(96, 96, 90, 91, 1), // bearish lagi (jadi kandidat OB)
    candle(91, 115, 90, 114, 2), // bullish sangat kuat (body >> body sebelumnya)
    candle(114, 116, 112, 113, 3),
  ];
  const result = detectOrderBlocks(candles, 4);
  assert.ok(result.bullishOrderBlock, "harus terdeteksi bullish order block");
  assert.equal(result.bullishOrderBlock.high, 96);
  assert.equal(result.bullishOrderBlock.low, 90);
});

test("detectOrderBlocks: tidak ada pola kuat -> null untuk keduanya", () => {
  const candles = [
    candle(100, 101, 99, 100.5, 0),
    candle(100.5, 101.5, 99.5, 101, 1),
    candle(101, 102, 100, 101.5, 2),
  ];
  const result = detectOrderBlocks(candles, 3);
  assert.equal(result.bullishOrderBlock, null);
  assert.equal(result.bearishOrderBlock, null);
});

test("detectFVG: gap naik antara candle 1 dan candle 3 -> bullish FVG", () => {
  const candles = [
    candle(100, 102, 99, 101, 0), // high = 102
    candle(101, 108, 100, 107, 1), // candle tengah (lonjakan)
    candle(107, 110, 105, 109, 2), // low = 105, > high candle pertama (102) -> gap
  ];
  const gaps = detectFVG(candles, 3);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].type, "bullish");
  assert.equal(gaps[0].top, 105);
  assert.equal(gaps[0].bottom, 102);
});

test("detectFVG: tidak ada gap -> array kosong", () => {
  const candles = [
    candle(100, 102, 99, 101, 0),
    candle(101, 103, 100, 102, 1),
    candle(102, 104, 101, 103, 2),
  ];
  const gaps = detectFVG(candles, 3);
  assert.equal(gaps.length, 0);
});

test("detectBoS: close menembus swing high sebelumnya -> Break of Structure Bullish", () => {
  const swings = {
    swingHighs: [{ index: 0, price: 100, time: 0 }],
    swingLows: [],
  };
  const candles = [candle(95, 105, 94, 104, 0)]; // close (104) > swing high (100)
  const events = detectBoS(candles, swings);
  assert.ok(events.some((e) => e.type === "Break of Structure (Bullish)"));
});

test("detectBoS: tidak ada swing yang ditembus -> array kosong", () => {
  const swings = {
    swingHighs: [{ index: 0, price: 200, time: 0 }],
    swingLows: [{ index: 0, price: 50, time: 0 }],
  };
  const candles = [candle(95, 105, 94, 100, 0)]; // close 100, di antara 50 dan 200
  const events = detectBoS(candles, swings);
  assert.equal(events.length, 0);
});

test("detectLiquidityGrab: wick tembus resistance tapi close kembali di bawahnya", () => {
  const swings = {
    swingHighs: [{ index: 0, price: 100, time: 0 }],
    swingLows: [],
  };
  const candles = [candle(98, 105, 97, 99, 0)]; // high(105) > 100, close(99) < 100
  const events = detectLiquidityGrab(candles, swings, 1);
  assert.ok(events.some((e) => e.type.includes("Liquidity Grab di atas resistance")));
});

test("buildSmcSummary: integrasi semua deteksi tanpa error, struktur lengkap", () => {
  const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10 + (i % 7 === 0 ? 8 : 0));
  const candles = closes.map((c, i) =>
    candle(c, c + 2, c - 2, c + (Math.random() - 0.5), i)
  );
  const summary = buildSmcSummary(candles, 60);

  assert.ok(Array.isArray(summary.recentSwingHighs));
  assert.ok(Array.isArray(summary.recentSwingLows));
  assert.ok(Array.isArray(summary.fairValueGaps));
  assert.ok(Array.isArray(summary.breakOfStructure));
  assert.ok(Array.isArray(summary.liquidityGrabs));
  assert.ok("bullishOrderBlock" in summary);
  assert.ok("bearishOrderBlock" in summary);
});
