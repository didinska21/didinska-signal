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
import { fetchMt5Klines, fetchMt5CurrentPrice } from "./mt5Source.js";

// Daftar simbol yang datanya diambil dari MT5 bridge, bukan Binance/Bybit.
// Tambah di sini kalau nanti mau expand ke pair MT5 lain (misal XAGUSD, EURUSD, dll).
const MT5_SYMBOLS = new Set(["XAUUSD"]);

export function isMt5Symbol(symbol) {
  return MT5_SYMBOLS.has(symbol);
}

export async function fetchKlines(env, symbol, interval, limit) {
  if (isMt5Symbol(symbol)) return fetchMt5Klines(env, symbol, interval, limit);
  return binanceSource.fetchKlines(symbol, interval, limit);
}

export async function fetchCurrentPrice(env, symbol) {
  if (isMt5Symbol(symbol)) return fetchMt5CurrentPrice(env, symbol);
  return binanceSource.fetchCurrentPrice(symbol);
}
