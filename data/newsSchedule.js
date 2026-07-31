/**
 * Jadwal rilis data ekonomi — DIISI MANUAL (bukan dari API).
 *
 * CARA ISI:
 * - Tambahin tanggal & jam dalam format UTC (ISO 8601), contoh: "2026-09-18T18:00:00Z"
 * - Bot otomatis konversi ke WIB (UTC+7) waktu ditampilkan ke user, jadi
 *   kamu isi apa adanya sesuai sumber kalender ekonomi (Investing.com,
 *   Forex Factory, dll biasanya default tampilin dalam UTC atau GMT).
 * - Jadwal yang sudah lewat otomatis nggak ditampilkan lagi (nggak perlu
 *   dihapus manual, tapi boleh dibersihkan sesekali biar file nggak kepanjangan).
 * - Urutan di array bebas, bot yang urutin dari yang paling dekat.
 *
 * Contoh: "2026-09-18T18:00:00Z" -> Jumat, 19 September 2026, 01:00 WIB
 */

/**
 * Jadwal rilis data ekonomi — DIISI MANUAL (bukan dari API).
 *
 * CARA ISI:
 * - Tambahin tanggal & jam dalam format UTC (ISO 8601), contoh: "2026-09-18T18:00:00Z"
 * - Bot otomatis konversi ke WIB (UTC+7) waktu ditampilkan ke user, jadi
 *   kamu isi apa adanya sesuai sumber kalender ekonomi (Investing.com,
 *   Forex Factory, dll biasanya default tampilin dalam UTC atau GMT).
 * - Jadwal yang sudah lewat otomatis nggak ditampilkan lagi (nggak perlu
 *   dihapus manual, tapi boleh dibersihkan sesekali biar file nggak kepanjangan).
 * - Urutan di array bebas, bot yang urutin dari yang paling dekat.
 *
 * Contoh: "2026-09-18T18:00:00Z" -> Jumat, 19 September 2026, 01:00 WIB
 *
 * DATA DI BAWAH: diisi dari jadwal resmi per 31 Juli 2026, sampai akhir 2026.
 * - FOMC: statement release ~14:00 ET (hari ke-2 tiap meeting) — federalreserve.gov
 * - NFP (Employment Situation), CPI, PPI: rilis 08:30 ET — bls.gov/schedule
 * CATATAN: jadwal ini bisa berubah (jarang, tapi pernah terjadi kalau ada
 * force majeure/shutdown pemerintah AS) — selalu ada baiknya dicek ulang
 * ke sumber resminya kalau mendekati tanggalnya.
 */

export const NEWS_SCHEDULE = {
  fomc: [
    "2026-09-16T18:00:00Z", // FOMC 15-16 Sep 2026 (+ dot plot/SEP)
    "2026-10-28T18:00:00Z", // FOMC 27-28 Okt 2026
    "2026-12-09T19:00:00Z", // FOMC 8-9 Des 2026 (+ dot plot/SEP)
  ],
  nfp: [
    "2026-08-07T12:30:00Z", // data Juli 2026
    "2026-09-04T12:30:00Z", // data Agustus 2026
    "2026-10-02T12:30:00Z", // data September 2026
    "2026-11-06T13:30:00Z", // data Oktober 2026
    "2026-12-04T13:30:00Z", // data November 2026
  ],
  ppi: [
    "2026-08-13T12:30:00Z", // data Juli 2026
    "2026-09-10T12:30:00Z", // data Agustus 2026
    "2026-10-15T12:30:00Z", // data September 2026
    "2026-11-13T13:30:00Z", // data Oktober 2026
    "2026-12-15T13:30:00Z", // data November 2026
  ],
  cpi: [
    "2026-08-12T12:30:00Z", // data Juli 2026
    "2026-09-11T12:30:00Z", // data Agustus 2026
    "2026-10-14T12:30:00Z", // data September 2026
    "2026-11-10T13:30:00Z", // data Oktober 2026
    "2026-12-10T13:30:00Z", // data November 2026
  ],
};
