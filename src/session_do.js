/**
 * Durable Object untuk menyimpan session per chat_id.
 *
 * BEDA dengan KV: setiap Durable Object adalah "satu aktor" yang memproses
 * request SATU PER SATU secara berurutan (bukan paralel). Jadi walaupun user
 * kirim 3 foto beruntun dalam waktu hampir bersamaan, tiap operasi baca-tulis
 * dijamin tidak akan saling tabrakan/race condition — beda dengan KV yang
 * "eventually consistent" dan sempat bikin hitungan salah.
 */
export class SessionDO {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);

    switch (action) {
      case "getMode": {
        const mode = (await this.storage.get("mode")) || "idle";
        return Response.json({ mode });
      }

      case "setMode": {
        const { mode } = await request.json();
        await this.storage.put("mode", mode);
        return Response.json({ ok: true });
      }

      case "addPhoto": {
        const { fileId } = await request.json();
        const photos = (await this.storage.get("photos")) || [];
        photos.push(fileId);
        await this.storage.put("photos", photos);
        return Response.json({ total: photos.length });
      }

      case "countPhotos": {
        const photos = (await this.storage.get("photos")) || [];
        return Response.json({ total: photos.length });
      }

      case "listPhotos": {
        const photos = (await this.storage.get("photos")) || [];
        return Response.json({ photos });
      }

      case "reset": {
        await this.storage.put("mode", "idle");
        await this.storage.delete("photos");
        return Response.json({ ok: true });
      }

      default:
        return new Response("Unknown action", { status: 404 });
    }
  }
}
