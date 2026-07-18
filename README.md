# The Kirby Krackle

Based on the unique styling of Jack "The King" Kirby. Read more about how the power cosmic pops from the page [here](https://en.wikipedia.org/wiki/Kirby_Krackle).

## Usage

`initKrackle()` appends one full-viewport `<canvas>` to `<body>` and
wires up a `click` listener (each click bursts), plus `resize`,
`visibilitychange`, and theme-change listeners to keep it in sync with
the page. Particles are drawn from a fixed-size pool via a single
`requestAnimationFrame` loop that runs only while particles are alive
and goes idle otherwise. `destroy()` (returned from `initKrackle()`)
removes the canvas and unregisters all of those listeners, fully
reverting the page to its pre-Krackle state.

### Simple

Import it straight from jsDelivr's GitHub CDN — no install, no build step:

```html
<script type="module">
  import { initKrackle } from "https://cdn.jsdelivr.net/gh/chrisbodhi/krackle@v0.1.0/krackle.esm.min.js";
  const krackle = initKrackle();
  // later, to tear down the canvas and listeners:
  // krackle.destroy();
</script>
```

Pin to a tag (`@v0.1.0`) like above for stability, or drop the version
(`.../gh/chrisbodhi/krackle/krackle.esm.min.js`) to always get the latest
tagged release — not recommended for production, since a new tag changes
the file out from under you without warning.

To self-host instead, copy `krackle.esm.min.js` into your project and
import it from there:

```html
<script type="module">
  import { initKrackle } from "./krackle.esm.min.js";
  const krackle = initKrackle();
</script>
```

Every click detonates a burst at the click point. No setup required — it
appends a full-viewport `<canvas>`, reads `--krackle-fill` for ink color
(default `#16130f`), and cleans up after itself via `destroy()`.

### With dark mode themes

Krackle checks a `--krackle-mode` CSS custom property (`"light"` or
`"dark"`) to pick its sprite set, falling back to sampling the page
background color if the property is absent. Set it — and the matching
`--krackle-fill` / `--krackle-rim` tokens — per theme:

```css
:root, [data-theme="light"] {
  --krackle-fill: #16130f;  /* ink color */
  --krackle-rim: #f2ecdc;   /* halo around ink in dark mode */
  --krackle-mode: light;
}
[data-theme="dark"] {
  --krackle-fill: #0a0908;
  --krackle-rim: #e8e0cc;
  --krackle-mode: dark;
}
```

Krackle watches for attribute changes on `<html>`/`<body>` (class,
`data-theme`, `style`) and OS-level `prefers-color-scheme` changes, and
rebuilds its sprite atlas automatically — no need to call `initKrackle()`
again when the theme flips.

## Development

Development depends on [Bun](https://bun.com). Install it, and then proceed.

To install dependencies:

```bash
bun install
```

To run the demo using Bun's first-class HTML support:

```bash
bun krackle-demo.html
```

To build a new minified version for the browser, run

```bash
bun run build
```
