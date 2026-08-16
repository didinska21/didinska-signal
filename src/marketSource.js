/**
 * Dispatcher sumber data candle & harga terkini.
 *
 * KENAPA PERLU INI: bot awalnya cuma kenal 1 sumber data (Binance/Bybit,
 * semua pair kripto futures). Sekarang ditambah XAUUSD yang datanya datang
 * dari MT5 (lewat bridge Python di laptop/VPS kamu, lihat mt5Source.js).
 * Semua kode lain (marketData.js, ChartImage.js, session_do.js) panggil
 * fetchKlines/fetchCurrentPrice dari SINI (bukan langsung ke binance.js),
 * supaya pemilihan sumber data (kripto vs MT5) terpusat di 1 tempat.
 *
 * Simbol kripto yang sudah berjalan SAMA SEKALI TIDAK terpengaruh — tetap
 * lewat Binance/Bybit seperti sebelumnya.
 */
import * as binanceSource from "./binance.js";
import { fetchMt5Klines, fetchMt5CurrentPrice, isMt5MarketOpen } from "./mt5Source.js";

// Daftar simbol yang datanya diambil dari MT5 bridge, bukan Binance/Bybit.
// Tambah di sini kalau nanti mau expand ke pair MT5 lain (misal XAGUSD, EURUSD, dll).
const MT5_SYMBOLS = new Set(["XAUUSD"]);

export function isMt5Symbol(symbol) {
  return MT5_SYMBOLS.has(symbol);
}

/**
 * Cek pasar sedang buka sebelum mulai analisa (khusus simbol MT5). Kalau
 * pasar tutup, data candle yang ada sudah "beku" (bukan kondisi terkini) —
 * lebih aman menolak analisa daripada memberi sinyal dari data basi.
 * Untuk simbol non-MT5 (kripto, 24/7) selalu return true.
 */
export async function assertMarketOpen(env, symbol) {
  if (!isMt5Symbol(symbol)) return;
  const open = await isMt5MarketOpen(env, symbol);
  if (!open) {
    throw new Error(
      `Pasar ${symbol} sedang TUTUP. Data candle yang ada sudah tidak mencerminkan kondisi pasar terkini, jadi analisa dibatalkan demi keamanan. Coba lagi saat jam pasar buka.`
    );
  }
}

export async function fetchKlines(env, symbol, interval, limit) {
  if (isMt5Symbol(symbol)) return fetchMt5Klines(env, symbol, interval, limit);
  return binanceSource.fetchKlines(symbol, interval, limit);
}

export async function fetchCurrentPrice(env, symbol) {
  if (isMt5Symbol(symbol)) return fetchMt5CurrentPrice(env, symbol);
  return binanceSource.fetchCurrentPrice(symbol);
}
