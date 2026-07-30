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
  handlers/router.js              # routing pesan & callback query

  # --- Data pasar & indikator ---
  binance.js                 # fetch candle OHLCV (Binance Futures, fallback Bybit)
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
https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>/telegram-webhook
```
Kalau berhasil, muncul respons `{"ok":true,"result":true,"description":"Webhook was set"}`.

### 5. Test
Buka chat bot di Telegram, ketik `/start` → menu utama harus muncul dengan tombol.

## Batasan yang perlu diketahui
- Deteksi Smart Money Concepts (`smc.js`) adalah **heuristik sederhana** berbasis aturan harga, bukan implementasi presisi institusional. Berguna sebagai konteks tambahan, bukan sinyal pasti.
- Data makro (`macroData.js`) fault-tolerant: kalau API BTC Dominance/Fear-Greed sedang down, field-nya jadi `null` dan AI 9 akan menyebutkan data tidak tersedia — proses tidak akan gagal total karena ini.
- Binance Futures API kadang men-geoblock IP datacenter Cloudflare (403) — sudah ada fallback otomatis ke Bybit.

## Roadmap berikutnya
- [ ] Fungsi Jadwal News (FOMC/NFP/PPI/CPI) — ambil data kalender ekonomi real
- [ ] Kemungkinan fitur tambahan lain (menyusul)

## Peringatan
Analisis yang dihasilkan bot ini adalah keluaran model AI berdasarkan probabilitas matematis — **bukan nasihat keuangan**. Risiko trading sepenuhnya ditanggung pengguna.
