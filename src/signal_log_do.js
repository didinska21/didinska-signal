/**
 * Durable Object GLOBAL (satu instance untuk seluruh bot, BUKAN per-chat
 * seperti SessionDO) yang nyimpen riwayat tiap sinyal yang pernah dikeluarkan
 * bot. Ini fondasi buat ngitung win-rate BENERAN (bukan angka "±65%" tebakan
 * LLM) — user nandain sendiri tiap sinyal berujung TP atau SL, baru dari situ
 * kita bisa hitung persentase yang bisa dipercaya.
 *
 * Dipisah dari SessionDO supaya riwayatnya TIDAK ikut kehapus tiap kali sesi
 * di-reset (/start, /batal, dst) — riwayat harus tahan lama.
 */
export class SignalLogDO {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);

    switch (action) {
      case "logSignal": {
        const entry = await request.json();
        const id = `${entry.createdAt}_${entry.chatId}`;
        const record = { ...entry, id, status: "open" };
        await this.storage.put(`signal:${id}`, record);
        return Response.json({ id });
      }

      case "markResult": {
        const { id, status } = await request.json(); // status: "win" | "loss"
        const record = await this.storage.get(`signal:${id}`);
        if (!record) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
        record.status = status;
        record.resultUpdatedAt = Date.now();
        await this.storage.put(`signal:${id}`, record);
        return Response.json({ ok: true, record });
      }

      case "getSignal": {
        const { id } = await request.json();
        const record = (await this.storage.get(`signal:${id}`)) || null;
        return Response.json({ record });
      }

      case "listSignals": {
        const { chatId, status, strategy, limit } = await request.json();
        // Key-nya "signal:<timestamp>_<chatId>" -> urutan key = urutan waktu,
        // jadi reverse:true otomatis dapet yang paling baru duluan.
        const map = await this.storage.list({ prefix: "signal:", reverse: true, limit: limit || 500 });
        let entries = Array.from(map.values());
        if (chatId) entries = entries.filter((e) => String(e.chatId) === String(chatId));
        if (status) entries = entries.filter((e) => e.status === status);
        if (strategy) entries = entries.filter((e) => e.strategy === strategy);
        return Response.json({ entries });
      }

      // --- HAPUS SEMUA riwayat sinyal (GLOBAL, seluruh chat) -- IRREVERSIBLE.
      // Dipakai buat reset statistik win-rate pas mulai testing dari nol
      // (misal abis ganti strategi/logic besar). Diloop pakai cursor karena
      // storage.list() bisa saja tidak balikin SEMUA baris dalam 1 panggilan
      // kalau datanya banyak.
      case "clearAll": {
        let deleted = 0;
        while (true) {
          const map = await this.storage.list({ prefix: "signal:", limit: 500 });
          if (map.size === 0) break;
          const keys = Array.from(map.keys());
          await this.storage.delete(keys);
          deleted += keys.length;
          if (map.size < 500) break;
        }
        return Response.json({ ok: true, deleted });
      }

      default:
        return new Response("Unknown action", { status: 404 });
    }
  }
}
