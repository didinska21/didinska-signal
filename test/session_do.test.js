import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPriceAfterLabel } from "../src/session_do.js";

// Teks ini persis dari kasus nyata yang dilaporkan (screenshot BTC/USDT SELL) —
// sebelum perbaikan, SL & TP ke-extract sebagai angka "poin" (79.5 / 159),
// BUKAN harga asli di dalam kurung "(≈ ...)".
const REAL_WORLD_TEXT = `
🎯 Keputusan: SELL
📊 Bias Arah: Bearish
📍 Level Kunci:
- Resistance utama: 63320
- Support utama: 63037.3 (pivot S1 62962)
- Fibonacci 0.618: 63242.47
- Order Block/Break of Structure: Bearish OB 63170.7-63138.7, BoS di 63122.9

🎯 Skenario Entry: Short di sekitar 63050 (di bawah EMA20/EMA50 pada 5m &
1h) dengan konfirmasi penurunan harga menembus support 63037.3 atau break ke
bawah Fair Value Gap (63148-63188).

🛡️ Manajemen Risiko:
- Stop-Loss: 79.5 poin di atas entry (≈ 63130) – mengacu pada 1.5×ATR14.
- Take-Profit: 159-239 poin di bawah entry (≈ 62870-62810) – 2-3×SL, menghasilkan Risk:Reward ≥ 1:2.

📈 Probabilitas: ±70%
`;

test("extractPriceAfterLabel: Stop-Loss mengambil harga asli (≈ 63130), bukan poin jarak (79.5)", () => {
  const value = extractPriceAfterLabel(REAL_WORLD_TEXT, "Stop-Loss");
  assert.equal(value, 63130);
});

test("extractPriceAfterLabel: Take-Profit mengambil harga asli (≈ 62870), bukan poin jarak (159)", () => {
  const value = extractPriceAfterLabel(REAL_WORLD_TEXT, "Take-Profit");
  assert.equal(value, 62870);
});

test("extractPriceAfterLabel: Skenario Entry tetap terbaca walau jaraknya >15 karakter dari label", () => {
  const value = extractPriceAfterLabel(REAL_WORLD_TEXT, "Skenario Entry");
  assert.equal(value, 63050);
});

test("extractPriceAfterLabel: label yang tidak ada di teks -> null", () => {
  const value = extractPriceAfterLabel(REAL_WORLD_TEXT, "Label Tidak Ada");
  assert.equal(value, null);
});

test("extractPriceAfterLabel: harga dengan pemisah ribuan (koma) tetap ke-parse benar", () => {
  const text = "Stop-Loss: 50 poin di bawah entry (≈ 1,234.5)";
  const value = extractPriceAfterLabel(text, "Stop-Loss");
  assert.equal(value, 1234.5);
});
