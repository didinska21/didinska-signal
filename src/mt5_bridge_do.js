/**
 * Durable Object khusus jembatan MT5 — SATU instance per simbol (misal
 * "XAUUSD", di-address lewat idFromName(symbol)).
 *
 * Tugasnya dua:
 * 1. Nyimpen candle terbaru yang di-PUSH oleh bridge Python (jalan di
 *    laptop/VPS kamu, connect ke MT5), per timeframe. Worker BACA dari sini
 *    (bukan fetch langsung ke MT5 — Worker di cloud tidak bisa menjangkau
 *    laptop kamu yang ada di belakang NAT).
 * 2. Nyimpen ANTRIAN sinyal yang perlu dieksekusi ke MT5 (BUY/SELL dari AI
 *    Penyimpul), yang nanti di-POLLING oleh bridge Python, dieksekusi di
 *    MT5, lalu hasilnya (ticket, fill price, sukses/gagal) dilaporkan balik
 *    lewat reportExecution -> Worker kirim notifikasi ke Telegram. Bridge
 *    juga bisa lapor lewat reportForceClose kalau posisi ditutup otomatis
 *    karena floating profit/rugi menyentuh ambang % dari balance (lihat
 *    check_and_force_close() di mt5_bridge.py), duluan sebelum harga
 *    sempat sampai ke level SL/TP asli sinyal.
 *
 * Pola klaim (claim/pending/ready) dipakai lagi di sini, sama seperti
 * claimPhotoPromptMsgId di session_do.js, supaya kalau bridge polling
 * lebih dari sekali hampir bersamaan, sinyal yang sama tidak "diambil"
 * dua kali (double order).
 *
 * Strategi 1 & Strategi 2 SEKARANG memakai guardrail & state yang SAMA
 * (checkAutonomousGuardrails/riskState) -- 1 posisi terbuka dalam satu
 * waktu (lintas strategi, karena cuma 1 strategi yang aktif dalam satu
 * waktu), limit trade/hari, circuit breaker rugi harian. Bedanya cuma
 * label `strategy` yang dikirim balik ke Worker buat teks notifikasi.
 */

export class Mt5BridgeDO {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);

    switch (action) {
      // --- Bridge push candle terbaru ---
      // --- Bridge lapor status akun (balance/equity) & posisi terbuka,
      // dipanggil bridge tiap siklus push candle. Dipakai buat 3 lapis
      // kontrol risiko mode otonom: (1) 1 posisi terbuka dalam satu waktu,
      // (2) limit trade per hari, (3) circuit breaker rugi harian.
      case "reportStatus": {
        const { balance, equity, openPositionTicket } = await request.json();
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

        let risk = (await this.storage.get("riskState")) || null;
        if (!risk || risk.date !== today) {
          // Hari baru (atau belum pernah ada) -> reset snapshot ekuitas awal
          // hari ini & counter trade harian.
          risk = { date: today, dayStartEquity: equity, tradesToday: 0 };
        }
        risk.lastBalance = balance;
        risk.lastEquity = equity;
        risk.openPositionTicket = openPositionTicket ?? null;
        risk.updatedAt = Date.now();
        await this.storage.put("riskState", risk);

        return Response.json({ ok: true, risk });
      }

      // --- Worker (session_do.js, khusus siklus AUTO XAUUSD) cek apakah
      // boleh eksekusi trade baru, berdasarkan 3 kontrol risiko di atas.
      // Endpoint ini TIDAK dipakai buat sinyal manual (yang diklik user
      // sendiri dari Telegram) — cuma buat siklus otomatis tanpa pengawasan.
      case "checkAutonomousGuardrails": {
        const { maxTradesPerDay, maxDailyLossPct } = await request.json();
        const risk = await this.storage.get("riskState");

        if (!risk) {
          return Response.json({
            allowed: false,
            reason: "Belum ada laporan status akun (balance/equity/posisi) dari MT5 bridge. Tunggu beberapa siklus push dulu.",
          });
        }

        const age = Date.now() - risk.updatedAt;
        if (age > 5 * 60 * 1000) {
          return Response.json({
            allowed: false,
            reason: `Status akun dari bridge sudah basi (${Math.round(age / 1000)}s lalu). Cek koneksi bridge Python.`,
          });
        }

        if (risk.openPositionTicket) {
          return Response.json({
            allowed: false,
            reason: `Masih ada posisi terbuka (ticket ${risk.openPositionTicket}). Mode otonom hanya boleh 1 posisi dalam satu waktu.`,
          });
        }

        if (risk.tradesToday >= maxTradesPerDay) {
          return Response.json({
            allowed: false,
            reason: `Limit trade harian tercapai (${risk.tradesToday}/${maxTradesPerDay}). Coba lagi besok.`,
          });
        }

        const lossPct = ((risk.dayStartEquity - risk.lastEquity) / risk.dayStartEquity) * 100;
        if (lossPct >= maxDailyLossPct) {
          return Response.json({
            allowed: false,
            reason: `Circuit breaker rugi harian aktif (rugi ${lossPct.toFixed(2)}% dari batas ${maxDailyLossPct}%). Trading otomatis dihentikan sampai hari berikutnya.`,
          });
        }

        // Lolos semua guardrail -> catat sebagai 1 trade hari ini SEKARANG
        // (bukan setelah eksekusi sukses), supaya tidak ada celah race
        // condition kalau 2 siklus auto kebetulan jalan hampir bersamaan.
        risk.tradesToday += 1;
        await this.storage.put("riskState", risk);
        // `balance` ikut dikembalikan supaya session_do.js bisa langsung
        // hitung lot berbasis % risiko tanpa perlu round-trip lagi.
        return Response.json({ allowed: true, balance: risk.lastBalance });
      }

      // --- Snapshot ringan status risiko (posisi terbuka + balance), TANPA
      // efek samping apa pun (tidak increment tradesToday). Dipakai
      // session_do.js buat cek "masih ada posisi terbuka?" SEBELUM mulai
      // siklus auto (hemat limit API Groq) — BUKAN buat validasi guardrail
      // eksekusi (pakai checkAutonomousGuardrails untuk itu).
      case "getRiskSnapshot": {
        const risk = await this.storage.get("riskState");
        if (!risk) {
          return Response.json({ openPositionTicket: null, balance: null, stale: true });
        }
        const age = Date.now() - risk.updatedAt;
        return Response.json({
          openPositionTicket: risk.openPositionTicket ?? null,
          balance: risk.lastBalance ?? null,
          stale: age > 5 * 60 * 1000,
        });
      }

      case "pushCandles": {
        const { interval, candles } = await request.json();
        if (!interval || !Array.isArray(candles) || candles.length === 0) {
          return Response.json({ ok: false, error: "interval/candles tidak valid" }, { status: 400 });
        }
        await this.storage.put(`candles:${interval}`, { candles, updatedAt: Date.now() });
        return Response.json({ ok: true, count: candles.length });
      }

      // --- Worker (marketSource.js) baca candle cache ---
      case "getCandles": {
        const interval = url.searchParams.get("interval");
        const stored = (await this.storage.get(`candles:${interval}`)) || null;
        if (!stored) return Response.json({ candles: [], updatedAt: null });
        return Response.json(stored);
      }

      // --- session_do.js antre 1 sinyal buat dieksekusi bridge ---
      case "enqueueSignal": {
        const { signalId, chatId, decision, entry, sl, tp, lot, symbol, strategy } = await request.json();
        const record = {
          signalId,
          chatId,
          decision,
          entry,
          sl,
          tp,
          lot,
          symbol,
          strategy: strategy || "s1",
          status: "pending", // pending -> claimed -> done
          createdAt: Date.now(),
        };
        await this.storage.put(`pending:${signalId}`, record);
        await this.storage.put("latestPendingId", signalId);
        return Response.json({ ok: true });
      }

      // --- Bridge polling: ambil 1 sinyal yang masih "pending", klaim jadi "claimed" ---
      case "pollSignal": {
        const result = await this.storage.transaction(async (txn) => {
          const latestId = await txn.get("latestPendingId");
          if (!latestId) return null;
          const record = await txn.get(`pending:${latestId}`);
          if (!record || record.status !== "pending") return null;
          record.status = "claimed";
          record.claimedAt = Date.now();
          await txn.put(`pending:${latestId}`, record);
          return record;
        });
        return Response.json({ signal: result });
      }

      // --- Bridge lapor hasil eksekusi (sukses/gagal, ticket, fill price) ---
      case "reportExecution": {
        const { signalId, status, ticket, fillPrice, message } = await request.json();
        const record = await this.storage.get(`pending:${signalId}`);
        if (!record) return Response.json({ ok: false, error: "signal_not_found" }, { status: 404 });
        record.status = "done";
        record.executionStatus = status; // "filled" | "failed"
        record.ticket = ticket ?? null;
        record.fillPrice = fillPrice ?? null;
        record.message = message ?? null;
        record.executedAt = Date.now();
        await this.storage.put(`pending:${signalId}`, record);

        // Simpan pemetaan ticket -> {signalId, chatId, strategy}. Nanti
        // kalau posisi ini di-force-close otomatis oleh bridge, yang
        // dikirim bridge cuma ticket-nya saja -- lewat pemetaan ini Worker
        // tetap tahu harus kirim notifikasi ke chat mana & label strategi
        // apa di pesannya.
        if (status === "filled" && ticket != null) {
          await this.storage.put(`ticketMap:${ticket}`, { signalId, chatId: record.chatId, strategy: record.strategy || "s1" });
        }

        return Response.json({ ok: true, record });
      }

      // --- Bridge lapor force-close otomatis: floating profit/rugi posisi
      // sudah nyentuh ambang % dari balance (FORCE_CLOSE_PROFIT_PCT/
      // FORCE_CLOSE_LOSS_PCT, lihat check_and_force_close() di
      // mt5_bridge.py) SEBELUM harga sempat sampai ke level SL/TP asli dari
      // AI Penyimpul. Berlaku SAMA untuk Strategi 1 & Strategi 2. Juga
      // membersihkan openPositionTicket di riskState SEKARANG JUGA (jangan
      // nunggu siklus reportStatus berikutnya) supaya siklus auto
      // berikutnya tidak salah kira posisi masih terbuka.
      case "reportForceClose": {
        const { ticket, reason, profitPct, closePrice, volume } = await request.json();
        const mapped = ticket != null ? await this.storage.get(`ticketMap:${ticket}`) : null;
        const strategy = mapped?.strategy || "s1";

        const risk = await this.storage.get("riskState");
        if (risk && risk.openPositionTicket === ticket) {
          risk.openPositionTicket = null;
          risk.updatedAt = Date.now();
          await this.storage.put("riskState", risk);
        }

        return Response.json({
          ok: true,
          chatId: mapped?.chatId ?? null,
          signalId: mapped?.signalId ?? null,
          strategy,
          reason,
          profitPct,
          closePrice,
          volume,
        });
      }

      default:
        return new Response("Unknown action", { status: 404 });
    }
  }
}
