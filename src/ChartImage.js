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

const CANDLE_COUNT = 60;

/**
 * Return ArrayBuffer (bytes PNG) siap dikirim lewat sendPhoto().
 * entry/sl/tp boleh null (kalau gagal ke-parse) — garisnya cuma dilewatin.
 */
export async function buildSignalChartImage({ symbol, interval, entry, sl, tp, decision }) {
  const candles = await fetchKlines(symbol, interval, CANDLE_COUNT);

  const closes = candles.map((c) => c.close);
  const firstX = candles[0].closeTime;
  const lastX = candles[candles.length - 1].closeTime;

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

  const addLevel = (value, label, color) => {
    if (value == null) return;
    if (!isWithinReasonableRange(value)) {
      console.warn(`ChartImage: level ${label}=${value} di luar range harga (${minClose}-${maxClose}), garis di-skip.`);
      return;
    }
    datasets.push({
      type: "line",
      label: `${label} ${value}`,
      data: [
        { x: firstX, y: value },
        { x: lastX, y: value },
      ],
      borderColor: color,
      borderDash: [6, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
      // biar garis nembus dari ujung ke ujung tanpa ikut animasi kurva candle
      tension: 0,
    });
  };

  addLevel(entry, "Entry", "#eab308");
  addLevel(tp, "TP", "#16a34a");
  addLevel(sl, "SL", "#dc2626");

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
