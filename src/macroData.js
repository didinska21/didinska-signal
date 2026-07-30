/**
 * Data konteks makro khusus kripto: BTC Dominance & Fear/Greed Index.
 * Keduanya API publik gratis, tidak butuh API key.
 *
 * Dibuat fault-tolerant: kalau salah satu/dua-duanya gagal (misal API lagi
 * down), fungsi ini TIDAK melempar error — cukup kembalikan null untuk
 * field yang gagal, supaya proses analisis tetap lanjut tanpa data itu.
 */

export async function fetchFearGreedIndex() {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const item = data.data?.[0];
    if (!item) return null;
    return {
      value: parseInt(item.value, 10),
      classification: item.value_classification,
    };
  } catch (err) {
    console.warn(`Gagal ambil Fear/Greed Index: ${err.message}`);
    return null;
  }
}

export async function fetchBtcDominance() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/global");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const pct = data.data?.market_cap_percentage?.btc;
    if (pct === undefined) return null;
    return { btcDominancePct: Math.round(pct * 100) / 100 };
  } catch (err) {
    console.warn(`Gagal ambil BTC Dominance: ${err.message}`);
    return null;
  }
}

/** Ambil kedua data makro sekaligus secara paralel */
export async function buildMacroSummary() {
  const [fearGreed, btcDominance] = await Promise.all([
    fetchFearGreedIndex(),
    fetchBtcDominance(),
  ]);
  return { fearGreed, btcDominance };
}
