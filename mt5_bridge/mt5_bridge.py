"""
mt5_bridge.py — Jembatan antara MetaTrader 5 (di laptop/VPS kamu) dan
Didinska Signal Bot (Cloudflare Worker).

CARA KERJA (loop terus-menerus sampai di-Ctrl+C):
  1. PUSH candle terbaru XAUUSD (semua timeframe yang dibutuhkan bot: 1m,
     5m, 15m, 1h, 4h, 1d) ke Worker, tiap PUSH_INTERVAL_SEC detik.
  2. POLLING ke Worker: ada sinyal BUY/SELL yang perlu dieksekusi?
     Kalau ada -> eksekusi market order ke MT5 (akun DEMO), dengan SL/TP
     NATIVE (harga persis dari AI Penyimpul, dikirim sebagai bagian order
     MT5 -- tetap jadi jaring pengaman utama walau script ini mati), lalu
     laporkan hasilnya (sukses/gagal, ticket, harga fill) balik ke Worker
     supaya bot bisa kirim notifikasi ke Telegram.
  3. FORCE-CLOSE berbasis %: tiap siklus polling (tiap POLL_INTERVAL_SEC
     detik), cek floating profit/rugi posisi bot ini yang lagi terbuka.
     Kalau floating sudah nyentuh +FORCE_CLOSE_PROFIT_PCT% atau
     -FORCE_CLOSE_LOSS_PCT% dari BALANCE -- SEBELUM harga sempat sampai ke
     level SL/TP native di atas -- posisi ditutup manual sekarang juga
     (lapor balik ke Worker juga, biar ada notifikasi Telegram). Jadi ada 2
     lapis proteksi paralel: siapa pun (native price-based SL/TP, atau
     floating %-based ini) yang kena duluan, itu yang menutup posisi.

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
# data ini adalah akun demo jadi biarkan saja
WORKER_URL = "https://didinska-signal.mr-didinska21.workers.dev"

# Harus SAMA PERSIS dengan secret MT5_BRIDGE_SECRET yang di-set di Worker
# (npx wrangler secret put MT5_BRIDGE_SECRET).
# ini juga adalah data akun demo, jadi biarkan saja ke isi jangan usik.
BRIDGE_SECRET = "MT5_BRIDGE_SECRET"

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

# Force-close berbasis floating profit/rugi, dalam % dari BALANCE (bukan
# equity) -- dicek tiap POLL_INTERVAL_SEC detik, PARALEL dengan native
# SL/TP yang sudah terpasang di order (lihat execute_order()). Siapa pun
# yang kena duluan (harga sampai ke level SL/TP native, ATAU floating
# sampai ke ambang % ini) yang menutup posisi. HARUS sinkron dengan
# RISK_SL_PCT/RISK_TP_PCT di src/session_do.js (Worker) -- itu yang dipakai
# buat hitung LOT (position sizing) supaya SL native ≈ FORCE_CLOSE_LOSS_PCT%
# risiko; kalau salah satu diubah, ubah juga yang satunya biar tetap match.
FORCE_CLOSE_PROFIT_PCT = 2.0  # tutup paksa (profit lock) di floating +2% balance
FORCE_CLOSE_LOSS_PCT = 1.0  # tutup paksa (cut loss) di floating -1% balance

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


# Retcode paling umum yang bakal ketemu (referensi: dokumentasi MQL5
# TRADE_RETCODE). Kalau ada retcode lain yang tidak ada di daftar ini,
# tetap ditampilkan apa adanya (angka mentah) supaya tidak menyesatkan.
RETCODE_DESCRIPTIONS = {
    0: "Retcode 0 (tidak standar) — biasanya muncul kalau pasar tutup atau request tidak sempat diproses server broker. Cek juga 'last_error' di log untuk detail tambahan.",
    10004: "Requote (harga berubah, order ditolak)",
    10006: "Request ditolak broker",
    10007: "Request dibatalkan trader",
    10008: "Order sudah di-tempatkan",
    10009: "Order sukses (Done)",
    10010: "Hanya sebagian volume yang tereksekusi",
    10011: "Request error/tidak valid",
    10012: "Timeout, request dibatalkan",
    10013: "Request tidak valid",
    10014: "Volume tidak valid",
    10015: "Harga tidak valid",
    10016: "SL/TP tidak valid (kemungkinan terlalu dekat dari harga pasar)",
    10017: "Trading dinonaktifkan",
    10018: "PASAR SEDANG TUTUP (market closed) — coba lagi saat jam pasar buka",
    10019: "Dana tidak cukup untuk eksekusi order",
    10020: "Harga berubah (price changed)",
    10021: "Tidak ada harga (off quotes)",
    10025: "Autotrading dinonaktifkan di sisi terminal (tombol Algo Trading mati)",
    10027: "Autotrading dinonaktifkan di akun/broker",
    10031: "Tidak ada koneksi ke server trade",
    10033: "Jumlah order pending sudah mencapai limit",
    10034: "Jumlah volume order sudah mencapai limit",
}


def describe_retcode(code):
    return RETCODE_DESCRIPTIONS.get(code, f"Retcode {code} tidak dikenal (cek dokumentasi MQL5 TRADE_RETCODE)")


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


def report_account_status():
    """
    Lapor balance/equity akun & apakah ada posisi terbuka (dari bot ini,
    dicek via MAGIC_NUMBER) ke Worker. Dipakai Worker buat 3 kontrol risiko
    mode OTONOM: 1 posisi terbuka dalam satu waktu, limit trade/hari, dan
    circuit breaker rugi harian. Dipanggil tiap siklus push candle.
    """
    try:
        account_info = mt5.account_info()
        if account_info is None:
            log("⚠️ Gagal ambil info akun buat lapor status.")
            return

        positions = mt5.positions_get(symbol=SYMBOL)
        open_ticket = None
        if positions:
            own_positions = [p for p in positions if p.magic == MAGIC_NUMBER]
            if own_positions:
                open_ticket = own_positions[0].ticket

        requests.post(
            f"{WORKER_URL}/mt5-bridge/status",
            json={
                "symbol": SYMBOL,
                "balance": account_info.balance,
                "equity": account_info.equity,
                "openPositionTicket": open_ticket,
            },
            headers=HEADERS,
            timeout=15,
        )
    except Exception as err:
        log(f"⚠️ Error lapor status akun: {err}")


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
        err = mt5.last_error()
        report_execution(signal_id, chat_id, "failed", message=f"order_send mengembalikan None. last_error={err}")
        return

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        err = mt5.last_error()
        reason = describe_retcode(result.retcode)
        log(f"❌ Order gagal, retcode={result.retcode} ({reason}), comment={result.comment}, last_error={err}")
        report_execution(
            signal_id,
            chat_id,
            "failed",
            message=f"{reason} (retcode {result.retcode}, comment: {result.comment})",
        )
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


def check_and_force_close():
    """
    Cek floating profit/rugi posisi bot ini (magic number cocok) yang lagi
    terbuka. Kalau sudah nyentuh +FORCE_CLOSE_PROFIT_PCT% atau
    -FORCE_CLOSE_LOSS_PCT% dari BALANCE, tutup paksa SEKARANG -- jangan
    tunggu harga sampai ke level SL/TP native (yang bisa saja lebih jauh
    dari ambang % ini, terutama TP, karena harga TP itu murni dari analisa
    teknikal AI, bukan dihitung dari %).

    Dipanggil tiap siklus polling (POLL_INTERVAL_SEC), sama seperti
    poll_and_execute_signal() -- TIDAK butuh loop/thread terpisah.
    """
    try:
        account_info = mt5.account_info()
        if account_info is None:
            return
        balance = account_info.balance
        if not balance or balance <= 0:
            return

        positions = mt5.positions_get(symbol=SYMBOL)
        if not positions:
            return
        own_positions = [p for p in positions if p.magic == MAGIC_NUMBER]

        for position in own_positions:
            profit_pct = (position.profit / balance) * 100
            if profit_pct >= FORCE_CLOSE_PROFIT_PCT:
                close_position(position, "tp_pct", profit_pct)
            elif profit_pct <= -FORCE_CLOSE_LOSS_PCT:
                close_position(position, "sl_pct", profit_pct)
    except Exception as err:
        log(f"⚠️ Error cek force-close %: {err}")
        traceback.print_exc()


def close_position(position, reason, profit_pct):
    """Tutup 1 posisi (order berlawanan arah, volume sama) & lapor ke Worker."""
    tick = mt5.symbol_info_tick(SYMBOL)
    if tick is None:
        log(f"⚠️ Gagal force-close ticket {position.ticket}: tidak bisa ambil tick harga terkini.")
        return

    is_buy = position.type == mt5.ORDER_TYPE_BUY
    close_type = mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY
    price = tick.bid if is_buy else tick.ask

    request_payload = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": SYMBOL,
        "volume": position.volume,
        "type": close_type,
        "position": position.ticket,  # wajib diisi supaya MT5 tahu ini CLOSE, bukan order baru
        "price": price,
        "deviation": 20,
        "magic": MAGIC_NUMBER,
        "comment": f"force-close-{reason}",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request_payload)

    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        err = mt5.last_error()
        retcode = result.retcode if result else None
        reason_desc = describe_retcode(retcode) if retcode is not None else "order_send mengembalikan None"
        log(
            f"❌ Force-close ticket {position.ticket} GAGAL (retcode={retcode}, {reason_desc}, last_error={err}). "
            f"Posisi TETAP TERBUKA -- native SL/TP masih jadi jaring pengaman, akan dicoba lagi siklus berikutnya."
        )
        return

    label = "TP (profit lock)" if reason == "tp_pct" else "SL (cut loss)"
    log(f"🔒 Force-close ticket {position.ticket} sukses -- {label} di floating {profit_pct:.2f}% balance. Harga tutup={result.price}")
    report_force_close(position.ticket, reason, profit_pct, result.price, position.volume)


def report_force_close(ticket, reason, profit_pct, close_price, volume):
    try:
        requests.post(
            f"{WORKER_URL}/mt5-bridge/forceclose",
            json={
                "symbol": SYMBOL,
                "ticket": ticket,
                "reason": reason,  # "tp_pct" | "sl_pct"
                "profitPct": profit_pct,
                "closePrice": close_price,
                "volume": volume,
            },
            headers=HEADERS,
            timeout=15,
        )
    except Exception as err:
        log(f"⚠️ Gagal lapor force-close ke Worker: {err}")


def main():
    log("Menghubungkan ke MT5...")
    connect_mt5()
    log(f"Bridge aktif untuk simbol {SYMBOL}. Push tiap {PUSH_INTERVAL_SEC}s, polling sinyal tiap {POLL_INTERVAL_SEC}s.")
    log(f"Force-close otomatis aktif: +{FORCE_CLOSE_PROFIT_PCT}% (profit lock) / -{FORCE_CLOSE_LOSS_PCT}% (cut loss) dari balance.")
    log("Biarkan jendela ini tetap terbuka. Tekan Ctrl+C untuk berhenti.")

    last_push = 0
    try:
        while True:
            now = time.time()
            if now - last_push >= PUSH_INTERVAL_SEC:
                push_all_candles()
                report_account_status()
                last_push = now

            check_and_force_close()
            poll_and_execute_signal()
            time.sleep(POLL_INTERVAL_SEC)
    except KeyboardInterrupt:
        log("Dihentikan oleh user (Ctrl+C).")
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
