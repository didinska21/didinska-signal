"""
mt5_bridge.py — Jembatan antara MetaTrader 5 (di laptop/VPS kamu) dan
Didinska Signal Bot (Cloudflare Worker).

CARA KERJA (loop terus-menerus sampai di-Ctrl+C):
  1. PUSH candle terbaru XAUUSD (semua timeframe yang dibutuhkan bot: 1m,
     5m, 15m, 1h, 4h, 1d) ke Worker, tiap PUSH_INTERVAL_SEC detik.
  2. POLLING ke Worker: ada sinyal BUY/SELL yang perlu dieksekusi?
     Kalau ada -> eksekusi market order ke MT5 (akun DEMO), lalu laporkan
     hasilnya (sukses/gagal, ticket, harga fill) balik ke Worker supaya
     bot bisa kirim notifikasi ke Telegram.

CARA PAKAI:
  1. pip install -r requirements.txt
  2. Buka & login MT5 ke akun DEMO kamu, pastikan "Algo Trading" AKTIF
     (tombol di toolbar MT5, harus hijau/nyala).
  3. Isi konfigurasi di bawah (WORKER_URL, BRIDGE_SECRET) sesuai punya kamu.
  4. Jalankan lewat CMD:  python mt5_bridge.py
  5. Biarkan jendela CMD ini tetap terbuka selama kamu mau bot analisa
     XAUUSD. Kalau ditutup, Worker akan bilang "data basi" saat user minta
     analisis XAUUSD (karena tidak ada yang push candle lagi).

⚠️ SAFETY: script ini SENGAJA menolak jalan (lihat cek REQUIRE_DEMO_ACCOUNT
di bawah) kalau akun yang login di MT5 terdeteksi BUKAN akun demo — supaya
tidak ada order beneran ke akun live tanpa sengaja selama masih tahap
percobaan. Kalau nanti sudah siap live, ubah manual (dan sadari risikonya).
"""

import time
import traceback
from datetime import datetime, timezone

import requests

try:
    import MetaTrader5 as mt5
except ImportError:
    raise SystemExit(
        "Package 'MetaTrader5' belum terinstall. Jalankan dulu: pip install MetaTrader5\n"
        "(Catatan: package ini cuma jalan di Windows, karena butuh terminal MT5 asli.)"
    )

# ============================== KONFIGURASI ==============================

# URL worker kamu, TANPA trailing slash. Contoh:
# "https://didinska-signal.<subdomain-kamu>.workers.dev"
WORKER_URL = "https://didinska-signal.YOUR-SUBDOMAIN.workers.dev"

# Harus SAMA PERSIS dengan secret MT5_BRIDGE_SECRET yang di-set di Worker
# (npx wrangler secret put MT5_BRIDGE_SECRET).
BRIDGE_SECRET = "isi-dengan-secret-yang-sama-seperti-di-worker"

SYMBOL = "XAUUSD"  # sesuaikan kalau nama simbol di broker kamu beda (misal "XAUUSD.m", "GOLD", dll)

# Timeframe yang dibutuhkan bot (lihat TIMEFRAME_CONFIG di src/marketData.js):
# scalping -> 5m & 1h, daytrade -> 15m & 4h, swing -> 4h & 1d. Plus 1m untuk
# "harga terkini" (dipakai cek TP/SL auto-signal) dan 1d untuk pivot point.
MT5_TIMEFRAMES = {
    "1m": mt5.TIMEFRAME_M1,
    "5m": mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "1h": mt5.TIMEFRAME_H1,
    "4h": mt5.TIMEFRAME_H4,
    "1d": mt5.TIMEFRAME_D1,
}
CANDLE_COUNT = 300  # cukup untuk EMA200 (lihat CANDLE_LIMIT di marketData.js)

PUSH_INTERVAL_SEC = 15  # seberapa sering push candle terbaru ke Worker
POLL_INTERVAL_SEC = 5  # seberapa sering cek ada sinyal baru yang perlu dieksekusi

REQUIRE_DEMO_ACCOUNT = True  # JANGAN diubah ke False kecuali kamu SENGAJA mau live & paham risikonya
MAGIC_NUMBER = 20260815  # angka identifier order dari bot ini (biar gampang dibedain di history MT5)
ORDER_COMMENT = "didinska-signal-bot"

# ============================================================================

HEADERS = {"Content-Type": "application/json", "X-Bridge-Secret": BRIDGE_SECRET}


def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def connect_mt5():
    if not mt5.initialize():
        raise SystemExit(f"Gagal connect ke MT5: {mt5.last_error()}. Pastikan terminal MT5 sedang terbuka & login.")

    account_info = mt5.account_info()
    if account_info is None:
        raise SystemExit("Tidak bisa baca info akun MT5 — pastikan sudah login.")

    is_demo = account_info.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO
    log(f"Login MT5 sukses. Akun: {account_info.login} | Server: {account_info.server} | Demo: {is_demo}")

    if REQUIRE_DEMO_ACCOUNT and not is_demo:
        mt5.shutdown()
        raise SystemExit(
            "⛔ Akun yang login BUKAN akun demo, tapi REQUIRE_DEMO_ACCOUNT=True. "
            "Bridge berhenti demi keamanan (menghindari order tidak sengaja ke akun live)."
        )

    symbol_info = mt5.symbol_info(SYMBOL)
    if symbol_info is None:
        mt5.shutdown()
        raise SystemExit(
            f"Simbol '{SYMBOL}' tidak ditemukan di broker ini. Cek nama persis di Market Watch MT5 "
            f"(kadang ada suffix, misal 'XAUUSD.m' atau 'XAUUSDm') lalu ubah variabel SYMBOL di script ini."
        )
    if not symbol_info.visible:
        mt5.symbol_select(SYMBOL, True)


def candle_to_dict(rate):
    # MT5 rate: (time, open, high, low, close, tick_volume, spread, real_volume)
    # time dari MT5 dalam detik UNIX (UTC) -> Worker/bot expect milidetik,
    # sama seperti format Binance (lihat src/binance.js).
    time_ms = int(rate["time"]) * 1000
    return {
        "openTime": time_ms,
        "open": float(rate["open"]),
        "high": float(rate["high"]),
        "low": float(rate["low"]),
        "close": float(rate["close"]),
        "volume": float(rate["tick_volume"]),
        "closeTime": time_ms,
    }


def push_all_candles():
    for interval, mt5_tf in MT5_TIMEFRAMES.items():
        try:
            rates = mt5.copy_rates_from_pos(SYMBOL, mt5_tf, 0, CANDLE_COUNT)
            if rates is None or len(rates) == 0:
                log(f"⚠️ Gagal ambil candle {interval} dari MT5: {mt5.last_error()}")
                continue

            candles = [candle_to_dict(r) for r in rates]
            resp = requests.post(
                f"{WORKER_URL}/mt5-bridge/candles",
                json={"symbol": SYMBOL, "interval": interval, "candles": candles},
                headers=HEADERS,
                timeout=15,
            )
            if resp.status_code != 200:
                log(f"⚠️ Push candle {interval} gagal ({resp.status_code}): {resp.text[:200]}")
        except Exception as err:
            log(f"⚠️ Error push candle {interval}: {err}")


def poll_and_execute_signal():
    try:
        resp = requests.get(
            f"{WORKER_URL}/mt5-bridge/signal",
            params={"symbol": SYMBOL},
            headers=HEADERS,
            timeout=15,
        )
        if resp.status_code != 200:
            log(f"⚠️ Polling sinyal gagal ({resp.status_code}): {resp.text[:200]}")
            return

        data = resp.json()
        signal = data.get("signal")
        if not signal:
            return  # tidak ada sinyal baru, wajar & sering terjadi

        log(f"📥 Sinyal baru diterima: {signal['decision']} entry~{signal['entry']} sl={signal['sl']} tp={signal['tp']}")
        execute_order(signal)
    except Exception as err:
        log(f"⚠️ Error polling/eksekusi sinyal: {err}")
        traceback.print_exc()


def execute_order(signal):
    decision = signal["decision"]
    sl = float(signal["sl"])
    tp = float(signal["tp"])
    lot = float(signal.get("lot") or 0.01)
    signal_id = signal["signalId"]
    chat_id = signal.get("chatId")

    tick = mt5.symbol_info_tick(SYMBOL)
    if tick is None:
        report_execution(signal_id, chat_id, "failed", message="Gagal ambil harga tick terkini dari MT5.")
        return

    if decision == "BUY":
        order_type = mt5.ORDER_TYPE_BUY
        price = tick.ask
    elif decision == "SELL":
        order_type = mt5.ORDER_TYPE_SELL
        price = tick.bid
    else:
        report_execution(signal_id, chat_id, "failed", message=f"Decision '{decision}' tidak valid untuk eksekusi (harus BUY/SELL).")
        return

    request_payload = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": SYMBOL,
        "volume": lot,
        "type": order_type,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": 20,  # slippage maksimal yang ditoleransi, dalam poin
        "magic": MAGIC_NUMBER,
        "comment": ORDER_COMMENT,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request_payload)

    if result is None:
        report_execution(signal_id, chat_id, "failed", message=f"order_send mengembalikan None: {mt5.last_error()}")
        return

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        log(f"❌ Order gagal, retcode={result.retcode}, comment={result.comment}")
        report_execution(signal_id, chat_id, "failed", message=f"retcode {result.retcode}: {result.comment}")
        return

    log(f"✅ Order sukses. Ticket={result.order}, fill price={result.price}")
    report_execution(signal_id, chat_id, "filled", ticket=result.order, fill_price=result.price)


def report_execution(signal_id, chat_id, status, ticket=None, fill_price=None, message=None):
    try:
        requests.post(
            f"{WORKER_URL}/mt5-bridge/execution",
            json={
                "symbol": SYMBOL,
                "signalId": signal_id,
                "chatId": chat_id,
                "status": status,
                "ticket": ticket,
                "fillPrice": fill_price,
                "message": message,
            },
            headers=HEADERS,
            timeout=15,
        )
    except Exception as err:
        log(f"⚠️ Gagal lapor hasil eksekusi ke Worker: {err}")


def main():
    log("Menghubungkan ke MT5...")
    connect_mt5()
    log(f"Bridge aktif untuk simbol {SYMBOL}. Push tiap {PUSH_INTERVAL_SEC}s, polling sinyal tiap {POLL_INTERVAL_SEC}s.")
    log("Biarkan jendela ini tetap terbuka. Tekan Ctrl+C untuk berhenti.")

    last_push = 0
    try:
        while True:
            now = time.time()
            if now - last_push >= PUSH_INTERVAL_SEC:
                push_all_candles()
                last_push = now

            poll_and_execute_signal()
            time.sleep(POLL_INTERVAL_SEC)
    except KeyboardInterrupt:
        log("Dihentikan oleh user (Ctrl+C).")
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
