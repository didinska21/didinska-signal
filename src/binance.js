/**
 * Ambil data candlestick (OHLCV) dari Binance Futures public API.
 * Tidak butuh API key karena hanya data market publik.
 */
export async function fetchKlines(symbol, interval, limit) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Binance API error: ${res.status} ${res.statusText}`);
  }

  const raw = await res.json();

  // Format array Binance -> objek yang lebih mudah dibaca
  return raw.map((c) => ({
    openTime: c[0],
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    volume: parseFloat(c[5]),
    closeTime: c[6],
  }));
}
