# Didinska Signal Bot (v3 — Hybrid Multi-AI Specialist Signal Trade)

Bot Telegram berbasis **menu interaktif** (webhook), dengan fitur andalan
**Signal Trade**: 10 AI spesialis (masing-masing fokus di 1 dimensi analisis
teknikal berbeda) menganalisa pasar secara paralel-berurutan, lalu 1 **AI
Penyimpul** merangkum semuanya jadi 1 keputusan final (BUY/SELL/WAIT).

## Arsitektur Hybrid: API Data vs Foto
- **9 dari 10 AI spesialis** bekerja dari **data JSON** (candle OHLCV +
  indikator numerik dari Binance/Bybit) — akurat (baca angka persis, bukan
  menebak dari gambar), murah, dan cepat.
- **1 AI (Price Action)** tetap pakai **foto chart** dari user — karena pola
  candlestick & chart pattern (Head & Shoulders, Flag, dll) lebih natural
  dibaca visual daripada dari angka.

## Struktur
```
src/
  index.js              # entry point: terima webhook POST dari Telegram
  telegram.js             # wrapper API Telegram (sendMessage, editMessageText, getFile, dll)
  menus.js                  # semua definisi teks & inline keyboard menu
  state.js                    # wrapper baca/tulis ke SessionDO (Durable Object)
  session_do.js                 # Durable Object: session per chat_id + mesin proses multi-AI (pakai Alarm)
  handlers/router.js              # routing pesan & callback query (+ whitelist chat_id)
  htmlUtil.js                # escapeHtml() bersama, dipakai sebelum kirim teks apa pun (opini AI, error, dll) sebagai parse_mode HTML

  # --- Data pasar & indikator ---
  marketSource.js             # dispatcher: XAUUSD -> MT5 bridge, pair lain -> Binance/Bybit
  binance.js                 # fetch candle OHLCV (Binance Futures, fallback Bybit)
  mt5Source.js                # baca cache candle XAUUSD dari Mt5BridgeDO
  mt5_bridge_do.js              # Durable Object: cache candle + antrian sinyal eksekusi MT5 (1 instance/simbol)
  mt5Exec.js                   # helper antre sinyal eksekusi ke Mt5BridgeDO (dipanggil session_do.js)
  indicators.js                # EMA/RSI/MACD/ATR/Bollinger/Stochastic/OBV/Pivot/Fibonacci
  smc.js                         # heuristik Smart Money Concept (Order Block, FVG, BoS, Liquidity Grab)
  macroData.js                     # BTC Dominance (CoinGecko) & Fear/Greed Index (alternative.me)
  marketData.js                      # orkestrator: gabungkan semua di atas jadi 1 paket data per simbol

  # --- Pemanggilan AI ---
  analysts.js                  # definisi 10 AI spesialis: peran, tugas, & builder prompt masing-masing
  groqClient.js                  # shared: retry 429 (ikut header retry-after) + pemilihan API key per-AI
  groqText.js                      # panggilan Groq untuk 9 AI berbasis data JSON
  groqVision.js                      # panggilan Groq Vision untuk AI Price Action (foto) + AI Penyimpul

  groq.js                     # TIDAK dipakai di alur aktif — sisa arsitektur v1, dibiarkan untuk referensi
```

## Alur Signal Trade
1. Pilih mode trading (Scalping / Day Trade / Swing) — menentukan timeframe yang dipakai
2. Ketik simbol pair (misal `BTCUSDT`)
3. Pilih mode analisis:
   - 🚀 **Cepat** (5 AI): Trend, Momentum, Volatilitas, Support/Resistance, Risk Management — murni data API, tanpa foto
   - 🔬 **Lengkap** (10 AI): tambahan Volume, Smart Money Concept, Price Action (perlu 1 foto), Multi-Timeframe Alignment, Konteks Makro
4. (Khusus Lengkap) Kirim 1 foto chart
5. Bot mengambil data pasar (candle + indikator + SMC + pivot + makro), lalu tiap AI spesialis menganalisa satu per satu (progres ditampilkan realtime)
6. AI Penyimpul merangkum semua opini jadi 1 keputusan final: **BUY/SELL/WAIT**, Bias Arah, Level Kunci, Skenario Entry, Manajemen Risiko (SL/TP + R:R), dan estimasi Probabilitas

## 10 AI Spesialis

| # | Peran | Sumber Data |
|---|---|---|
| 1 | Trend (Moving Averages) | API — EMA20/50/200 |
| 2 | Momentum (Oscillators) | API — RSI, MACD, Stochastic |
| 3 | Volatilitas (Bands & ATR) | API — Bollinger Bands, ATR |
| 4 | Volume (Aliran Uang) | API — OBV |
| 5 | Support & Resistance | API — S/R historis, Pivot Points, Fibonacci |
| 6 | Smart Money Concepts | API — Order Block, FVG, BoS, Liquidity Grab (heuristik) |
| 7 | Price Action (Candlestick) | **Foto** |
| 8 | Multi-Timeframe Alignment | API — bandingkan trend timeframe utama vs HTF |
| 9 | Konteks Makro Kripto | API — BTC Dominance, Fear/Greed Index |
| 10 | Risk Management | API — kalkulasi SL/TP berbasis ATR |

> Menu Cepat menjalankan AI #1, 2, 3, 5, 10 saja. Menu Lengkap menjalankan semua 10 + AI Penyimpul.

## Menu yang sudah ada

**Main Menu** (`/start`)
- 📅 Jadwal News → submenu FOMC / NFP / PPI / CPI (masih placeholder, belum ambil data real)
- 📈 Signal Trade → aktif penuh, lihat alur di atas

## Setup

### 1. Durable Object binding
Sudah dikonfigurasi di `wrangler.toml` (`SESSION_DO` class `SessionDO`, migration `new_sqlite_classes`). Tidak perlu setup manual — cukup deploy.

### 2. Set secrets
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put GROQ_API_KEY
```

**Keamanan (sangat disarankan):**
```bash
# Secret token acak untuk verifikasi webhook (tolak request yang bukan dari Telegram)
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET

# Batasi bot cuma bisa dipakai chat_id tertentu, dipisah koma. Cek chat_id
# kamu lewat bot seperti @userinfobot.
npx wrangler secret put ALLOWED_CHAT_IDS
```

**Soal rate limit Groq:** isi API key **terpisah per AI** (maksimal 11: 10 spesialis + 1 penyimpul) supaya tiap AI punya kuota sendiri. Kalau tidak diisi, otomatis fallback ke `GROQ_API_KEY`.

```bash
npx wrangler secret put GROQ_API_KEY_1
npx wrangler secret put GROQ_API_KEY_2
npx wrangler secret put GROQ_API_KEY_3
npx wrangler secret put GROQ_API_KEY_4
npx wrangler secret put GROQ_API_KEY_5
npx wrangler secret put GROQ_API_KEY_6
npx wrangler secret put GROQ_API_KEY_7
npx wrangler secret put GROQ_API_KEY_8
npx wrangler secret put GROQ_API_KEY_9
npx wrangler secret put GROQ_API_KEY_10
npx wrangler secret put GROQ_SUMMARIZER_API_KEY
```

> Kode juga otomatis **retry** kalau kena 429 (ikut header `retry-after` dari Groq, maksimal 3x percobaan), dan mendeteksi kalau AI Penyimpul (model reasoning) mengembalikan jawaban kosong karena token habis dipakai "berpikir".

Opsional, kalau Groq deprecate model default:
```bash
npx wrangler secret put GROQ_VISION_MODEL     # dipakai AI Price Action
npx wrangler secret put GROQ_SUMMARY_MODEL    # dipakai AI Penyimpul
npx wrangler secret put GROQ_TEXT_MODEL       # dipakai 9 AI spesialis berbasis data JSON
```

### 3. Deploy
```bash
npm run deploy
```

### 4. Daftarkan webhook ke Telegram (WAJIB, cuma sekali)
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```
(Kalau tidak set `TELEGRAM_WEBHOOK_SECRET`, parameter `&secret_token=...` boleh dihilangkan — tapi endpoint jadi tidak terverifikasi.)

Kalau berhasil, muncul respons `{"ok":true,"result":true,"description":"Webhook was set"}`.

### 5. Test
Buka chat bot di Telegram, ketik `/start` → menu utama harus muncul dengan tombol.
Kalau `ALLOWED_CHAT_IDS` sudah diisi dan chat_id kamu tidak ada di daftar, bot akan diam saja (tidak membalas apa pun).

### 6. Jalankan unit test (opsional, tidak butuh deploy)
```bash
npm test
```
Menguji fungsi-fungsi indikator (`indicators.js`) dan heuristik Smart Money Concept (`smc.js`) pakai Node.js built-in test runner — tidak perlu install dependency tambahan.

## Batasan yang perlu diketahui
- Deteksi Smart Money Concepts (`smc.js`) adalah **heuristik sederhana** berbasis aturan harga, bukan implementasi presisi institusional. Berguna sebagai konteks tambahan, bukan sinyal pasti.
- Data makro (`macroData.js`) fault-tolerant: kalau API BTC Dominance/Fear-Greed sedang down, field-nya jadi `null` dan AI 9 akan menyebutkan data tidak tersedia — proses tidak akan gagal total karena ini.
- Binance Futures API kadang men-geoblock IP datacenter Cloudflare (403) — sudah ada fallback otomatis ke Bybit.

## MT5 Bridge (XAUUSD) — eksekusi otomatis ke MetaTrader 5

Selain pair kripto (Binance/Bybit), bot ini sekarang bisa analisa **XAUUSD**
dengan data candle langsung dari server broker kamu (via MT5), dan
mengeksekusi otomatis hasil sinyal BUY/SELL ke akun MT5 **demo**.

- `src/mt5_bridge_do.js` — Durable Object cache candle + antrian sinyal, 1 instance per simbol
- `src/marketSource.js` — dispatcher: XAUUSD → MT5 bridge, pair lain → Binance/Bybit (tidak berubah)
- `mt5_bridge/mt5_bridge.py` — script Python yang kamu jalankan di laptop (nanti VPS), connect ke MT5, push candle & eksekusi order

Alur: pilih mode trading → pilih **XAUUSD** (tombol pintasan tersedia) →
pilih mode AI (Cepat/Lengkap/Fibo&QM) → kalau hasilnya BUY/SELL dengan
Entry/SL/TP lengkap, bot otomatis antre eksekusi ke bridge → bridge
eksekusi ke MT5 demo → notifikasi hasil dikirim balik ke Telegram. Kalau
WAIT, tidak ada eksekusi sama sekali.

Setup lengkap: lihat `mt5_bridge/README.md`.

⚠️ Masih **demo only**. Bridge sekarang jalan 24/7 di VPS Windows. Eksekusi
**manual** (klik tombol Signal Trade) masih lot fixed sederhana
(`MT5_DEFAULT_LOT`). Eksekusi **Strategi 1** (`/auto XAUUSD` atau tombol
keyboard) sudah pakai position sizing dinamis berbasis % risiko akun & tetap
punya native SL/TP di broker. Eksekusi **Strategi 2** (tombol keyboard, 10
layer) pakai lot fixed & **TIDAK punya native SL/TP sama sekali** — kalau
bridge mati, layer yang lagi terbuka tidak terlindungi apa pun sampai bridge
nyala lagi. Lihat bagian "Mode OTONOM" & "Strategi 2" di bawah.

## Mode OTONOM (khusus XAUUSD) — trading tanpa pencet apa-apa

Selain eksekusi manual (kamu klik tombol Signal Trade di Telegram), sekarang
ada mode **otonom**: bot analisa XAUUSD sendiri tiap 10 menit (fitur
"Auto-Signal" yang sudah ada) DAN eksekusi ke MT5 sendiri kalau hasilnya
BUY/SELL — tanpa kamu perlu klik apa pun.

**Saklar utama WAJIB dinyalakan manual** — set env var `MT5_AUTONOMOUS_XAUUSD=true`
di Cloudflare (Settings → Variables and Secrets). Kalau tidak diisi/bukan
persis "true", mode otonom TIDAK PERNAH eksekusi ke MT5 (siklus auto tetap
jalan kirim sinyal teks doang, seperti sebelumnya).

`/auto XAUUSD [scalping|daytrade|swing]` otomatis pakai mode **Lengkap (10
AI)** — simbol kripto lain tetap **Cepat (5 AI)** buat siklus auto, biar
tidak boros limit Groq API kalau dipakai ke banyak pair kripto sekaligus.

3 lapis kontrol risiko yang otomatis aktif begitu saklar utama dinyalakan:
1. **Maksimal 1 posisi terbuka** dalam satu waktu (khusus XAUUSD/bot ini) — sinyal baru ditolak selama masih ada posisi terbuka
2. **Limit trade per hari** — default 5, atur lewat `MT5_MAX_TRADES_PER_DAY`
3. **Circuit breaker rugi harian** — default 3% dari equity awal hari, atur lewat `MT5_MAX_DAILY_LOSS_PCT`. Kalau tersentuh, mode otonom berhenti eksekusi sampai hari berikutnya (UTC)

Ditambah **position sizing dinamis berbasis % risiko** (khusus jalur
otonom ini, bukan eksekusi manual): SL/TP tetap harga asli dari AI
Penyimpul (native order MT5, jadi tetap jaring pengaman utama walau bridge
Python mati) — tapi **lot dihitung ulang tiap entry** dari balance saat
itu, supaya kalau SL asli kena, kerugian ≈ 1% balance (`RISK_SL_PCT` di
`src/session_do.js`). Kalau lot hasil hitung di bawah lot minimum broker
(modal terlalu kecil untuk jarak SL sinyal), eksekusi dibatalkan otomatis
demi keamanan (bukan dipaksa pakai lot minimum).

Sebagai lapisan **tambahan** (paralel, bukan pengganti native SL/TP):
`mt5_bridge.py` juga memantau floating profit/rugi posisi tiap siklus
polling, dan force-close otomatis begitu floating menyentuh
**+2%/-1% dari balance** (`FORCE_CLOSE_PROFIT_PCT`/`FORCE_CLOSE_LOSS_PCT` di
`mt5_bridge.py`) — SEBELUM harga sempat sampai ke level SL/TP asli sinyal
(berguna terutama di sisi profit, karena TP asli AI bisa saja jauh lebih
jauh dari 2%). Siapa pun yang kena duluan (native price-based, atau
floating %-based ini) yang menutup posisi.

Semua kontrol ini butuh `mt5_bridge.py` versi terbaru (ada fungsi
`report_account_status()` yang lapor balance/equity/posisi tiap siklus
push). Kalau bridge belum lapor status sama sekali (misal baru start),
mode otonom otomatis menolak eksekusi sampai ada laporan status pertama.

Selama masih ada posisi terbuka, siklus auto XAUUSD **skip analisa AI sama
sekali** (tidak ambil data pasar, tidak panggil AI) tiap 10 menit berikutnya
— baru jalan normal lagi begitu posisi sudah tertutup (native SL/TP,
force-close %, atau manual). Ini hemat limit API Groq karena toh sinyal
baru bakal ditolak guardrail "1 posisi" juga.

Trading kripto (BTCUSDT dll) TIDAK terpengaruh fitur-fitur ini — semuanya
cuma berlaku untuk XAUUSD/MT5.

### Strategi 2 — 10 Layer Independen (opsional, saling eksklusif dengan Strategi 1)

Dipicu lewat keyboard PERMANEN (nempel di atas kolom ketik Telegram, kirim
`/start` buat memunculkannya) — bukan lewat command teks seperti Strategi 1.
Tap tombol "🧭 Strategi 1" / "🧱 Strategi 2" lalu pilih trade mode, sistem
otomatis mulai siklus auto yang sesuai. **Cuma 1 yang aktif dalam satu
waktu** — mulai salah satu otomatis mengganti siklus auto yang lain (posisi
yang KEBETULAN sudah terbuka dari strategi lama TIDAK dipaksa tutup, tetap
dipantau/berjalan sampai closenya sendiri).

Beda mendasar dari Strategi 1:
- Sampai **10 posisi independen** sekaligus (bukan cuma 1) — tiap posisi
  ("layer") tidak saling terkait dengan layer lain.
- **Market order MURNI, TANPA native SL/TP sama sekali.** Ini keputusan
  sadar demi kesederhanaan — konsekuensinya, layer yang terbuka **100%
  bergantung bridge Python nyala & polling normal**; tidak ada jaring
  pengaman di level broker seperti Strategi 1.
- Tiap layer auto-close **sendiri-sendiri** (independen) begitu floating-nya
  sendiri menyentuh **+$2 (TP)** atau **-$1 (SL)** — FLAT dollar, BUKAN %
  dari balance seperti Strategi 1. Diatur lewat `LAYER_TP_USD`/
  `LAYER_SL_USD` di `mt5_bridge.py`.
- Lot **FIXED** sama untuk semua layer (default 0.01, env var
  `MT5_LAYER_LOT`) — bukan dihitung dari % risiko.
- **TIDAK ADA** limit trade harian atau circuit breaker rugi harian (beda
  dari Strategi 1) — sesuai permintaan eksplisit, murni berbasis TP $2/SL $1
  per layer.
- Mode AI auto selalu **Cepat (5 AI)** — trade mode (Scalping/Day/Swing)
  tetap dipilih user lewat tombol.
- Siklus auto skip otomatis (tanpa panggil AI) begitu sudah pas 10 layer
  terbuka, hemat limit API Groq — sama seperti Strategi 1.

Semua angka Strategi 2 (MAX_LAYERS, LAYER_TP_USD, LAYER_SL_USD,
MAGIC_NUMBER_LAYER) tersebar di 3 file (`src/session_do.js`,
`src/mt5_bridge_do.js`, `mt5_bridge/mt5_bridge.py`) — kalau mau ubah salah
satu angka, ubah di ketiganya biar tetap sinkron.

## Roadmap berikutnya
- [x] Pindahkan MT5 bridge dari laptop ke VPS supaya jalan 24 jam — sudah pakai VPS Windows 24/7
- [x] Position sizing berbasis % risiko akun (bukan lot fixed) — sudah jalan untuk jalur OTONOM XAUUSD, lihat bagian "Mode OTONOM" di atas. Eksekusi manual masih lot fixed.
- [ ] Fungsi Jadwal News (FOMC/NFP/PPI/CPI) — ambil data kalender ekonomi real
- [ ] Kemungkinan fitur tambahan lain (menyusul)

## Peringatan
Analisis yang dihasilkan bot ini adalah keluaran model AI berdasarkan probabilitas matematis — **bukan nasihat keuangan**. Risiko trading sepenuhnya ditanggung pengguna.
