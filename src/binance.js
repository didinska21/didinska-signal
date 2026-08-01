/**
 * Ambil data candlestick (OHLCV) untuk pair futures.
 * Sumber utama: Binance Futures. Karena Binance kerap men-geoblock IP
 * datacenter/Cloudflare (403 Forbidden), fungsi ini otomatis fallback
 * ke Bybit Futures API bila Binance gagal.
 */

const BINANCE_INTERVAL_MAP = {
  "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d",
};

// Bybit pakai kode interval dalam menit/D/W, bukan string "15m"
const BYBIT_INTERVAL_MAP = {
  "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D",
};

export async function fetchKlines(symbol, interval, limit) {
  try {
    return await fetchFromBinance(symbol, interval, limit);
  } catch (err) {
    console.warn(`Binance gagal (${err.message}), fallback ke Bybit...`);
    return await fetchFromBybit(symbol, interval, limit);
  }
}

async function fetchFromBinance(symbol, interval, limit) {
  const iv = BINANCE_INTERVAL_MAP[interval] || interval;
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${iv}&limit=${limit}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Binance API error: ${res.status} ${res.statusText}`);
  }

  const raw = await res.json();

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

async function fetchFromBybit(symbol, interval, limit) {
  const iv = BYBIT_INTERVAL_MAP[interval] || interval;
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${iv}&limit=${limit}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Bybit API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  if (data.retCode !== 0) {
    throw new Error(`Bybit API error: ${data.retMsg}`);
  }

  // Bybit mengembalikan data terbaru -> terlama, jadi perlu di-reverse
  // Format tiap item: [start, open, high, low, close, volume, turnover]
  return data.result.list
    .map((c) => ({
      openTime: parseInt(c[0], 10),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
      closeTime: parseInt(c[0], 10),
    }))
    .reverse();
}

/**
 * Ambil harga terkini (mark price / last price) tanpa perlu tarik candle
 * penuh — dipakai buat cek cepat apakah suatu level TP/SL sudah tersentuh.
 * Fallback ke Bybit kalau Binance gagal, sama seperti fetchKlines.
 */
export async function fetchCurrentPrice(symbol) {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`Binance ticker error: ${res.status}`);
    const data = await res.json();
    return parseFloat(data.price);
  } catch (err) {
    console.warn(`Binance ticker gagal (${err.message}), fallback ke Bybit...`);
    const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Bybit ticker error: ${res.status}`);
    const data = await res.json();
    if (data.retCode !== 0) throw new Error(`Bybit ticker error: ${data.retMsg}`);
    return parseFloat(data.result.list[0].lastPrice);
  }
}
