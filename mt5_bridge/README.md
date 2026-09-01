# MT5 Bridge — XAUUSD

Script Python ini menjembatani MetaTrader 5 (di laptop kamu) dengan Didinska
Signal Bot (Worker). Dua tugasnya:
1. Push candle XAUUSD terbaru ke Worker (jadi sumber data buat AI, gantiin Binance/Bybit khusus simbol ini).
2. Polling sinyal BUY/SELL yang keluar dari bot → eksekusi otomatis ke MT5 (akun **DEMO**), lalu lapor balik hasilnya.

## Setup

### 1. Siapkan MT5
- Buka terminal MT5, **login ke akun DEMO**.
- Nyalakan **Algo Trading** (tombol di toolbar, harus hijau/aktif). Kalau mati, order via script tidak akan jalan.
- Pastikan XAUUSD ada di Market Watch (klik kanan Market Watch → Symbols kalau belum kelihatan). Catat nama persisnya — kadang broker kasih suffix (`XAUUSD.m`, `XAUUSDm`, dll).

### 2. Install Python & dependency
Butuh **Python 3.10+ versi Windows** (package `MetaTrader5` cuma jalan di Windows, karena dia manggil terminal MT5 lokal langsung).

```cmd
cd mt5_bridge
pip install -r requirements.txt
```

### 3. Set secret di Worker (kalau belum)
```bash
npx wrangler secret put MT5_BRIDGE_SECRET
```
Isi dengan string acak (misal hasil `openssl rand -hex 32` atau random string apapun yang panjang).

Deploy ulang worker setelah nambah binding `MT5_BRIDGE_DO` di `wrangler.toml`:
```bash
npm run deploy
```

### 4. Isi konfigurasi di `mt5_bridge.py`
Buka file, sesuaikan bagian atas:
```python
WORKER_URL = "https://didinska-signal.<subdomain-kamu>.workers.dev"
BRIDGE_SECRET = "<samain persis dengan MT5_BRIDGE_SECRET di worker>"
SYMBOL = "XAUUSD"  # ganti kalau nama simbol di broker kamu beda
```

### 5. Jalankan
```cmd
python mt5_bridge.py
```
Biarkan jendela CMD ini **tetap terbuka** selama kamu mau bot bisa analisa XAUUSD. Kalau ditutup, permintaan analisa XAUUSD di Telegram akan gagal dengan pesan "data basi / belum ada data" — itu tandanya bridge tidak jalan, bukan bug.

### 6. Tes di Telegram
`/start` → Signal Trade → pilih mode trading → tombol **🥇 XAUUSD (Gold/MT5)** → pilih mode AI (5/10/Fibo&QM) → tunggu hasil.

- Kalau hasilnya **BUY/SELL** dan Entry/SL/TP berhasil kebaca lengkap → bot otomatis antre sinyal ke bridge, bridge eksekusi ke MT5 demo, kamu dapat notifikasi Telegram hasil eksekusinya (sukses/gagal + ticket).
- Kalau **WAIT** → tidak ada eksekusi sama sekali (sesuai permintaan awal kamu).
- Kalau Entry/SL/TP gagal kebaca lengkap dari teks AI (jarang, tapi bisa terjadi) → bot **membatalkan eksekusi otomatis** demi keamanan, cukup kasih notifikasi supaya kamu cek manual.

## Yang perlu kamu tahu / batasan tahap ini

- **Lot size**: eksekusi MANUAL (klik tombol Signal Trade) masih **FIXED** (default 0.01, bisa diubah lewat env var `MT5_DEFAULT_LOT` di Worker). Eksekusi **OTONOM** (baik Strategi 1 `/auto XAUUSD` maupun Strategi 2 lewat keyboard permanen) sudah **dinamis** — dihitung tiap entry dari balance saat itu supaya risiko ke SL asli ≈ 1% balance (lihat `RISK_SL_PCT`/`calcRiskBasedLot` di `src/session_do.js`). Kalau modal terlalu kecil untuk jarak SL sinyal (lot hasil hitung < lot minimum), eksekusi dibatalkan otomatis (bukan dipaksa pakai lot minimum).
- **Force-close berbasis %** (Strategi 1 & Strategi 2 — mekanisme SAMA): selain native SL/TP di order (harga persis dari AI Penyimpul), script ini juga cek floating profit/rugi tiap siklus polling (`check_and_force_close()`) dan tutup paksa posisi kalau floating sudah nyentuh `FORCE_CLOSE_PROFIT_PCT`/`FORCE_CLOSE_LOSS_PCT` (default +2%/-1% dari balance) — SEBELUM harga sempat sampai ke level SL/TP native. Dua lapis ini jalan paralel; siapa pun yang kena duluan yang menutup posisi. Satu-satunya beda Strategi 1 vs Strategi 2 adalah magic number order di MT5 (`MAGIC_NUMBER` vs `MAGIC_NUMBER_S2`, biar gampang dibedain di history) dan kedalaman analisa AI (10 AI/menyeluruh vs 5 AI/cepat-scalping) — eksekusi & risk management-nya identik.
- **Safety check demo-only** ada di `mt5_bridge.py` (`REQUIRE_DEMO_ACCOUNT = True`) — script akan menolak jalan kalau akun yang login ternyata bukan demo. JANGAN diubah sampai kamu benar-benar siap & paham risikonya.
- Bridge ini didesain jalan 24/7 di VPS Windows. Kalau bridge mati/disconnect, seluruh alur (data candle, eksekusi, force-close %) berhenti — native SL/TP tetap jalan di server broker walau bridge mati (jaring pengaman utama), tapi force-close % (jaring pengaman kedua) tidak akan jalan sampai bridge nyala lagi.
- Slippage/deviation eksekusi (termasuk force-close) di-set 20 poin (`deviation`) — sesuaikan kalau spread XAUUSD broker kamu lebih lebar dari itu.
