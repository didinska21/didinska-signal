/**
 * Sumber data candle & harga untuk simbol yang di-supply lewat MT5 bridge
 * (saat ini: XAUUSD). Worker TIDAK fetch langsung ke MT5 (tidak bisa,
 * MT5 jalan di laptop/VPS kamu, bukan di cloud) — Worker cuma BACA cache
 * yang di-push berkala oleh script Python bridge (mt5_bridge.py) ke
 * Mt5BridgeDO lewat endpoint /mt5-bridge/candles.
 */
const STALE_MS = 5 * 60 * 1000; // anggap data basi kalau lebih dari 5 menit tidak di-update

// PENTING: bridge Python TETAP push data tiap 15 detik meskipun pasar
// tutup (weekend/libur) — dia cuma narik ulang candle histori yang sama
// dari MT5, jadi cek "kapan terakhir di-push" (STALE_MS di atas) TIDAK
// cukup buat mendeteksi pasar tutup. Yang membedakan: candle 1 menit
// TERBARU jadi tidak pernah berubah/nambah selama pasar tutup, jadi kita
// cek langsung apakah openTime candle 1m terakhir masih dalam beberapa
// menit dari sekarang. Kalau sudah lewat dari ini, anggap pasar tutup.
const MARKET_CLOSED_THRESHOLD_MS = 5 * 60 * 1000; // candle 1m terakhir harus < 5 menit dari sekarang

function getMt5Stub(env, symbol) {
  const id = env.MT5_BRIDGE_DO.idFromName(symbol);
  return env.MT5_BRIDGE_DO.get(id);
}

export async function fetchMt5Klines(env, symbol, interval, limit) {
  const stub = getMt5Stub(env, symbol);
  const res = await stub.fetch(`https://mt5-bridge/getCandles?interval=${interval}`);
  const data = await res.json();

  if (!data.candles || data.candles.length === 0) {
    throw new Error(
      `Belum ada data candle ${symbol} (${interval}) dari MT5 bridge. Pastikan mt5_bridge.py sedang jalan di laptop kamu dan MT5 dalam keadaan terbuka/login.`
    );
  }

  const age = Date.now() - data.updatedAt;
  if (age > STALE_MS) {
    throw new Error(
      `Data candle ${symbol} (${interval}) dari MT5 bridge sudah basi (terakhir update ${Math.round(
        age / 1000
      )} detik lalu). Cek koneksi bridge Python / MT5 di laptop kamu.`
    );
  }

  return data.candles.slice(-limit);
}

export async function fetchMt5CurrentPrice(env, symbol) {
  const candles = await fetchMt5Klines(env, symbol, "1m", 1);
  return candles[candles.length - 1].close;
}

/**
 * Cek apakah pasar untuk simbol ini SEDANG BUKA, berdasarkan seberapa baru
 * candle 1 menit terakhir. Kalau candle terakhir sudah lebih tua dari
 * MARKET_CLOSED_THRESHOLD_MS, anggap pasar tutup — dan analisa/eksekusi
 * SEBAIKNYA dibatalkan (data yang dianalisa sudah "beku", tidak
 * mencerminkan kondisi pasar terkini).
 */
export async function isMt5MarketOpen(env, symbol) {
  const candles = await fetchMt5Klines(env, symbol, "1m", 1);
  const lastCandle = candles[candles.length - 1];
  const candleAge = Date.now() - lastCandle.openTime;
  return candleAge <= MARKET_CLOSED_THRESHOLD_MS;
}
