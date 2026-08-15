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
 *    lewat reportExecution -> Worker kirim notifikasi ke Telegram.
 *
 * Pola klaim (claim/pending/ready) dipakai lagi di sini, sama seperti
 * claimPhotoPromptMsgId di session_do.js, supaya kalau bridge polling
 * lebih dari sekali hampir bersamaan, sinyal yang sama tidak "diambil"
 * dua kali (double order).
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
        const { signalId, chatId, decision, entry, sl, tp, lot, symbol } = await request.json();
        const record = {
          signalId,
          chatId,
          decision,
          entry,
          sl,
          tp,
          lot,
          symbol,
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
        return Response.json({ ok: true, record });
      }

      default:
        return new Response("Unknown action", { status: 404 });
    }
  }
}
