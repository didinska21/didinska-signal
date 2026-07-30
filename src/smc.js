/**
 * Deteksi Smart Money Concepts (SMC) dari data candle mentah.
 *
 * CATATAN PENTING: Ini adalah HEURISTIK (aturan sederhana berbasis harga),
 * bukan implementasi "resmi" SMC yang dipakai institusi. Tujuannya kasih
 * konteks tambahan ke AI, bukan sinyal pasti. AI yang menerima data ini
 * tetap perlu menilai relevansinya, bukan menelan mentah-mentah.
 */

/** Cari swing high & swing low (titik balik lokal) dalam N candle terakhir */
export function findSwingPoints(candles, lookback = 50, strength = 2) {
  const slice = candles.slice(-lookback);
  const swingHighs = [];
  const swingLows = [];

  for (let i = strength; i < slice.length - strength; i++) {
    const window = slice.slice(i - strength, i + strength + 1);
    const current = slice[i];

    if (current.high === Math.max(...window.map((c) => c.high))) {
      swingHighs.push({ index: i, price: current.high, time: current.openTime });
    }
    if (current.low === Math.min(...window.map((c) => c.low))) {
      swingLows.push({ index: i, price: current.low, time: current.openTime });
    }
  }

  return { swingHighs, swingLows };
}

/**
 * Order Block sederhana: candle bearish TERAKHIR sebelum lonjakan bullish kuat
 * (atau sebaliknya) — area yang sering jadi acuan "smart money" masuk.
 * Diambil maksimal 2 order block terbaru (1 bullish, 1 bearish) dalam lookback.
 */
export function detectOrderBlocks(candles, lookback = 50) {
  const slice = candles.slice(-lookback);
  let bullishOB = null;
  let bearishOB = null;

  for (let i = 1; i < slice.length - 1; i++) {
    const curr = slice[i];
    const next = slice[i + 1];
    const bodyCurr = Math.abs(curr.close - curr.open);
    const bodyNext = Math.abs(next.close - next.open);

    // Candle turun diikuti candle naik kuat (>1.5x body) -> kandidat bullish OB
    const isCurrBearish = curr.close < curr.open;
    const isNextBullishStrong = next.close > next.open && bodyNext > bodyCurr * 1.5;
    if (isCurrBearish && isNextBullishStrong) {
      bullishOB = { high: curr.high, low: curr.low, time: curr.openTime };
    }

    // Candle naik diikuti candle turun kuat -> kandidat bearish OB
    const isCurrBullish = curr.close > curr.open;
    const isNextBearishStrong = next.close < next.open && bodyNext > bodyCurr * 1.5;
    if (isCurrBullish && isNextBearishStrong) {
      bearishOB = { high: curr.high, low: curr.low, time: curr.openTime };
    }
  }

  return { bullishOrderBlock: bullishOB, bearishOrderBlock: bearishOB };
}

/**
 * Fair Value Gap (FVG) / imbalance: celah antara high candle-1 dan low candle+1
 * (untuk bullish FVG), atau sebaliknya untuk bearish FVG, pada pola 3 candle.
 * Ambil maksimal 3 FVG terbaru yang belum "terisi" (masih ada gap-nya).
 */
export function detectFVG(candles, lookback = 50) {
  const slice = candles.slice(-lookback);
  const gaps = [];

  for (let i = 0; i < slice.length - 2; i++) {
    const c1 = slice[i];
    const c3 = slice[i + 2];

    // Bullish FVG: low candle ke-3 > high candle ke-1 (ada celah naik)
    if (c3.low > c1.high) {
      gaps.push({ type: "bullish", top: c3.low, bottom: c1.high, time: slice[i + 1].openTime });
    }
    // Bearish FVG: high candle ke-3 < low candle ke-1 (ada celah turun)
    if (c3.high < c1.low) {
      gaps.push({ type: "bearish", top: c1.low, bottom: c3.high, time: slice[i + 1].openTime });
    }
  }

  return gaps.slice(-3);
}

/**
 * Break of Structure (BoS): harga close menembus swing high/low sebelumnya
 * searah tren yang sedang berjalan (indikasi tren lanjut/menguat).
 * Change of Character (CHoCH): tembus berlawanan arah tren sebelumnya
 * (indikasi potensi pembalikan).
 */
export function detectBoS(candles, swings) {
  const lastClose = candles[candles.length - 1].close;
  const recentSwingHighs = swings.swingHighs.slice(-3);
  const recentSwingLows = swings.swingLows.slice(-3);

  const brokenHigh = recentSwingHighs.find((s) => lastClose > s.price);
  const brokenLow = recentSwingLows.find((s) => lastClose < s.price);

  const events = [];
  if (brokenHigh) {
    events.push({ type: "Break of Structure (Bullish)", level: brokenHigh.price });
  }
  if (brokenLow) {
    events.push({ type: "Break of Structure (Bearish)", level: brokenLow.price });
  }
  return events;
}

/**
 * Liquidity Grab / stop hunt: candle yang wick-nya menembus swing high/low
 * sebelumnya, TAPI close kembali ke dalam range (indikasi "jebakan" sebelum
 * harga berbalik arah).
 */
export function detectLiquidityGrab(candles, swings, checkLastN = 5) {
  const recent = candles.slice(-checkLastN);
  const events = [];

  for (const candle of recent) {
    for (const sh of swings.swingHighs.slice(-5)) {
      if (candle.high > sh.price && candle.close < sh.price) {
        events.push({ type: "Liquidity Grab di atas resistance", level: sh.price, candleTime: candle.openTime });
      }
    }
    for (const sl of swings.swingLows.slice(-5)) {
      if (candle.low < sl.price && candle.close > sl.price) {
        events.push({ type: "Liquidity Grab di bawah support", level: sl.price, candleTime: candle.openTime });
      }
    }
  }

  return events;
}

/** Gabungkan semua deteksi SMC jadi 1 ringkasan siap kirim ke AI */
export function buildSmcSummary(candles, lookback = 60) {
  const swings = findSwingPoints(candles, lookback);
  const orderBlocks = detectOrderBlocks(candles, lookback);
  const fvg = detectFVG(candles, lookback);
  const bos = detectBoS(candles, swings);
  const liquidityGrabs = detectLiquidityGrab(candles, swings);

  return {
    recentSwingHighs: swings.swingHighs.slice(-3).map((s) => s.price),
    recentSwingLows: swings.swingLows.slice(-3).map((s) => s.price),
    ...orderBlocks,
    fairValueGaps: fvg,
    breakOfStructure: bos,
    liquidityGrabs,
  };
}
