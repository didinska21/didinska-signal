# Futures Signal Bot

Bot sinyal trading futures otomatis. Alur: **Binance (data)** → **Groq (analisis AI)** → **Telegram (notifikasi)**, dijalankan berkala via **Cloudflare Workers Cron**, dan di-deploy otomatis lewat **GitHub Actions**.

## Struktur
```
src/
  index.js       # entry point: cron handler + fetch handler (testing manual)
  binance.js     # ambil data candle OHLCV
  indicators.js  # EMA, RSI, MACD, ATR, Bollinger Bands, Support/Resistance
  groq.js        # generate narasi sinyal via Groq LLM
  telegram.js    # kirim pesan ke Telegram
wrangler.toml    # konfigurasi Worker & jadwal cron
.github/workflows/deploy.yml  # CI/CD auto-deploy
```

## Setup Awal

### 1. Buat akun & ambil kredensial
- **Groq**: buat API key di https://console.groq.com/keys
- **Telegram**: buat bot via [@BotFather](https://t.me/BotFather) → dapatkan `TELEGRAM_BOT_TOKEN`. Tambahkan bot ke grup/channel, lalu ambil `chat_id` (bisa pakai https://api.telegram.org/bot<TOKEN>/getUpdates setelah kirim pesan apapun ke bot/grup).
- **Cloudflare**: buat akun, catat `Account ID` (di dashboard), buat API Token dengan izin "Edit Workers".

### 2. Install & login
```bash
cd futures-signal-bot
npm install
npx wrangler login
```

### 3. Set secrets (rahasia, tidak masuk ke repo)
```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

### 4. Testing lokal
```bash
npm run dev
# buka http://localhost:8787 untuk trigger manual pipeline
```

### 5. Deploy manual (opsional, sebelum pakai CI/CD)
```bash
npm run deploy
```

## Setup CI/CD (GitHub Actions)
Tambahkan secrets berikut di **Settings → Secrets and variables → Actions** pada repo GitHub:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Setiap push ke branch `main` akan otomatis deploy ulang Worker.

> Catatan: secrets aplikasi (`GROQ_API_KEY`, `TELEGRAM_*`) **tidak** diatur lewat GitHub Actions — itu tersimpan langsung di Cloudflare (langkah 3), tidak perlu diulang tiap deploy.

## Konfigurasi
Edit `wrangler.toml` bagian `[vars]` dan `[triggers]` untuk mengubah:
- `SYMBOL` — pair yang dipantau (misal `ETHUSDT`)
- `INTERVAL` — timeframe candle (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`)
- `crons` — frekuensi eksekusi

## Roadmap Pengembangan (ide next steps)
- [ ] Simpan histori sinyal ke Cloudflare KV/D1 untuk tracking win-rate
- [ ] Tambah multi-symbol (loop beberapa pair dalam satu cron run)
- [ ] Tambah filter volatilitas (skip sinyal jika ATR terlalu rendah/choppy)
- [ ] Tambah command interaktif di Telegram (`/signal BTCUSDT`) via webhook
- [ ] Tambah backtesting sederhana sebelum sinyal live dipakai

## Peringatan
Sinyal yang dihasilkan adalah keluaran model AI berbasis indikator teknikal — **bukan nasihat keuangan**. Selalu gunakan manajemen risiko dan keputusan trading tetap tanggung jawab pengguna.
