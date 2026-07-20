/**
 * krackle.ts — Kirby-Krackle click bursts, negative-space-first.
 *
 * A click (or tap) detonates a radial krackle burst at the click point:
 * dot masses bloom outward in the wedges between 2-4 preserved white
 * rays, thick near the source, dissolving into scattered dots at the
 * rim, then fade. Structure follows the classic inking process — the
 * white channels are the drawing; the black is what the power pushed
 * aside.
 *
 * Usage:
 *   import { initKrackle } from "./krackle.js";
 *   const k = initKrackle();      // later: k.destroy()
 */

export interface KrackleOptions {
  maxParticles?: number;        // pool size (default 300)
  lifespan?: [number, number];  // ms, min/max (default [1200, 2500])
  zIndex?: number;              // canvas z-index (default 10)
  seed?: number;                // sprite atlas seed (default Kirby's birthday)
  fillVar?: string;             // CSS var for ink color   (default --krackle-fill)
  rimVar?: string;              // CSS var for dark-mode rim (default --krackle-rim)
  modeVar?: string;             // CSS var forcing mode: "light"|"dark" (default
                                // --krackle-mode); absent → sample background
  lobesMax?: number;            // silhouette lobes 1-4 (default 3)
  lobeSpread?: number;          // 0.2-0.9 (default 0.55)
  rimWidth?: number;            // px (default 1.5)
  satsMax?: number;             // satellites per cluster max (default 6)
  satSpread?: number;           // ×anchor radius (default 1.6)
  rays?: [number, number];      // white rays per burst, min/max (default [2, 4])
  rayHalf?: [number, number];   // ray half-angle range, radians (default [0.22, 0.32])
  burstRadius?: [number, number];// inner halo / outer rim, px (default [24, 110])
  anchorRadius?: [number, number];// cluster-core dot radius, px (default [10, 15])
  satRadius?: [number, number]; // satellite dot radius, px (default [8, 13])
  dissolve?: number;            // 0-1, how much satellites shrink toward the rim (default 0.15)
  driftRange?: [number, number];// base outward drift per cluster, px (default [20, 36])
  bandAttempts?: [number, number, number]; // cluster attempts per band, inner→outer (default [14, 11, 9])
  bandDelayMs?: number;         // ms between band bloom stagger (default 55)
  flash?: "none" | "white" | "invert"; // full-viewport flash on click (default "none")
  flashMs?: number;             // flash fade duration, ms (default 180)
  flashPeak?: number;           // flash peak opacity, 0-1 (default 0.85)
}

export interface KrackleHandle {
  destroy(): void;
}

interface Sprite {
  light: HTMLCanvasElement;
  dark: HTMLCanvasElement;
  r: number;
  size: number; // CSS px, square
}

interface Particle {
  x: number; y: number;
  sprite: number;      // index into sprites[]
  birth: number;       // rAF-clock ms (may be in the future for staggered bloom)
  life: number;        // ms
  dx: number; dy: number; // total drift over full life, px
  alive: boolean;
}

export const DEFAULTS: Required<KrackleOptions> = {
  maxParticles: 920,
  lifespan: [1200, 2500],
  zIndex: 10,
  seed: 19620828,
  fillVar: "--krackle-fill",
  rimVar: "--krackle-rim",
  modeVar: "--krackle-mode",
  lobesMax: 5,
  lobeSpread: 0.55,
  rimWidth: 1.5,
  satsMax: 2,
  satSpread: 1.55,
  rays: [2, 4],
  rayHalf: [0.32, 0.44],
  burstRadius: [22, 210],
  anchorRadius: [6, 14.5],
  satRadius: [4.5, 10],
  dissolve: 0.15,
  driftRange: [34, 106],
  bandAttempts: [14, 18, 26],
  bandDelayMs: 85,
  flash: "invert",
  flashMs: 180,
  flashPeak: 0.85,
};

const ANCHOR_COUNT = 12;
const SAT_COUNT = 6;
const POP_MS = 110;          // scale-in duration
const HOLD_FRACTION = 0.6;   // alpha holds until this fraction of life

/* ---------------------------------------------------------------- RNG */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ------------------------------------------------------------- sprites */

function makeMask(
  rand: () => number, r: number, dpr: number,
  o: { lobesMax: number; lobeSpread: number },
): { mask: HTMLCanvasElement; size: number } {
  const pad = Math.ceil(r * 0.9) + 4;
  const size = Math.ceil((r + pad) * 2);
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(size * dpr);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  g.translate(size / 2, size / 2);
  g.fillStyle = "#000";

  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();

  const lobes = 1 + Math.floor(rand() * o.lobesMax);
  for (let i = 0; i < lobes; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = r * lerp(0.35, 1.0, rand()) * o.lobeSpread * 1.4;
    const lr = r * lerp(0.35, 0.75, rand());
    g.beginPath();
    g.arc(Math.cos(ang) * dist, Math.sin(ang) * dist, lr, 0, Math.PI * 2);
    g.fill();
  }

  return { mask: c, size };
}

function tint(mask: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = mask.width; c.height = mask.height;
  const g = c.getContext("2d")!;
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Dark sprite = rim halo (8-offset dilation of tinted mask) under ink body. */
function finalize(
  mask: HTMLCanvasElement, mode: "light" | "dark",
  fill: string, rim: string, rimWidth: number, dpr: number,
): HTMLCanvasElement {
  if (mode === "light") return tint(mask, fill);
  const out = document.createElement("canvas");
  out.width = mask.width; out.height = mask.height;
  const g = out.getContext("2d")!;
  const halo = tint(mask, rim);
  const w = rimWidth * dpr;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.drawImage(halo, Math.cos(a) * w, Math.sin(a) * w);
  }
  g.drawImage(tint(mask, fill), 0, 0);
  return out;
}

/* ------------------------------------------------------------- theming */

function readTokens(fillVar: string, rimVar: string): { fill: string; rim: string } {
  const cs = getComputedStyle(document.documentElement);
  return {
    fill: cs.getPropertyValue(fillVar).trim() || "#16130f",
    rim: cs.getPropertyValue(rimVar).trim() || "#f2ecdc",
  };
}

/** Is the page background dark? Decides which sprite set to stamp. */
function pageIsDark(): boolean {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
    if (!m) continue;
    if (m[4] !== undefined && parseFloat(m[4]) === 0) continue; // transparent
    const lum = (0.2126 * +m[1]! + 0.7152 * +m[2]! + 0.0722 * +m[3]!) / 255;
    return lum < 0.5;
  }
  return false;
}

/* ---------------------------------------------------------------- init */

export function initKrackle(options: KrackleOptions = {}): KrackleHandle {
  const opts = { ...DEFAULTS, ...options };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  if (reduced.matches) return { destroy() {} };

  /* -- canvas ------------------------------------------------------- */
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    position: "fixed", inset: "0", width: "100%", height: "100%",
    pointerEvents: "none", zIndex: String(opts.zIndex),
  } as CSSStyleDeclaration);
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  /* -- flash ---------------------------------------------------------
   * A full-viewport overlay for the "white" and "invert" flash modes.
   * "invert" uses mix-blend-mode: difference against a white fill, which
   * inverts whatever's beneath it regardless of theme; "white" just
   * washes toward white in normal blending. Web Animations API handles
   * the fade so overlapping rapid clicks just restart it cleanly.
   */
  let flashEl: HTMLDivElement | null = null;
  if (opts.flash !== "none") {
    flashEl = document.createElement("div");
    Object.assign(flashEl.style, {
      position: "fixed", inset: "0", pointerEvents: "none",
      zIndex: String(opts.zIndex + 1), background: "#fff", opacity: "0",
      mixBlendMode: opts.flash === "invert" ? "difference" : "normal",
    } as CSSStyleDeclaration);
    flashEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(flashEl);
  }

  function triggerFlash(): void {
    flashEl?.animate(
      [{ opacity: opts.flashPeak }, { opacity: 0 }],
      { duration: opts.flashMs, easing: "ease-out" },
    );
  }

  let dpr = Math.min(devicePixelRatio || 1, 2);
  function sizeCanvas(): void {
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(innerWidth * dpr);
    canvas.height = Math.ceil(innerHeight * dpr);
  }
  sizeCanvas();

  /* -- atlas -------------------------------------------------------- */
  let sprites: Sprite[] = [];
  let anchorsBySize: number[] = [];   // sprite indices, ascending radius
  let satsBySize: number[] = [];      // sprite indices, ascending radius
  let dark = false;

  function buildAtlas(fill: string, rim: string): void {
    const rand = mulberry32(opts.seed);
    const shapeOpts = { lobesMax: opts.lobesMax, lobeSpread: opts.lobeSpread };
    const next: Sprite[] = [];
    for (let i = 0; i < ANCHOR_COUNT; i++) {
      const r = lerp(opts.anchorRadius[0], opts.anchorRadius[1], rand());
      const { mask, size } = makeMask(rand, r, dpr, shapeOpts);
      next.push({
        r, size,
        light: finalize(mask, "light", fill, rim, opts.rimWidth, dpr),
        dark: finalize(mask, "dark", fill, rim, opts.rimWidth, dpr),
      });
    }
    for (let i = 0; i < SAT_COUNT; i++) {
      const r = lerp(opts.satRadius[0], opts.satRadius[1], rand());
      const { mask, size } = makeMask(rand, r, dpr, { ...shapeOpts, lobesMax: 1 });
      next.push({
        r, size,
        light: finalize(mask, "light", fill, rim, opts.rimWidth, dpr),
        dark: finalize(mask, "dark", fill, rim, opts.rimWidth, dpr),
      });
    }
    sprites = next;
    anchorsBySize = next.slice(0, ANCHOR_COUNT)
      .map((s, i) => i).sort((a, b) => next[a]!.r - next[b]!.r);
    satsBySize = next.slice(ANCHOR_COUNT)
      .map((_, i) => ANCHOR_COUNT + i)
      .sort((a, b) => next[a]!.r - next[b]!.r);
  }

  /* -- theme resolution ---------------------------------------------
   * The mode is taken from --krackle-mode ("light"/"dark") when the
   * theme declares it. Only absent that do we sample the background —
   * and sampling at mutation time is unreliable when the background is
   * CSS-transitioned (its computed value at t≈0 is the OLD color), so
   * every theme signal also schedules settle re-checks. The cache key
   * makes redundant rebuilds free.
   */
  const SETTLE_MS = [120, 450, 1100];
  let themeKey = "";
  let settleTimers: number[] = [];

  function refreshTheme(force = false): void {
    const { fill, rim } = readTokens(opts.fillVar, opts.rimVar);
    const forced = getComputedStyle(document.documentElement)
      .getPropertyValue(opts.modeVar).trim().toLowerCase();
    const isDark = forced === "dark" ? true
                 : forced === "light" ? false
                 : pageIsDark();
    const key = fill + "|" + rim + "|" + isDark;
    if (!force && key === themeKey) return;
    themeKey = key;
    dark = isDark;
    buildAtlas(fill, rim);
  }

  function onThemeSignal(): void {
    refreshTheme();
    for (const id of settleTimers) clearTimeout(id);
    settleTimers = SETTLE_MS.map((ms) => window.setTimeout(() => refreshTheme(), ms));
  }

  refreshTheme(true);

  /* -- particle pool ------------------------------------------------ */
  const pool: Particle[] = Array.from({ length: opts.maxParticles }, () => ({
    x: 0, y: 0, sprite: 0, birth: 0, life: 0, dx: 0, dy: 0, alive: false,
  }));
  let head = 0;
  let aliveCount = 0;
  let running = false;
  let now = performance.now(); // updated by the rAF loop; used at spawn time

  function alloc(): Particle {
    const p = pool[head]!;
    head = (head + 1) % pool.length;
    if (!p.alive) aliveCount++;
    p.alive = true;
    return p;
  }

  const srand = mulberry32((Math.random() * 2 ** 31) | 0); // spawn-time randomness

  /**
   * One cluster = anchor + satellites.
   * tier: 0 = full mass (big anchors, full satellites)
   *       1 = medium
   *       2 = dissolving tip (small anchors, few small satellites)
   * facing: satellites bias toward this angle (the dissolve direction).
   * driftMag: total px of outward drift along `facing` over the lifetime.
   */
  function spawnCluster(
    x: number, y: number, delay: number,
    facing: number, tier: number, driftMag: number,
  ): void {
    // rAF timestamps share performance.now()'s origin, so this is safe
    // whether the loop is running or asleep (where `now` would be stale).
    const t0 = running ? now : performance.now();

    const rank = tier === 0 ? 0.35 + srand() * 0.65
               : tier === 1 ? srand()
               : srand() * 0.5;
    const anchorIdx = anchorsBySize[Math.min(ANCHOR_COUNT - 1, (rank * ANCHOR_COUNT) | 0)]!;
    const anchor = sprites[anchorIdx]!;
    const life = lerp(opts.lifespan[0], opts.lifespan[1], srand());
    const fx = Math.cos(facing), fy = Math.sin(facing);

    const a = alloc();
    a.x = x; a.y = y; a.sprite = anchorIdx;
    a.birth = t0 + delay; a.life = life;
    a.dx = fx * driftMag + (srand() - 0.5) * 4;
    a.dy = fy * driftMag + (srand() - 0.5) * 4;

    const n = tier === 2 ? 2 + ((srand() * 2) | 0)
            : 3 + ((srand() * (opts.satsMax - 2)) | 0);
    const dMax = anchor.r * opts.satSpread * 1.65;
    for (let i = 0; i < n; i++) {
      const s = alloc();
      const ang = facing + (srand() + srand() - 1) * 1.2; // triangular, ±~69°
      const bias = srand(); // squared random → clump toward anchor
      const d = anchor.r * opts.satSpread * (0.35 + 1.3 * bias * bias);
      const dNorm = Math.min(1, d / dMax);
      // farther from the anchor → slightly smaller dot (dissolution)
      const satRank = srand() * (1 - opts.dissolve * dNorm);
      s.sprite = satsBySize[Math.min(SAT_COUNT - 1, (satRank * SAT_COUNT) | 0)]!;
      s.x = x + Math.cos(ang) * d;
      s.y = y + Math.sin(ang) * d;
      s.birth = t0 + delay + srand() * 60;
      s.life = life * lerp(0.75, 1.05, srand());
      // satellites are lighter — they carry a touch more of the blast
      s.dx = fx * driftMag * 1.3 + (srand() - 0.5) * 4;
      s.dy = fy * driftMag * 1.3 + (srand() - 0.5) * 4;
    }
    wake();
  }

  /* -- render loop --------------------------------------------------- */
  let raf = 0;

  function easeOutBack(u: number): number {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
  }

  function frame(t: number): void {
    now = t;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let live = 0;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i]!;
      if (!p.alive) continue;
      const age = t - p.birth;
      if (age < 0) { live++; continue; }        // staggered, not yet born
      if (age >= p.life) { p.alive = false; aliveCount--; continue; }
      live++;

      const u = age / p.life;
      const alpha = u < HOLD_FRACTION
        ? 1
        : 1 - Math.pow((u - HOLD_FRACTION) / (1 - HOLD_FRACTION), 3);
      const scale = age < POP_MS ? easeOutBack(age / POP_MS) : 1;

      const sp = sprites[p.sprite]!;
      const img = dark ? sp.dark : sp.light;
      const w = sp.size * scale;
      // drift eases out — blast decelerates, doesn't glide
      const dr = 1 - Math.pow(1 - u, 3);
      const x = (p.x + p.dx * dr - w / 2) * dpr;
      const y = (p.y + p.dy * dr - w / 2) * dpr;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, x, y, w * dpr, w * dpr);
    }
    ctx.globalAlpha = 1;
    if (live > 0) {
      raf = requestAnimationFrame(frame);
    } else {
      running = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function wake(): void {
    if (!running) {
      running = true;
      now = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  /* -- input --------------------------------------------------------- */

  /**
   * The burst: dot masses bloom in the wedges between 2-4 preserved
   * white rays radiating from the click point. Outward bands arrive
   * later, use smaller anchors, drift further, and dissolve — thick at
   * the source, breaking into scattered dots at the rim.
   */
  function burst(x: number, y: number): void {
    triggerFlash();
    const rayN = opts.rays[0] + ((srand() * (opts.rays[1] - opts.rays[0] + 1)) | 0);
    const rayHalf = lerp(opts.rayHalf[0], opts.rayHalf[1], srand());
    const rayBase = srand() * Math.PI * 2;
    const rayAngles: number[] = [];
    for (let i = 0; i < rayN; i++) {
      rayAngles.push(rayBase + (i / rayN) * Math.PI * 2 + (srand() - 0.5) * 0.6);
    }
    const inRay = (a: number): boolean => {
      for (const ra of rayAngles) {
        const d = Math.abs(((a - ra + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < rayHalf) return true;
      }
      return false;
    };

    const [r0, r1] = opts.burstRadius;
    for (let b = 0; b < opts.bandAttempts.length; b++) {
      const ri = lerp(r0, r1, b / 3);
      const ro = lerp(r0, r1, (b + 1) / 3);
      for (let i = 0; i < opts.bandAttempts[b]!; i++) {
        const ang = srand() * Math.PI * 2;
        if (inRay(ang)) continue; // preserve the white ray — skip, don't retry
        const rad = lerp(ri, ro, srand());
        spawnCluster(
          x + Math.cos(ang) * rad,
          y + Math.sin(ang) * rad,
          b * opts.bandDelayMs + srand() * 70, // bloom travels outward
          ang,                               // dissolve away from the source
          b,                                 // outer bands are lighter masses
          lerp(opts.driftRange[0], opts.driftRange[1], srand()) * (0.6 + b * 0.4), // outer bands fly further
        );
      }
    }
  }

  function onClick(e: MouseEvent): void {
    // keyboard-activated clicks report detail 0 and bogus coordinates
    if (e.detail === 0) return;
    burst(e.clientX, e.clientY);
  }

  /* -- environment --------------------------------------------------- */
  let resizeTimer = 0;
  function onResize(): void {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const prevDpr = dpr;
      sizeCanvas();
      if (dpr !== prevDpr) refreshTheme(true); // monitor swap changed DPR
      wakeIfAlive();
    }, 150);
  }

  let hiddenAt = 0;
  function onVisibility(): void {
    if (document.hidden) {
      hiddenAt = performance.now();
      cancelAnimationFrame(raf);
      running = false;
    } else if (hiddenAt) {
      const pause = performance.now() - hiddenAt;
      for (const p of pool) if (p.alive) p.birth += pause; // don't age off-screen
      hiddenAt = 0;
      wakeIfAlive();
    }
  }

  function wakeIfAlive(): void {
    if (aliveCount > 0) wake();
  }

  // Theme changes: attribute flips on <html>/<body>, or OS scheme change.
  const themeObserver = new MutationObserver(onThemeSignal);
  for (const el of [document.documentElement, document.body]) {
    themeObserver.observe(el, {
      attributes: true, attributeFilter: ["class", "data-theme", "style"],
    });
  }
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = onThemeSignal;
  const onReduced = () => { if (reduced.matches) destroy(); };

  addEventListener("click", onClick, { passive: true });
  addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  scheme.addEventListener("change", onScheme);
  reduced.addEventListener("change", onReduced);

  /* -- teardown ------------------------------------------------------ */
  function destroy(): void {
    cancelAnimationFrame(raf);
    running = false;
    removeEventListener("click", onClick);
    removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibility);
    scheme.removeEventListener("change", onScheme);
    reduced.removeEventListener("change", onReduced);
    themeObserver.disconnect();
    clearTimeout(resizeTimer);
    for (const id of settleTimers) clearTimeout(id);
    canvas.remove();
    flashEl?.remove();
  }

  return { destroy };
}
