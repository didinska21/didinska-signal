/**
 * Deteksi Fibonacci Retracement (arah otomatis) + pola Quasimodo (QM) dari
 * data candle mentah. Dipakai khusus untuk mode analisis "Fibo & QM".
 *
 * CATATAN PENTING (sama seperti smc.js): ini HEURISTIK sederhana berbasis
 * swing high/low, bukan deteksi pola "resmi" yang presisi institusional.
 * Tujuannya kasih konteks terstruktur ke AI, bukan sinyal pasti — AI yang
 * menerima data ini tetap perlu menilai kewajarannya.
 */
import { findSwingPoints } from "./smc.js";

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/**
 * Tarik Fibonacci Retracement OTOMATIS berdasarkan swing high & swing low
 * TERBARU (bukan lookback tetap seperti fibonacciRetracement() di
 * indicators.js). Arahnya ditentukan dari mana yang lebih baru:
 *
 * - Kalau swing HIGH lebih baru (harga baru saja naik) -> anggap sedang
 *   dalam potensi retracement TURUN. Level 0 = swing high (titik akhir/
 *   terbaru), Level 1 = swing low (titik awal/lebih lama).
 * - Kalau swing LOW lebih baru (harga baru saja turun) -> anggap sedang
 *   dalam potensi retracement NAIK. Level 0 = swing low (titik akhir/
 *   terbaru), Level 1 = swing high (titik awal/lebih lama).
 *
 * Formula umum (berlaku utk kedua arah):
 *   level(ratio) = swingEnd - (swingEnd - swingStart) * ratio
 * (swingEnd = titik lebih baru/level 0, swingStart = titik lebih lama/level 1)
 *
 * Contoh tervalidasi (uptrend, retracement turun): swingEnd(high)=4179.66,
 * swingStart(low)=4065.43 -> level(0.236) = 4179.66 - 114.23*0.236 = 4152.70.
 */
export function buildDirectionalFibonacci(candles, lookback = 60, strength = 2) {
  if (!candles || candles.length < strength * 2 + 3) return null;

  const { swingHighs, swingLows } = findSwingPoints(candles, lookback, strength);

  let highPoint = swingHighs[swingHighs.length - 1] || null;
  let lowPoint = swingLows[swingLows.length - 1] || null;

  // Fallback kalau salah satu (atau keduanya) tidak ketemu swing point yang
  // valid dalam lookback: pakai high/low ekstrem mentah dalam lookback yang
  // sama, biar fungsi tetap kasih hasil (walau kurang "presisi" swing-nya).
  if (!highPoint || !lowPoint) {
    const slice = candles.slice(-lookback);
    if (slice.length < 2) return null;
    let maxIdx = 0;
    let minIdx = 0;
    for (let i = 1; i < slice.length; i++) {
      if (slice[i].high > slice[maxIdx].high) maxIdx = i;
      if (slice[i].low < slice[minIdx].low) minIdx = i;
    }
    if (!highPoint) highPoint = { index: maxIdx, price: slice[maxIdx].high, time: slice[maxIdx].openTime };
    if (!lowPoint) lowPoint = { index: minIdx, price: slice[minIdx].low, time: slice[minIdx].openTime };
  }

  const highIsMoreRecent = highPoint.index >= lowPoint.index;
  const endPoint = highIsMoreRecent ? highPoint : lowPoint; // level 0
  const startPoint = highIsMoreRecent ? lowPoint : highPoint; // level 1
  const direction = highIsMoreRecent ? "retracement_turun" : "retracement_naik";

  const levels = {};
  for (const ratio of FIB_RATIOS) {
    levels[ratio] = endPoint.price - (endPoint.price - startPoint.price) * ratio;
  }

  return {
    direction, // "retracement_turun" (abis naik, cari support koreksi) | "retracement_naik" (abis turun, cari resistance koreksi)
    swingEnd: { price: endPoint.price, time: endPoint.time }, // level 0
    swingStart: { price: startPoint.price, time: startPoint.time }, // level 1
    levels, // { "0": harga, "0.236": harga, ..., "1": harga }
  };
}

/**
 * Deteksi pola Quasimodo (QM) — pola reversal 3 titik struktur (dikenal
 * juga sebagai "Over and Under pattern"):
 *
 * QM BULLISH (potensi reversal naik):
 *   P1 (swing low) -> P2 (swing high) -> P3 (swing low LEBIH RENDAH dari P1,
 *   ini "head"/liquidity grab ke bawah) -> lalu harga rally, KALAU berhasil
 *   tembus balik ke atas level P2 ("neckline"), itu konfirmasi reversal.
 *   Level P2 (neckline) jadi zona entry potensial (area retest setelah breakout).
 *
 * QM BEARISH (potensi reversal turun): kebalikannya —
 *   P1 (swing high) -> P2 (swing low) -> P3 (swing high LEBIH TINGGI dari P1,
 *   "head" liquidity grab ke atas) -> konfirmasi kalau harga tembus balik ke
 *   bawah level P2 (neckline).
 *
 * Cari mulai dari P1 PALING BARU (scan mundur) supaya yang dikembalikan
 * adalah pola paling relevan/terkini, bukan yang tertua dalam lookback.
 * Return null kalau tidak ada pola valid dalam lookback.
 */
export function detectQuasimodo(candles, lookback = 80, strength = 2) {
  if (!candles || candles.length < strength * 2 + 3) return null;

  const slice = candles.slice(-lookback);
  const { swingHighs, swingLows } = findSwingPoints(candles, lookback, strength);

  const merged = [
    ...swingHighs.map((s) => ({ ...s, type: "high" })),
    ...swingLows.map((s) => ({ ...s, type: "low" })),
  ].sort((a, b) => a.index - b.index);

  for (let i = merged.length - 3; i >= 0; i--) {
    const p1 = merged[i];

    if (p1.type === "low") {
      const p2 = merged.slice(i + 1).find((p) => p.type === "high");
      if (!p2) continue;
      const p2Pos = merged.indexOf(p2);
      const p3 = merged.slice(p2Pos + 1).find((p) => p.type === "low" && p.price < p1.price);
      if (!p3) continue;

      const confirmed = slice.slice(p3.index + 1).some((c) => c.close > p2.price);
      return {
        direction: "bullish",
        baseLow: { price: p1.price, time: p1.time },
        neckline: { price: p2.price, time: p2.time },
        head: { price: p3.price, time: p3.time },
        qmLevel: p2.price, // zona entry potensial (retest neckline)
        confirmed, // true = harga sudah tembus balik ke atas neckline (breakout terkonfirmasi)
      };
    }

    if (p1.type === "high") {
      const p2 = merged.slice(i + 1).find((p) => p.type === "low");
      if (!p2) continue;
      const p2Pos = merged.indexOf(p2);
      const p3 = merged.slice(p2Pos + 1).find((p) => p.type === "high" && p.price > p1.price);
      if (!p3) continue;

      const confirmed = slice.slice(p3.index + 1).some((c) => c.close < p2.price);
      return {
        direction: "bearish",
        baseHigh: { price: p1.price, time: p1.time },
        neckline: { price: p2.price, time: p2.time },
        head: { price: p3.price, time: p3.time },
        qmLevel: p2.price,
        confirmed,
      };
    }
  }

  return null;
}

/** Gabungkan Fibonacci arah-otomatis + deteksi QM jadi 1 ringkasan siap kirim ke AI */
export function buildFiboQmSummary(candles, lookback = 60) {
  return {
    fibonacci: buildDirectionalFibonacci(candles, lookback),
    quasimodo: detectQuasimodo(candles, Math.max(lookback, 80)),
  };
}
