/**
 * Definisi 10 AI spesialis + AI Penyimpul (AI ke-11, ada di groqVision.js).
 *
 * STRATEGI: "Konfluensi 3 Pilar" — sinyal BUY/SELL yang kuat butuh 3 hal
 * SEARAH sekaligus:
 *   PILAR 1 — TREND        : arah besar pasar (AI #1)
 *   PILAR 2 — LEVEL KUNCI   : harga sedang di zona reaksi (AI #5, +AI #6 di mode Lengkap)
 *   PILAR 3 — MOMENTUM      : konfirmasi entry (AI #2, +AI #7 di mode Lengkap)
 * AI lain (Volatilitas, Volume, MTF, Makro, Risk Management) berperan
 * PENUNJANG/VALIDATOR — tidak menentukan arah, tapi dipakai AI Penyimpul
 * untuk menambah/mengurangi keyakinan & memberi peringatan risiko.
 * Logika pembobotan akhir ada di session_do.js (computePillarAlignment)
 * dan groqVision.js (PILLAR_WEIGHT_NOTE).
 *
 * `quick: true` = termasuk dalam mode "Cepat" (5 AI, murni data API).
 * Mode "Lengkap" menjalankan seluruh 10 AI. Semua AI di sini berbasis data
 * numerik (candle OHLC/indikator) — TIDAK ADA yang butuh foto chart dari
 * user (AI 7 dulu butuh foto, sekarang diganti analisa OHLC mentah).
 */

const PILLAR_LABELS = {
  trend: "PILAR 1 — TREND (arah besar pasar)",
  level: "PILAR 2 — LEVEL KUNCI (zona reaksi harga)",
  momentum: "PILAR 3 — MOMENTUM / KONFIRMASI ENTRY",
  supporting: "PENUNJANG / VALIDATOR",
};

function pillarRoleNote(pillar) {
  if (pillar === "supporting") {
    return `PERAN ANDA: ${PILLAR_LABELS.supporting} dalam strategi "Konfluensi 3 Pilar". Opini Anda TIDAK menentukan arah sinyal utama — tugas Anda MENDUKUNG atau MEMBERI PERINGATAN terhadap 3 pilar utama (Trend, Level Kunci, Momentum). Jangan berperilaku seolah opini Anda setara bobotnya dengan AI pilar utama.`;
  }
  return `PERAN ANDA: pemegang ${PILLAR_LABELS[pillar]}, salah satu dari 3 PILAR UTAMA strategi "Konfluensi 3 Pilar". Bias arah Anda IKUT MENENTUKAN keputusan akhir secara langsung — sistem akan mengecek apakah ke-3 pilar (Trend, Level Kunci, Momentum) SEARAH sebelum memutuskan sinyal kuat atau WAIT. Jangan ragu-ragu di baris "Bias:" — beri kesimpulan tegas berdasar data.`;
}

function baseHeader(title, symbol, tradeMode, pillar) {
  return `Anda adalah AI spesialis trading futures dengan peran: ${title}.
${pillarRoleNote(pillar)}
Simbol: ${symbol}. Mode trading: ${tradeMode}.
Analisa HANYA dari data JSON yang diberikan (jangan menebak di luar data itu).
Beri opini SINGKAT (maksimal 5 kalimat): kesimpulan dari sudut pandang Anda, dan bias arah (Bullish/Bearish/Netral).
Bahasa Indonesia, langsung ke inti, tanpa basa-basi.
WAJIB akhiri jawaban Anda dengan baris baru PERSIS berformat: "Bias: Bullish" atau "Bias: Bearish" atau "Bias: Netral" (pilih satu, tanpa tambahan kata lain di baris itu — ini dipakai sistem untuk menghitung tally & keselarasan pilar otomatis).`;
}

// Simbol yang datanya dari MT5 (lihat marketSource.js) — dipakai analyst
// #9 (makro) buat tahu kapan harus kasih penilaian netral eksplisit,
// karena data makro yang tersedia sekarang (BTC Dominance, Fear/Greed
// Index) itu KHUSUS kripto, tidak relevan buat Gold/instrumen lain.
const MT5_SYMBOLS = new Set(["XAUUSD"]);

// Peta AI number -> pilar, PER MODE (komposisi AI beda antara Cepat & Lengkap:
// mode Cepat cuma punya AI #1/#5/#6 dst yang termasuk quick:true, jadi tidak
// semua anggota pilar tersedia di sana). Dipakai oleh session_do.js
// (computePillarAlignment) & groqVision.js (buildPillarWeightNote) supaya
// definisi "siapa pilar apa" hanya ada di SATU tempat (di sini).
export const PILLAR_MAP = {
  cepat: {
    trend: [1],
    level: [5],
    momentum: [2],
  },
  lengkap: {
    trend: [1],
    level: [5, 6],
    momentum: [2, 7],
  },
};

export function getPillarLabel(pillarKey) {
  return PILLAR_LABELS[pillarKey] || pillarKey;
}

export const ANALYSTS = [
  {
    number: 1,
    key: "trend",
    title: "Spesialis Trend (Moving Averages)",
    kind: "api",
    quick: true,
    pillar: "trend",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Trend (Moving Averages)", symbol, tradeMode, "trend")}\nTugas: tentukan apakah pasar Uptrend, Downtrend, atau Choppy/Sideways berdasarkan posisi harga relatif terhadap EMA20, EMA50, EMA200. Sebagai PILAR 1, kesimpulan Anda jadi acuan ARAH BESAR yang harus didukung 2 pilar lain (Level Kunci & Momentum) sebelum sinyal dianggap kuat.`,
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
    pillar: "momentum",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Momentum (Oscillators)", symbol, tradeMode, "momentum")}\nTugas: baca RSI, MACD, dan Stochastic. Nilai apakah pergerakan harga didukung momentum kuat, atau ada indikasi Divergence (sinyal pembalikan). Sebagai bagian PILAR 3 (Momentum/Konfirmasi), fokus jawab: apakah momentum saat ini MENGKONFIRMASI entry ke arah tertentu SEKARANG, bukan cuma arah umum jangka panjang.`,
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
    pillar: "supporting",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Volatilitas (Bands & ATR)", symbol, tradeMode, "supporting")}\nTugas: analisa Bollinger Bands & ATR. Ukur seberapa liar pergerakan harga, dan deteksi potensi breakout kalau bands menyempit (squeeze). Sebutkan juga apakah volatilitas saat ini mendukung entry AMAN (tidak terlalu liar) atau berisiko tinggi (whipsaw).`,
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
    pillar: "supporting",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Volume (Aliran Uang)", symbol, tradeMode, "supporting")}\nTugas: baca On-Balance Volume (OBV). Konfirmasi apakah pergerakan harga didukung volume besar (valid) atau lemah (indikasi fakeout).${
        MT5_SYMBOLS.has(symbol)
          ? '\nCATATAN: untuk simbol ini, "volume" yang tersedia adalah TICK VOLUME dari MT5 (jumlah perubahan harga), BUKAN volume transaksi riil (pasar forex/CFD itu OTC, tidak ada bursa tunggal yang bisa kasih volume pasti). Beri opini dengan keyakinan LEBIH RENDAH dibanding kalau ini data kripto.'
          : ""
      }`,
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
    pillar: "level",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Support & Resistance", symbol, tradeMode, "level")}\nTugas: identifikasi level kunci historis, Pivot Points, dan Fibonacci Retracement. Sebagai pemegang PILAR 2 (Level Kunci), WAJIB tegaskan: apakah harga SEKARANG sedang berada di/dekat zona reaksi (support/resistance/pivot/fibo), atau justru di tengah kekosongan (no man's land) — sinyal entry jauh lebih valid kalau dekat level kunci.`,
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
    pillar: "level",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Smart Money Concepts (SMC)", symbol, tradeMode, "level")}\nTugas: cari Order Block, Fair Value Gap (FVG)/imbalance, Liquidity Grab, dan Break of Structure (BoS). Sebagai bagian PILAR 2 (Level Kunci) bersama AI Support/Resistance, fokus: apakah harga sekarang berada di zona institusional (Order Block/FVG) yang jadi acuan reaksi harga.\nCATATAN: data SMC ini hasil heuristik otomatis, bukan deteksi sempurna — nilai kewajarannya.`,
    buildDataSlice: (pkg) => pkg.smc,
  },
  {
    number: 7,
    key: "price_action",
    title: "Spesialis Price Action (Candlestick, dari Data OHLC)",
    kind: "api",
    quick: false,
    pillar: "momentum",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Price Action (Candlestick)", symbol, tradeMode, "momentum")}\nTugas: baca deretan candle OHLC mentah (open/high/low/close) beberapa candle terakhir. Identifikasi pola candlestick yang relevan (misal Bullish/Bearish Engulfing, Pin Bar/Hammer, Doji, Shooting Star, Marubozu). Sebagai bagian PILAR 3 (Momentum/Konfirmasi) bersama AI Momentum, fokus: apakah pola candle ini MENGKONFIRMASI entry sekarang atau justru memberi sinyal ragu (indecision candle).`,
    buildDataSlice: (pkg) => ({
      candleTerakhir: pkg.primary.candles.slice(-15).map((c) => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
      lastPrice: pkg.lastPrice,
    }),
  },
  {
    number: 8,
    key: "mtf",
    title: "Spesialis Multi-Timeframe (MTF) Alignment",
    kind: "api",
    quick: false,
    pillar: "supporting",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Multi-Timeframe (MTF) Alignment", symbol, tradeMode, "supporting")}\nTugas: bandingkan tren di timeframe utama vs timeframe lebih besar (HTF). Kalau HTF Bearish tapi timeframe utama Bullish (atau sebaliknya), beri PERINGATAN risiko tinggi karena melawan tren besar.`,
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
    title: "Spesialis Konteks Makro",
    kind: "api",
    quick: false,
    pillar: "supporting",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Konteks Makro", symbol, tradeMode, "supporting")}\nTugas: nilai sentimen pasar secara umum dari BTC Dominance & Fear/Greed Index (data khusus kripto). Kalau field "notApplicable" bernilai true (artinya simbol ini BUKAN kripto, misal XAUUSD/Gold), JANGAN memaksakan opini dari data itu — cukup sebutkan data makro ini tidak relevan untuk simbol ini, dan beri "Bias: Netral" untuk dimensi ini saja. Kalau data null (bukan notApplicable, tapi API gagal), sebutkan itu dan beri opini netral juga.`,
    buildDataSlice: (pkg) => pkg.macro,
  },
  {
    number: 10,
    key: "risk_management",
    title: "Spesialis Risk Management (Kalkulator Setup)",
    kind: "api",
    quick: true,
    pillar: "supporting",
    buildSystemPrompt: (symbol, tradeMode) =>
      `${baseHeader("Spesialis Risk Management", symbol, tradeMode, "supporting")}\nTugas: JANGAN menebak arah pasar. Fokus RUMUSKAN trading plan: usulan jarak Stop-Loss logis berbasis ATR (misal 1.5x ATR dari harga saat ini), usulan Take-Profit (misal 2-3x jarak SL), dan rasio Risk:Reward minimum yang wajar untuk mode trading ini.`,
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
 * mode Cepat/Lengkap. Ini sudah mengikuti semangat yang sama dengan strategi
 * "Konfluensi 3 Pilar" di atas (primary vs supporting), jadi TIDAK diubah —
 * cukup dibiarkan sebagai varian mode tersendiri. Lihat instruksi khusus di
 * tiap buildSystemPrompt & catatan di summarizeSignals() (groqVision.js)
 * soal bobot penimbangan.
 */
function fiboQmHeader(title, symbol, tradeMode, role) {
  const roleNote =
    role === "primary"
      ? `PERAN ANDA: PEMEGANG PERTIMBANGAN UTAMA di mode analisis "Fibo & QM" ini. Opini Anda adalah dasar utama keputusan akhir — bukan sekadar 1 dari banyak suara.`
      : `PERAN ANDA: KONFIRMASI/PENUNJANG SAJA di mode analisis "Fibo & QM" ini. Opini Anda dipakai untuk MEMVALIDASI atau MEMBERI PERINGATAN terhadap temuan Fibonacci & Quasimodo (bukan penentu arah utama) — jangan berperilaku seolah opini Anda setara bobotnya dengan 2 spesialis utama.`;

  return `Anda adalah AI spesialis trading futures dengan peran: ${title}.
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
      `${fiboQmHeader("Volume (Aliran Uang)", symbol, tradeMode, "supporting")}\nTugas: baca On-Balance Volume (OBV). Konfirmasi apakah pergerakan menuju/menjauhi level kunci didukung volume nyata (valid) atau lemah (indikasi fakeout, patut diwaspadai kalau mau entry di zona Fibo/QM).${
        MT5_SYMBOLS.has(symbol)
          ? '\nCATATAN: untuk simbol ini, "volume" yang tersedia adalah TICK VOLUME dari MT5 (jumlah perubahan harga), BUKAN volume transaksi riil (pasar forex/CFD itu OTC). Beri opini dengan keyakinan LEBIH RENDAH dibanding kalau ini data kripto.'
          : ""
      }`,
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
