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
 *
 * Support & Resistance dihitung LANGSUNG dari 60 candle yang sama yang
 * ditampilkan di chart (bukan dari teks "Level Kunci" hasil AI Penyimpul),
 * pakai fungsi swing high/low yang sama dengan yang dipakai heuristik SMC
 * (lihat smc.js). Tujuannya biar garisnya selalu konsisten dengan apa yang
 * kelihatan di gambar, dan tetap muncul walau decision-nya WAIT.
 */
import { fetchKlines } from "./binance.js";
import { findSwingPoints } from "./smc.js";

const CANDLE_COUNT = 60;

/**
 * Return ArrayBuffer (bytes PNG) siap dikirim lewat sendPhoto().
 * entry/sl/tp boleh null (kalau gagal ke-parse, atau decision-nya WAIT) —
 * garisnya cuma dilewatin, chart tetap jalan dengan support/resistance +
 * marker harga sekarang.
 */
export async function buildSignalChartImage({ symbol, interval, entry, sl, tp, decision }) {
  const candles = await fetchKlines(symbol, interval, CANDLE_COUNT);

  const closes = candles.map((c) => c.close);
  const firstX = candles[0].closeTime;
  const lastX = candles[candles.length - 1].closeTime;
  const currentPrice = closes[closes.length - 1];

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

  const addLevel = (value, label, color, fillOptions) => {
    if (value == null) return null;
    if (!isWithinReasonableRange(value)) {
      console.warn(`ChartImage: level ${label}=${value} di luar range harga (${minClose}-${maxClose}), garis di-skip.`);
      return null;
    }
    const datasetIndex = datasets.length;
    datasets.push({
      type: "line",
      label: `${label} ${value}`,
      data: [
        { x: firstX, y: value },
        { x: lastX, y: value },
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

  const entryIdx = addLevel(entry, "Entry", "#eab308");
  addLevel(
    tp,
    "TP",
    "#16a34a",
    entryIdx != null ? { target: entryIdx, bg: "rgba(22, 163, 74, 0.15)" } : null,
  );
  addLevel(
    sl,
    "SL",
    "#dc2626",
    entryIdx != null ? { target: entryIdx, bg: "rgba(220, 38, 38, 0.15)" } : null,
  );

  // Support/Resistance: ambil swing point TERDEKAT dari harga sekarang
  // (bukan yang paling ekstrem), karena itu yang paling relevan buat
  // keputusan trading saat ini. Fallback ke swing paling ekstrem kalau
  // nggak ada swing di sisi yang sesuai (misal harga breakout all-time-high
  // di rentang 60 candle ini, jadi nggak ada swing high di atasnya).
  const { swingHighs, swingLows } = findSwingPoints(candles, candles.length, 2);

  const resistanceCandidates = swingHighs
    .filter((s) => s.price > currentPrice)
    .sort((a, b) => a.price - b.price);
  const resistance =
    resistanceCandidates[0]?.price ??
    (swingHighs.length ? Math.max(...swingHighs.map((s) => s.price)) : null);

  const supportCandidates = swingLows
    .filter((s) => s.price < currentPrice)
    .sort((a, b) => b.price - a.price);
  const support =
    supportCandidates[0]?.price ??
    (swingLows.length ? Math.min(...swingLows.map((s) => s.price)) : null);

  addLevel(resistance, "Resistance", "#9333ea");
  addLevel(support, "Support", "#0891b2");

  // Marker harga sekarang: cuma titik di ujung kanan (candle terakhir),
  // bukan garis penuh, biar nggak numpuk sama garis-garis lain.
  datasets.push({
    type: "line",
    label: `Harga Sekarang ${currentPrice}`,
    data: [{ x: lastX, y: currentPrice }],
    showLine: false,
    pointRadius: 6,
    pointBackgroundColor: "#ffffff",
    pointBorderColor: "#111827",
    pointBorderWidth: 2,
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
          type: "timeseries",
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
