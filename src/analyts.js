/**
 * Definisi 10 AI spesialis + AI Penyimpul (AI ke-11, ada di groqVision.js).
 *
 * Tiap spesialis fokus pada 1 dimensi analisis (bukan analisis umum yang
 * tumpang tindih), sesuai pembagian: Trend & Momentum, Volume & Level Kunci,
 * Pola & Konteks Lanjutan, dan Eksekusi (risk management).
 *
 * `quick: true` = termasuk dalam mode "Cepat" (5 AI, murni data API tanpa foto).
 * Mode "Lengkap" menjalankan seluruh 10 AI, termasuk AI 7 (Price Action) yang
 * butuh foto chart dari user.
 */

function baseHeader(title, symbol, tradeMode) {
  return `Anda adalah AI spesialis futures crypto dengan peran: ${title}.
Simbol: ${symbol}. Mode trading: ${tradeMode}.
Analisa HANYA dari data JSON yang diberikan (jangan menebak di luar data itu).
Beri opini SINGKAT (maksimal 5 kalimat): kesimpulan dari sudut pandang Anda, dan bias arah (Bullish/Bearish/Netral).
Bahasa Indonesia, langsung ke inti, tanpa basa-basi.`;
}

export const ANALYSTS = [
  {
    number: 1,
    key: "trend",
    title: "Spesialis Trend (Moving Averages)",
    kind: "api",
    quick: true,
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Trend (Moving Averages)", symbol, tradeMode)}\nTugas: tentukan apakah pasar Uptrend, Downtrend, atau Choppy/Sideways berdasarkan posisi harga relatif terhadap EMA20, EMA50, EMA200.`,
    buildDataSlice: (pkg) => ({
      lastPrice: pkg.lastPrice,
      ema20: pkg.primary.indicators.ema20,
      ema50: pkg.primary.indicators.ema50,
      ema200: pkg.primary.indicators.ema200,
    }),
  },
  {
    number: 2,
    key: "momentum",
    title: "Spesialis Momentum (Oscillators)",
    kind: "api",
    quick: true,
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Momentum (Oscillators)", symbol, tradeMode)}\nTugas: baca RSI, MACD, dan Stochastic. Nilai apakah pergerakan harga didukung momentum kuat, atau ada indikasi Divergence (sinyal pembalikan).`,
    buildDataSlice: (pkg) => ({
      rsi14: pkg.primary.indicators.rsi14,
      macd: pkg.primary.indicators.macd,
      stochastic: pkg.primary.indicators.stochastic,
    }),
  },
  {
    number: 3,
    key: "volatility",
    title: "Spesialis Volatilitas (Bands & ATR)",
    kind: "api",
    quick: true,
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Volatilitas (Bands & ATR)", symbol, tradeMode)}\nTugas: analisa Bollinger Bands & ATR. Ukur seberapa liar pergerakan harga, dan deteksi potensi breakout kalau bands menyempit (squeeze).`,
    buildDataSlice: (pkg) => ({
      lastPrice: pkg.lastPrice,
      bollinger: pkg.primary.indicators.bollinger,
      atr14: pkg.primary.indicators.atr14,
    }),
  },
  {
    number: 4,
    key: "volume",
    title: "Spesialis Volume (Aliran Uang)",
    kind: "api",
    quick: false,
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Volume (Aliran Uang)", symbol, tradeMode)}\nTugas: baca On-Balance Volume (OBV). Konfirmasi apakah pergerakan harga didukung volume besar (valid) atau lemah (indikasi fakeout).`,
    buildDataSlice: (pkg) => ({
      obv: pkg.primary.indicators.obv,
      lastPrice: pkg.lastPrice,
    }),
  },
  {
    number: 5,
    key: "support_resistance",
    title: "Spesialis Support & Resistance",
    kind: "api",
    quick: true,
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Support & Resistance", symbol, tradeMode)}\nTugas: identifikasi level kunci historis, Pivot Points, dan Fibonacci Retracement. Beri titik bouncing yang potensial.`,
    buildDataSlice: (pkg) => ({
      lastPrice: pkg.lastPrice,
      supportResistanceHistoris: {
        support: pkg.primary.indicators.support,
        resistance: pkg.primary.indicators.resistance,
      },
      pivotPoints: pkg.pivot,
      fibonacci: pkg.primary.indicators.fibonacci,
    }),
  },
  {
    number: 6,
    key: "smc",
    title: "Spesialis Struktur Pasar / Smart Money Concepts",
    kind: "api",
    quick: false,
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Smart Money Concepts (SMC)", symbol, tradeMode)}\nTugas: cari Order Block, Fair Value Gap (FVG)/imbalance, Liquidity Grab, dan Break of Structure (BoS). Fokus area yang kemungkinan jadi acuan institusi besar.\nCATATAN: data SMC ini hasil heuristik otomatis, bukan deteksi sempurna — nilai kewajarannya.`,
    buildDataSlice: (pkg) => pkg.smc,
  },
  {
    number: 7,
    key: "price_action",
    title: "Spesialis Price Action (Candlestick, via Foto)",
    kind: "photo",
    quick: false, // pakai foto -> hanya jalan di mode Lengkap
  },
  {
    number: 8,
    key: "mtf",
    title: "Spesialis Multi-Timeframe (MTF) Alignment",
    kind: "api",
    quick: false,
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Multi-Timeframe (MTF) Alignment", symbol, tradeMode)}\nTugas: bandingkan tren di timeframe utama vs timeframe lebih besar (HTF). Kalau HTF Bearish tapi timeframe utama Bullish (atau sebaliknya), beri PERINGATAN risiko tinggi karena melawan tren besar.`,
    buildDataSlice: (pkg) => ({
      timeframeUtama: pkg.primaryInterval,
      timeframeBesar: pkg.htfInterval,
      trendTimeframeUtama: {
        lastPrice: pkg.primary.indicators.lastClose,
        ema20: pkg.primary.indicators.ema20,
        ema50: pkg.primary.indicators.ema50,
      },
      trendTimeframeBesar: {
        lastPrice: pkg.htf.indicators.lastClose,
        ema20: pkg.htf.indicators.ema20,
        ema50: pkg.htf.indicators.ema50,
        ema200: pkg.htf.indicators.ema200,
      },
    }),
  },
  {
    number: 9,
    key: "macro",
    title: "Spesialis Konteks Makro Kripto",
    kind: "api",
    quick: false,
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Konteks Makro Kripto", symbol, tradeMode)}\nTugas: nilai sentimen pasar kripto secara umum dari BTC Dominance & Fear/Greed Index. Kalau data tidak tersedia (null), sebutkan itu dan beri opini netral untuk dimensi ini saja.`,
    buildDataSlice: (pkg) => pkg.macro,
  },
  {
    number: 10,
    key: "risk_management",
    title: "Spesialis Risk Management (Kalkulator Setup)",
    kind: "api",
    quick: true,
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Risk Management", symbol, tradeMode)}\nTugas: JANGAN menebak arah pasar. Fokus RUMUSKAN trading plan: usulan jarak Stop-Loss logis berbasis ATR (misal 1.5x ATR dari harga saat ini), usulan Take-Profit (misal 2-3x jarak SL), dan rasio Risk:Reward minimum yang wajar untuk mode trading ini.`,
    buildDataSlice: (pkg) => ({
      lastPrice: pkg.lastPrice,
      atr14: pkg.primary.indicators.atr14,
      tradeMode: pkg.tradeMode,
    }),
  },
];

export function getAnalystsForMode(aiMode) {
  return aiMode === "cepat" ? ANALYSTS.filter((a) => a.quick) : ANALYSTS;
}
