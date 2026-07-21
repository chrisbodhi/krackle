// Static server for the README-gif capture harness, plus a POST /save sink
// for the composited frames. Serves the repo root so the harness can import
// ./krackle.esm.min.js directly (Bun's dev server SPA-falls-back unlinked
// asset paths, which breaks that import — a plain static server does not).
//
// Usage: OUT=/abs/frames.json ROOT=/abs/repo bun serve.ts
const ROOT = process.env.ROOT || process.cwd();
const OUT = process.env.OUT || (ROOT + "/_frames.json");
const PORT = Number(process.env.PORT || 8731);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/save") {
      await Bun.write(OUT, await req.text());
      return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
    }
    const p = url.pathname === "/" ? "/_capture.html" : url.pathname;
    const f = Bun.file(ROOT + p);
    return (await f.exists()) ? new Response(f) : new Response("404", { status: 404 });
  },
});
console.log(`serving ${ROOT} on :${PORT}, saving frames to ${OUT}`);
