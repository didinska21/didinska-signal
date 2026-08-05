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
Bahasa Indonesia, langsung ke inti, tanpa basa-basi.
WAJIB akhiri jawaban Anda dengan baris baru PERSIS berformat: "Bias: Bullish" atau "Bias: Bearish" atau "Bias: Netral" (pilih satu, tanpa tambahan kata lain di baris itu — ini dipakai sistem untuk menghitung tally otomatis).`;
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

/**
 * Mode "Fibo & QM": rombak/repurpose 6 slot AI (bukan mode baru dari nol) —
 * fokus khusus Fibonacci Retracement (arah otomatis) & pola Quasimodo (QM)
 * sebagai PERTIMBANGAN UTAMA, sisanya (Trend/Momentum/Volume/Risk Mgmt)
 * jadi KONFIRMASI/PENUNJANG saja — bukan voting bias yang sejajar seperti
 * mode Cepat/Lengkap. Lihat instruksi khusus di tiap buildSystemPrompt &
 * catatan di summarizeSignals() (groqVision.js) soal bobot penimbangan.
 */
function fiboQmHeader(title, symbol, tradeMode, role) {
  const roleNote =
    role === "primary"
      ? `PERAN ANDA: PEMEGANG PERTIMBANGAN UTAMA di mode analisis "Fibo & QM" ini. Opini Anda adalah dasar utama keputusan akhir — bukan sekadar 1 dari banyak suara.`
      : `PERAN ANDA: KONFIRMASI/PENUNJANG SAJA di mode analisis "Fibo & QM" ini. Opini Anda dipakai untuk MEMVALIDASI atau MEMBERI PERINGATAN terhadap temuan Fibonacci & Quasimodo (bukan penentu arah utama) — jangan berperilaku seolah opini Anda setara bobotnya dengan 2 spesialis utama.`;

  return `Anda adalah AI spesialis futures crypto dengan peran: ${title}.
${roleNote}
Simbol: ${symbol}. Mode trading: ${tradeMode}.
Analisa HANYA dari data JSON yang diberikan (jangan menebak di luar data itu).
Beri opini SINGKAT (maksimal 5 kalimat): kesimpulan dari sudut pandang Anda, dan bias arah (Bullish/Bearish/Netral).
Bahasa Indonesia, langsung ke inti, tanpa basa-basi.
WAJIB akhiri jawaban Anda dengan baris baru PERSIS berformat: "Bias: Bullish" atau "Bias: Bearish" atau "Bias: Netral" (pilih satu, tanpa tambahan kata lain di baris itu — ini dipakai sistem untuk menghitung tally otomatis).`;
}

export const FIBO_QM_ANALYSTS = [
  {
    number: 1,
    key: "fibonacci",
    title: "Spesialis Fibonacci Retracement",
    kind: "api",
    role: "primary",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${fiboQmHeader("Spesialis Fibonacci Retracement", symbol, tradeMode, "primary")}\nTugas: baca data "fibonacci" (arah ditentukan otomatis dari swing high/low terbaru — "retracement_turun" berarti abis naik & cari support koreksi, "retracement_naik" berarti abis turun & cari resistance koreksi). WAJIB sebutkan level kunci (0.382/0.5/0.618) dengan ANGKA HARGA PERSIS dari data, dan nilai apakah harga sekarang sudah mendekati/berada di salah satu level itu (zona reaksi potensial).`,
    buildDataSlice: (pkg) => ({
      lastPrice: pkg.lastPrice,
      fibonacci: pkg.fiboQm?.fibonacci ?? null,
    }),
  },
  {
    number: 2,
    key: "quasimodo",
    title: "Spesialis Pola Quasimodo (QM)",
    kind: "api",
    role: "primary",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${fiboQmHeader("Spesialis Pola Quasimodo (QM)", symbol, tradeMode, "primary")}\nTugas: baca data "quasimodo" (heuristik pola reversal 3 titik: baseLow/baseHigh -> neckline -> head, field "confirmed" menandakan apakah breakout balik lewat neckline sudah terjadi). Kalau data null, berarti TIDAK ADA pola QM valid terdeteksi dalam data saat ini — sebutkan itu apa adanya dan beri opini Netral untuk dimensi ini SAJA (jangan mengarang pola yang tidak ada di data). Kalau ada, jelaskan level neckline (zona entry potensial) dan apakah confirmed true/false.`,
    buildDataSlice: (pkg) => ({
      lastPrice: pkg.lastPrice,
      quasimodo: pkg.fiboQm?.quasimodo ?? null,
    }),
  },
  {
    number: 3,
    key: "trend_support",
    title: "Trend (Moving Averages) — Penunjang",
    kind: "api",
    role: "supporting",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${fiboQmHeader("Trend (Moving Averages)", symbol, tradeMode, "supporting")}\nTugas: tentukan Uptrend/Downtrend/Choppy dari posisi harga vs EMA20/50/200. Nilai APAKAH trend ini MENDUKUNG atau BERTENTANGAN dengan bias dari level Fibonacci/QM (Anda tidak melihat opini AI lain secara langsung, cukup nilai trend dari data Anda sendiri apa adanya).`,
    buildDataSlice: (pkg) => ({
      lastPrice: pkg.lastPrice,
      ema20: pkg.primary.indicators.ema20,
      ema50: pkg.primary.indicators.ema50,
      ema200: pkg.primary.indicators.ema200,
    }),
  },
  {
    number: 4,
    key: "momentum_support",
    title: "Momentum (Oscillators) — Penunjang",
    kind: "api",
    role: "supporting",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${fiboQmHeader("Momentum (Oscillators)", symbol, tradeMode, "supporting")}\nTugas: baca RSI, MACD, Stochastic. Nilai apakah momentum saat ini mendukung kemungkinan reaksi/reversal di zona harga saat ini (misal RSI oversold/overbought memperkuat potensi reaksi di level kunci), atau justru menunjukkan momentum masih kuat searah trend (kurang mendukung reversal).`,
    buildDataSlice: (pkg) => ({
      rsi14: pkg.primary.indicators.rsi14,
      macd: pkg.primary.indicators.macd,
      stochastic: pkg.primary.indicators.stochastic,
    }),
  },
  {
    number: 5,
    key: "volume_support",
    title: "Volume (Aliran Uang) — Penunjang",
    kind: "api",
    role: "supporting",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${fiboQmHeader("Volume (Aliran Uang)", symbol, tradeMode, "supporting")}\nTugas: baca On-Balance Volume (OBV). Konfirmasi apakah pergerakan menuju/menjauhi level kunci didukung volume nyata (valid) atau lemah (indikasi fakeout, patut diwaspadai kalau mau entry di zona Fibo/QM).`,
    buildDataSlice: (pkg) => ({
      obv: pkg.primary.indicators.obv,
      lastPrice: pkg.lastPrice,
    }),
  },
  {
    number: 6,
    key: "risk_management_fiboqm",
    title: "Risk Management (Kalkulator Setup)",
    kind: "api",
    role: "supporting",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${fiboQmHeader("Risk Management", symbol, tradeMode, "supporting")}\nTugas: JANGAN menebak arah pasar. Rumuskan trading plan berbasis level Fibonacci/QM yang sudah diberikan DIGABUNG dengan ATR: usulkan Stop-Loss logis (taruh sedikit di LUAR level kunci terdekat, tambah buffer dari ATR — jangan taruh SL PERSIS di level kunci karena rawan wick), usulkan Take-Profit ke level kunci berikutnya, dan rasio Risk:Reward minimum yang wajar untuk mode trading ini.`,
    buildDataSlice: (pkg) => ({
      lastPrice: pkg.lastPrice,
      atr14: pkg.primary.indicators.atr14,
      tradeMode: pkg.tradeMode,
      fibonacciLevels: pkg.fiboQm?.fibonacci?.levels ?? null,
      quasimodoLevel: pkg.fiboQm?.quasimodo?.qmLevel ?? null,
    }),
  },
];

export function getAnalystsForMode(aiMode) {
  if (aiMode === "cepat") return ANALYSTS.filter((a) => a.quick);
  if (aiMode === "fiboqm") return FIBO_QM_ANALYSTS;
  return ANALYSTS;
}
