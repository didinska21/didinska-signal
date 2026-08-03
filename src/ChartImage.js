/**
 * Generate gambar chart (harga terakhir + garis Entry/SL/TP) pakai QuickChart
 * (gratis, nggak perlu API key: https://quickchart.io). Candle di sini
 * di-fetch TERPISAH dari dataPackage yang dikirim ke AI — sengaja, biar
 * nggak nambah ukuran prompt yang dikirim ke tiap analyst. Chart cuma
 * dibikin SEKALI di akhir, khusus buat ditampilkan ke user.
 */
import { fetchKlines } from "./binance.js";

const CANDLE_COUNT = 60;

/**
 * Return ArrayBuffer (bytes PNG) siap dikirim lewat sendPhoto().
 * entry/sl/tp boleh null (kalau gagal ke-parse) — garisnya cuma dilewatin.
 */
export async function buildSignalChartImage({ symbol, interval, entry, sl, tp, decision }) {
  const candles = await fetchKlines(symbol, interval, CANDLE_COUNT);

  const labels = candles.map((c) => {
    const d = new Date(c.closeTime);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  });
  const closes = candles.map((c) => c.close);

  const datasets = [
    {
      label: `${symbol} (${interval})`,
      data: closes,
      borderColor: "#2563eb",
      backgroundColor: "rgba(37,99,235,0.08)",
      borderWidth: 2,
      pointRadius: 0,
      fill: true,
      tension: 0.1,
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
      label: `${label} ${value}`,
      data: closes.map(() => value),
      borderColor: color,
      borderDash: [6, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
    });
  };

  addLevel(entry, "Entry", "#eab308");
  addLevel(tp, "TP", "#16a34a");
  addLevel(sl, "SL", "#dc2626");

  const chartConfig = {
    type: "line",
    data: { labels, datasets },
    options: {
      title: { display: true, text: `${symbol} — ${decision || ""}`.trim(), fontSize: 16 },
      legend: { display: true, position: "bottom" },
      scales: {
        xAxes: [{ ticks: { maxTicksLimit: 8, fontSize: 10 } }],
        yAxes: [{ ticks: { fontSize: 10 } }],
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
    }),
  });

  if (!res.ok) {
    throw new Error(`QuickChart error: ${res.status} ${res.statusText}`);
  }

  return await res.arrayBuffer();
}
