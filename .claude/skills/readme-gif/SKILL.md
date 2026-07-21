---
name: readme-gif
description: Regenerate the animated krackle burst GIF for the README (assets/krackle.gif). Use when the burst defaults change, the flash/invert behavior changes, or the README GIF otherwise looks stale. Captures the real built module in a browser and encodes a looping GIF with ffmpeg.
---

# Regenerate the README krackle GIF

Produces `assets/krackle.gif` — a looping capture of a single click-burst using
the **built** `krackle.esm.min.js` and its current defaults (so it always
reflects shipped behavior, including the flash/invert). 380×380, ~2.7s loop.

Bundled files (in this skill dir): `capture-harness.html`, `serve.ts`, `encode.sh`.

## Prerequisites

- `bun`, `ffmpeg`, `ffprobe` on PATH.
- **`chrome-devtools-mcp` tools**, NOT `claude-in-chrome`. The claude-in-chrome
  tab runs `hidden`, which freezes `requestAnimationFrame` — the animation never
  advances and every captured frame is identical. chrome-devtools-mcp pages run
  `visible`. Verify with `document.visibilityState === "visible"` before capturing.
- Build first if `krackle.ts` changed: `bun run build`.

## Why it works this way

The burst lives on a `<canvas>` and lasts ~1.2–2.5s, shorter than tool
round-trip latency — driving timing across tool calls lands you on the faded
tail. So **all timing-sensitive work happens inside one in-page script**:

- **Pass A** captures raw `canvas.toDataURL()` frames + the flash overlay's
  opacity in a real-time rAF loop (needs a visible tab).
- **Pass B** (no timing pressure) composites each frame onto the page bg and
  reproduces the flash's `mix-blend-mode:difference`-vs-white at the recorded
  opacity — the canvas is transparent and the flash is a DOM overlay, so
  neither shows up in a bare canvas grab.

Frames POST to `serve.ts`'s `/save` sink (avoids returning MBs of base64
through a tool call). `serve.ts` is a plain static server, not `bun <file>.html`
— the dev server's SPA fallback breaks the harness's `import()` of the module.

## Steps

Let `REPO` = repo root, `SP` = a scratch dir.

1. **Copy the harness into the repo root** (so its `./krackle.esm.min.js`
   import resolves) and start the server:
   ```bash
   cp .claude/skills/readme-gif/capture-harness.html "$REPO/_capture.html"
   OUT="$SP/frames.json" ROOT="$REPO" bun .claude/skills/readme-gif/serve.ts &
   # verify: curl -s -o /dev/null -w '%{http_code}' http://localhost:8731/krackle.esm.min.js  -> 200
   ```

2. **Open the harness with chrome-devtools-mcp** and size the page:
   - `new_page` → `http://localhost:8731/_capture.html`
   - `resize_page` 960×820 (viewport becomes ~960×806, dpr 2, center ≈ 480,403).
   - Confirm `evaluate_script` returns `document.visibilityState === "visible"`
     and `window.__ready === true`. Sanity-check rAF advances (a counter loop
     should climb, not stick at 1).

3. **Capture (pass A)** — one `evaluate_script` call:
   ```js
   async () => JSON.stringify(await window.captureRaw({ fps: 24, tailMs: 2900 }))
   ```
   Expect `count` ≈ 64 over `span` ≈ 2905ms.

4. **Composite + save (pass B)** — one `evaluate_script` call:
   ```js
   async () => JSON.stringify(await window.compositeAndSave({ crop: 620, outSize: 440 }))
   ```
   Writes `$SP/frames.json`. `crop` is centered CSS px around the click;
   widen it if outer bands clip. `flashProfile` (first few `__raw[i].fo`)
   should start ~0.85 and fade to 0 within ~4 frames.

5. **Encode**:
   ```bash
   .claude/skills/readme-gif/encode.sh "$SP/frames.json" "$SP/krackle.gif" 18 380
   ```
   Levers if size matters: lower `fps` (biggest lever; 18→12 roughly halves
   frames), or `COLORS=32 encode.sh ...`. The denser retuned burst lands around
   ~500KB at 18fps/40 colors — acceptable for GitHub. Frame count dominates
   size because the fast-moving dots defeat inter-frame compression.

6. **Spot-check** before installing — extract a filmstrip and view it:
   ```bash
   ffmpeg -y -i "$SP/krackle.gif" -vf "select='eq(n\,0)+eq(n\,3)+eq(n\,20)+eq(n\,44)',tile=4x1" -frames:v 1 "$SP/strip.png"
   ```
   Read the strip: frame 0 = inverted flash (dark field), then bloom → spread →
   gray dissolving tail. The negative-space "rays" show as clear radial channels
   between dot-masses (they're unpainted background, not white streaks).

7. **Install and clean up**:
   ```bash
   cp "$SP/krackle.gif" "$REPO/assets/krackle.gif"
   rm -f "$REPO/_capture.html"
   pkill -f 'readme-gif/serve.ts'
   ```
   If the burst/flash semantics changed, update the GIF's `alt` text in
   `README.md` to match.

## Dark-theme variant

The harness uses the light theme. For a dark capture, set
`data-theme="dark"` on `<html>` and swap the `:root` vars to the demo's dark
tokens (`--bg:#12100E`, `--krackle-fill:#0A0908`, `--krackle-rim:#E8E0CC`,
`--krackle-mode:dark`) before capturing.
