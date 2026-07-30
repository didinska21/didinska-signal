# Didinska Signal Bot (v2 — Bot Interaktif)

Bot Telegram berbasis **menu interaktif**, bukan lagi push notifikasi otomatis.
User membuka menu dengan `/start`, lalu memilih fitur yang diinginkan.

## Perubahan dari versi sebelumnya
- ❌ Tidak ada lagi cron yang otomatis kirim sinyal tiap 15 menit
- ✅ Bot sekarang berbasis **webhook** — merespons saat user mengirim pesan/klik tombol
- ✅ Ada sistem menu bertingkat (main menu → submenu)
- ✅ Ada session state per user (disimpan di Cloudflare KV) supaya bot "ingat" konteks, misal saat user sedang di tengah proses kirim foto chart

## Struktur
```
src/
  index.js          # entry point: terima webhook POST dari Telegram
  telegram.js        # wrapper API Telegram (sendMessage, editMessageText, dll)
  menus.js            # semua definisi teks & inline keyboard menu
  state.js             # baca/tulis session per chat_id via KV
  handlers/
    router.js          # logika utama: routing pesan & callback query ke handler yang sesuai
  binance.js, indicators.js, groq.js
                       # BELUM dipakai di v2 ini — disiapkan untuk fitur
                       # analisis chart (Signal Trade) tahap berikutnya
```

## Menu yang sudah ada

**Main Menu** (`/start`)
- 📅 Jadwal News → submenu FOMC / NFP / PPI / CPI (klik = balasan "belum bisa digunakan, masih perbaikan")
- 📈 Signal Trade → minta user kirim foto chart (bisa multi-foto/multi-timeframe), lalu ketik `/selesai`. Untuk saat ini baru **menerima & menghitung foto**, belum ada analisis (placeholder).

## Setup

### 1. Buat KV Namespace (untuk session state)
```bash
npx wrangler kv namespace create SESSIONS
```
Copy `id` yang muncul, tempel ke `wrangler.toml` bagian `[[kv_namespaces]]`.

### 2. Set secrets
```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
```
> `TELEGRAM_CHAT_ID` tidak dipakai lagi di v2 ini (dulu untuk push manual), boleh dihapus dari secrets kalau mau beres-beres.

#### 2a. (Disarankan) API key terpisah per AI analyst — hindari rate limit
Kalau semua AI (1-10) pakai `GROQ_API_KEY` yang sama, mereka berebut kuota akun Groq
yang sama saat dipanggil berurutan → gampang kena `429 Too Many Requests` di tengah proses
(AI 1 sukses, AI 2 dst gagal).

Solusi: buat akun Groq tambahan (gratis), ambil API key masing-masing, lalu set sebagai
secret terpisah untuk tiap nomor AI:
```bash
npx wrangler secret put GROQ_API_KEY_1
npx wrangler secret put GROQ_API_KEY_2
npx wrangler secret put GROQ_API_KEY_3
# ...dst sampai GROQ_API_KEY_10
npx wrangler secret put GROQ_SUMMARIZER_API_KEY   # khusus AI Penyimpul
```
- Kalau `GROQ_API_KEY_<n>` tidak di-set untuk suatu nomor, AI itu otomatis fallback
  pakai `GROQ_API_KEY` biasa (jadi tidak wajib isi ke-10nya sekaligus, bisa bertahap).
- Kalau user pilih mode "5 AI", hanya `GROQ_API_KEY_1` s/d `GROQ_API_KEY_5` yang dipakai.
- Kalau ada AI yang gagal dan pesan error muncul di Telegram, sekarang errornya juga
  menyebutkan key mana yang dipakai (`GROQ_API_KEY_3` atau `GROQ_API_KEY (fallback)`),
  jadi lebih mudah dilacak.

### 3. Deploy
```bash
npm run deploy
```
(atau otomatis via Cloudflare Git Integration seperti sebelumnya)

### 4. Daftarkan webhook ke Telegram (WAJIB, cuma sekali)
Buka URL ini di browser (ganti `<TOKEN>` dan `<WORKER_URL>`):
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>/telegram-webhook
```
Contoh:
```
https://api.telegram.org/bot8035732233:AAF.../setWebhook?url=https://didinska-signal.mr-didinska21.workers.dev/telegram-webhook
```
Kalau berhasil, muncul respons `{"ok":true,"result":true,"description":"Webhook was set"}`.

### 5. Test
Buka chat bot di Telegram, ketik `/start` → menu utama harus muncul dengan tombol.

## Roadmap berikutnya (belum dikerjakan, menunggu arahan)
- [ ] Fungsi Jadwal News (FOMC/NFP/PPI/CPI) — ambil data kalender ekonomi real
- [ ] Analisis multi-timeframe dari foto chart (pakai Groq Vision model)
- [ ] Kemungkinan fitur tambahan lain (menyusul)

## Peringatan
Analisis yang dihasilkan bot ini (nanti, saat fitur analisis aktif) adalah keluaran model AI — **bukan nasihat keuangan**. Risiko trading sepenuhnya ditanggung pengguna.
