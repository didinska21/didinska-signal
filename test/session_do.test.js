import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPriceAfterLabel, detectDecision, tallyBias, computePillarAlignment } from "../src/session_do.js";

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

// --- Regresi: AI kadang nulis DUA simbol "≈" dalam satu baris — satu untuk
// JARAK/multiplier (mis. "1,5 × ATR ≈ 193 poin") dan satu lagi untuk HARGA
// ASLI di dalam kurung (mis. "(≈ 63 200)"). Kasus nyata dari laporan user:
// gambar chart bergaris cuma nampilin garis Entry, garis SL/TP hilang total
// karena ke-extract sebagai angka jarak yang jauh di luar skala harga chart.
test("extractPriceAfterLabel: dua simbol ≈ dalam 1 baris -> ambil harga di kurung, bukan jarak poin", () => {
  const text =
    "- Stop-Loss: 1,5 × ATR ≈ 193 poin di atas entry (≈ 63 200)\n" +
    "- Take-Profit: 2 × SL ≈ 386 poin di bawah entry (≈ 62 600) – rasio Risk:Reward ≈ 1:2";
  assert.equal(extractPriceAfterLabel(text, "Stop[\\s\\-–—]*Loss"), 63200);
  assert.equal(extractPriceAfterLabel(text, "Take[\\s\\-–—]*Profit"), 62600);
});

// --- Regresi: kasus nyata dari laporan user (screenshot BTCUSDT BUY, chart
// keluar "Entry 15 | TP 1 | SL 15"). Di sini AI menulis harga yang SUDAH BENAR
// persis setelah label ("Stop-Loss: 62400"), tapi keterangan di kurung
// setelahnya juga pakai simbol "≈" untuk RASIO/MULTIPLIER, bukan harga (mis.
// "≈1,5×ATR", "≈1:2"). Heuristik lama (nyari "≈" lalu ambil angka
// setelahnya) malah nangkep "1,5" -> jadi "15", dan "1:2" -> jadi "1".
// Perbaikan: kasih referencePrice (harga pasar terakhir) supaya sistem milih
// angka yang MASUK AKAL sebagai harga, bukan angka rasio yang jauh lebih kecil.
const NEW_FORMAT_TEXT = `🎯 Skenario Entry: Long di area 62560-62500 (di atas support historis 62500)
🛡️ Manajemen Risiko:
- Stop-Loss: 62400 (≈1,5×ATR di bawah entry, melindungi dari penembusan support)
- Take-Profit: 62890 (rasio Risk:Reward ≈1:2, target di bawah resistance pertama)`;

test("extractPriceAfterLabel: kurung berisi ≈ RASIO (bukan harga) -> dengan referencePrice, tetap ambil harga yang benar", () => {
  const referencePrice = 62800;
  assert.equal(
    extractPriceAfterLabel(NEW_FORMAT_TEXT, "Stop[\\s\\-–—]*Loss", referencePrice),
    62400
  );
  assert.equal(
    extractPriceAfterLabel(NEW_FORMAT_TEXT, "Take[\\s\\-–—]*Profit", referencePrice),
    62890
  );
  assert.equal(
    extractPriceAfterLabel(NEW_FORMAT_TEXT, "Skenario[\\s\\-–—]*Entry", referencePrice),
    62560
  );
});

test("extractPriceAfterLabel: window 1 label tidak nyerempet ke angka label lain di dekatnya", () => {
  // Tanpa batas window yang benar, window "Stop-Loss" bisa nyerempet sampai
  // ke angka "62890" milik Take-Profit, dan referencePrice yang kebetulan
  // lebih dekat ke situ bikin salah pilih.
  const referencePrice = 62850; // sengaja lebih dekat ke 62890 drpd 62400
  assert.equal(
    extractPriceAfterLabel(NEW_FORMAT_TEXT, "Stop[\\s\\-–—]*Loss", referencePrice),
    62400
  );
});

// --- Regresi: AI kadang nulis label pakai EN DASH "–" (bukan hyphen "-" biasa),
// misal "Stop–Loss" bukan "Stop-Loss". Kasus nyata: kode yang cari literal
// "Stop-Loss" gagal TOTAL menemukan "Stop–Loss", jadi SL/TP tampil "-" di
// caption gambar chart walau harga sudah benar ada di teks sinyalnya.
test("extractPriceAfterLabel: pola dash fleksibel tetap ketemu walau label pakai EN DASH", () => {
  const text = "- Stop–Loss: 63,084 (≈ +187 pips di atas entry)";
  const value = extractPriceAfterLabel(text, "Stop[\\s\\-–—]*Loss");
  assert.equal(value, 63084);
});

test("extractPriceAfterLabel: pola dash fleksibel tetap ketemu walau label pakai EM DASH", () => {
  const text = "Take—Profit: 62,300 – 61,900 (2 – 3 × jarak SL)";
  const value = extractPriceAfterLabel(text, "Take[\\s\\-–—]*Profit");
  assert.equal(value, 62300);
});

test("extractPriceAfterLabel: label dengan hyphen biasa TETAP jalan pakai pola dash fleksibel (tidak regresi)", () => {
  const text = "Take-Profit: 62,300 – 61,900";
  const value = extractPriceAfterLabel(text, "Take[\\s\\-–—]*Profit");
  assert.equal(value, 62300);
});

// --- Regresi: label dibungkus markdown bold ("**Keputusan:** SELL") ---
// Ini akar masalah nyata yang bikin gambar chart bergaris TIDAK PERNAH
// dikirim: kalau regex deteksi decision gagal match karena ada "**" di
// antara label dan nilainya, decision jadi null, dan proses kirim gambar
// chart di alarm() cuma jalan kalau decision valid & bukan WAIT.

test("detectDecision: format polos 'Keputusan: SELL' terdeteksi", () => {
  assert.equal(detectDecision("🎯 Keputusan: SELL\nBias Arah: Bearish"), "SELL");
});

test("detectDecision: format markdown '**Keputusan:** SELL' TETAP terdeteksi (bug utama)", () => {
  assert.equal(detectDecision("🎯 **Keputusan:** SELL\n**Bias Arah:** Bearish"), "SELL");
});

test("detectDecision: variasi '**Keputusan**: BUY' (colon di luar bold) tetap terdeteksi", () => {
  assert.equal(detectDecision("**Keputusan**: BUY"), "BUY");
});

test("detectDecision: WAIT dan BUY juga terdeteksi dengan benar", () => {
  assert.equal(detectDecision("**Keputusan:** WAIT"), "WAIT");
  assert.equal(detectDecision("**Keputusan:** BUY"), "BUY");
});

test("detectDecision: tidak ada label 'Keputusan' sama sekali -> null", () => {
  assert.equal(detectDecision("Tidak ada info keputusan di sini."), null);
});

test("tallyBias: bias per-AI dengan markdown bold '**Bias:** Bearish' tetap terhitung benar (bukan jatuh ke netral)", () => {
  const opinions = [
    { opinion: "**Bias:** Bearish, momentum turun." },
    { opinion: "Bias: Bullish, momentum naik." },
    { opinion: "**Bias:** Netral, menunggu konfirmasi." },
  ];
  const tally = tallyBias(opinions);
  assert.deepEqual(tally, { bullish: 1, bearish: 1, netral: 1 });
});

test("tallyBias: opinion tanpa baris Bias sama sekali -> dihitung netral (fallback aman)", () => {
  const tally = tallyBias([{ opinion: "Tidak ada baris bias di sini." }]);
  assert.deepEqual(tally, { bullish: 0, bearish: 0, netral: 1 });
});

// --- Strategi "Konfluensi 3 Pilar" ---
function opinion(number, title, bias) {
  return { label: `AI ${number} (${title})`, opinion: `Analisa singkat.\nBias: ${bias}` };
}

test("computePillarAlignment: mode cepat, 3 pilar (1,2,5) searah Bullish -> alignedCount 3", () => {
  const opinions = [
    opinion(1, "Trend", "Bullish"),
    opinion(2, "Momentum", "Bullish"),
    opinion(3, "Volatilitas", "Netral"),
    opinion(5, "Support & Resistance", "Bullish"),
    opinion(10, "Risk Management", "Netral"),
  ];
  const result = computePillarAlignment(opinions, "cepat");
  assert.equal(result.alignedCount, 3);
  assert.equal(result.dominant, "Bullish");
  assert.deepEqual(result.pillars, { trend: "Bullish", level: "Bullish", momentum: "Bullish" });
});

test("computePillarAlignment: mode cepat, cuma 2 dari 3 pilar searah -> alignedCount 2", () => {
  const opinions = [
    opinion(1, "Trend", "Bullish"),
    opinion(2, "Momentum", "Bearish"),
    opinion(5, "Support & Resistance", "Bullish"),
  ];
  const result = computePillarAlignment(opinions, "cepat");
  assert.equal(result.alignedCount, 2);
  assert.equal(result.dominant, "Bullish");
});

test("computePillarAlignment: mode lengkap, pilar Level Kunci (AI 5+6) seri -> dihitung Netral", () => {
  const opinions = [
    opinion(1, "Trend", "Bullish"),
    opinion(2, "Momentum", "Bullish"),
    opinion(5, "Support & Resistance", "Bullish"),
    opinion(6, "SMC", "Bearish"), // seri dengan #5 -> pilar Level Kunci jadi Netral
    opinion(7, "Price Action", "Bullish"),
  ];
  const result = computePillarAlignment(opinions, "lengkap");
  assert.equal(result.pillars.level, "Netral");
  // Trend (Bullish) & Momentum (Bullish, dari mayoritas AI 2+7) tetap searah -> alignedCount 2
  assert.equal(result.pillars.momentum, "Bullish");
  assert.equal(result.alignedCount, 2);
  assert.equal(result.dominant, "Bullish");
});

test("computePillarAlignment: tidak ada dominasi arah (semua Netral) -> alignedCount 0", () => {
  const opinions = [
    opinion(1, "Trend", "Netral"),
    opinion(2, "Momentum", "Netral"),
    opinion(5, "Support & Resistance", "Netral"),
  ];
  const result = computePillarAlignment(opinions, "cepat");
  assert.equal(result.alignedCount, 0);
  assert.equal(result.dominant, "Netral");
});

test("computePillarAlignment: aiMode 'fiboqm' -> null (punya logika bobot sendiri)", () => {
  assert.equal(computePillarAlignment([], "fiboqm"), null);
});
