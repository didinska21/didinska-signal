/**
 * Generate gambar chart (candlestick + garis Entry/SL/TP) pakai QuickChart
 * (gratis, nggak perlu API key: https://quickchart.io). Candle di sini
 * di-fetch TERPISAH dari dataPackage yang dikirim ke AI — sengaja, biar
 * nggak nambah ukuran prompt yang dikirim ke tiap analyst. Chart cuma
 * dibikin SEKALI di akhir, khusus buat ditampilkan ke user.
 *
 * Pakai plugin chartjs-chart-financial (bawaan QuickChart) buat render
 * candlestick asli (open/high/low/close per candle) — butuh Chart.js v3+,
 * makanya request ke QuickChart eksplisit set "version": "3" dan opsi
 * `scales` pakai sintaks v3 (bukan xAxes/yAxes ala v2).
 */
import { fetchKlines } from "./binance.js";

const CANDLE_COUNT = 120;
// Kotak zona Entry/TP/SL digambar di ruang kosong sebelah kanan candle
// terakhir (nggak nempel), persis kayak drawing tool "Long/Short Position"
// di Binance. Ukurannya dihitung sebagai FRAKSI dari total rentang waktu
// candle yang ditampilkan (bukan jumlah candle tetap), biar kotaknya tetap
// proporsional terlihat jelas walau CANDLE_COUNT di atas diubah-ubah.
const BOX_GAP_FRACTION = 0.03; // jarak kosong sebelum kotak
const BOX_WIDTH_FRACTION = 0.3; // lebar kotak

/**
 * Return ArrayBuffer (bytes PNG) siap dikirim lewat sendPhoto().
 * entry/sl/tp boleh null (kalau gagal ke-parse, atau decision-nya WAIT) —
 * kotak zonanya cuma dilewatin, chart tetap jalan dengan garis harga
 * sekarang.
 */
export async function buildSignalChartImage({ symbol, interval, entry, sl, tp, decision }) {
  const candles = await fetchKlines(symbol, interval, CANDLE_COUNT);

  const closes = candles.map((c) => c.close);
  const firstX = candles[0].closeTime;
  const lastX = candles[candles.length - 1].closeTime;
  const currentPrice = closes[closes.length - 1];

  // Rentang waktu total yang ditampilkan, dipakai buat nentuin ukuran
  // kotak Entry/TP/SL secara proporsional (lihat BOX_GAP_FRACTION /
  // BOX_WIDTH_FRACTION di atas).
  const totalSpanMs = lastX - firstX;
  const boxStartX = lastX + totalSpanMs * BOX_GAP_FRACTION;
  const boxEndX = boxStartX + totalSpanMs * BOX_WIDTH_FRACTION;

  const datasets = [
    {
      label: `${symbol} (${interval})`,
      data: candles.map((c) => ({
        x: c.closeTime,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
      })),
      color: {
        up: "#16a34a",
        down: "#dc2626",
        unchanged: "#6b7280",
      },
      borderColor: {
        up: "#16a34a",
        down: "#dc2626",
        unchanged: "#6b7280",
      },
    },
  ];

  // Pengaman: kalau entry/sl/tp hasil parsing ternyata jauh di luar rentang
  // harga candle yang ditampilkan (indikasi salah tangkap angka, misal "poin
  // jarak" ke-scrape sebagai harga absolut), jangan digambar. Kalau tetap
  // dipaksa gambar, sumbu-Y chart bakal auto-scale buat nampung nilai itu,
  // dan harga aslinya jadi keliatan garis datar nyaris nggak kebaca.
  const minClose = Math.min(...closes);
  const maxClose = Math.max(...closes);
  const priceRange = maxClose - minClose || maxClose * 0.01;
  const isWithinReasonableRange = (value) =>
    value >= minClose - priceRange * 3 && value <= maxClose + priceRange * 3;

  const addLevel = (value, label, color, fillOptions, xRange) => {
    if (value == null) return null;
    if (!isWithinReasonableRange(value)) {
      console.warn(`ChartImage: level ${label}=${value} di luar range harga (${minClose}-${maxClose}), garis di-skip.`);
      return null;
    }
    const [xStart, xEnd] = xRange || [firstX, lastX];
    const datasetIndex = datasets.length;
    datasets.push({
      type: "line",
      label: `${label} ${value}`,
      data: [
        { x: xStart, y: value },
        { x: xEnd, y: value },
      ],
      borderColor: color,
      borderDash: fillOptions ? [] : [6, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      // Kalau fillOptions dikasih, area antara garis ini dan garis Entry
      // (yang sudah lebih dulu ke-push, jadi index-nya lebih kecil) diisi
      // warna transparan — efeknya jadi "kotak zona" kayak tool Long/Short
      // Position di Binance. Ini pakai fitur fill bawaan Chart.js v3
      // (bukan plugin annotation terpisah), karena QuickChart nggak
      // dukung plugin annotation di Chart.js v3+ yang dipakai buat
      // candlestick.
      fill: fillOptions ? fillOptions.target : false,
      backgroundColor: fillOptions ? fillOptions.bg : undefined,
      tension: 0,
    });
    return datasetIndex;
  };

  // Entry/TP/SL digambar di kotak yang terpisah dari candle (ada jarak
  // kosong dulu), bukan garis penuh dari ujung ke ujung chart lagi.
  const boxRange = [boxStartX, boxEndX];

  const entryIdx = addLevel(entry, "Entry", "#eab308", null, boxRange);
  addLevel(
    tp,
    "TP",
    "#16a34a",
    entryIdx != null ? { target: entryIdx, bg: "rgba(22, 163, 74, 0.15)" } : null,
    boxRange,
  );
  addLevel(
    sl,
    "SL",
    "#dc2626",
    entryIdx != null ? { target: entryIdx, bg: "rgba(220, 38, 38, 0.15)" } : null,
    boxRange,
  );

  // Harga sekarang: garis putus-putus dari ujung kiri chart sampai ujung
  // kotak (biar kelihatan konteksnya dibanding history), dengan marker
  // bulat di ujung kanan supaya gampang dibaca posisinya.
  datasets.push({
    type: "line",
    label: `Harga Sekarang ${currentPrice}`,
    data: [
      { x: firstX, y: currentPrice },
      { x: boxEndX, y: currentPrice },
    ],
    borderColor: "#374151",
    borderDash: [6, 4],
    borderWidth: 1.5,
    pointRadius: [0, 6],
    pointBackgroundColor: ["transparent", "#ffffff"],
    pointBorderColor: ["transparent", "#111827"],
    pointBorderWidth: [0, 2],
    fill: false,
    tension: 0,
  });

  const chartConfig = {
    type: "candlestick",
    data: { datasets },
    options: {
      plugins: {
        title: { display: true, text: `${symbol} — ${decision || ""}`.trim(), font: { size: 16 } },
        legend: { display: true, position: "bottom" },
      },
      scales: {
        x: {
          // "time" (bukan "timeseries") sengaja dipilih: timeseries di
          // Chart.js otomatis meratakan jarak antar titik data (dibikin
          // rapat merata biar enak dibaca), jadi gap kosong yang sengaja
          // dibuat buat kotak Entry/TP/SL malah ikut kegencet dan
          // kotaknya kelihatan kecil. "time" murni proporsional terhadap
          // waktu asli (ms), jadi lebar kotak sesuai BOX_WIDTH_FRACTION
          // beneran kelihatan.
          type: "time",
          ticks: { maxTicksLimit: 8, font: { size: 10 } },
        },
        y: {
          ticks: { font: { size: 10 } },
        },
      },
    },
  };

  const res = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chart: chartConfig,
      width: 900,
      height: 500,
      backgroundColor: "white",
      devicePixelRatio: 2,
      version: "3",
    }),
  });

  if (!res.ok) {
    throw new Error(`QuickChart error: ${res.status} ${res.statusText}`);
  }

  return await res.arrayBuffer();
}
