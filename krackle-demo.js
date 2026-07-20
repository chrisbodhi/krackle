import { initKrackle, DEFAULTS } from "./krackle.esm.min.js";

const html = document.documentElement;
const panel = document.getElementById("tuner");
const state = structuredClone(DEFAULTS);

const FIELDS = [
  { group: "Spawn & travel", key: "burstRadius", label: "Burst radius", kind: "pair", min: 0, max: 320, step: 2, unit: "px" },
  { key: "driftRange", label: "Drift distance", kind: "pair", min: 0, max: 120, step: 2, unit: "px" },
  { key: "bandAttempts", label: "Cluster density (inner→outer)", kind: "triplet", min: 0, max: 30, step: 1 },
  { key: "bandDelayMs", label: "Band stagger", kind: "single", min: 0, max: 250, step: 5, unit: "ms" },

  { group: "Dot shape & size", key: "anchorRadius", label: "Anchor size", kind: "pair", min: 2, max: 30, step: 0.5, unit: "px" },
  { key: "satRadius", label: "Satellite size", kind: "pair", min: 2, max: 30, step: 0.5, unit: "px" },
  { key: "satsMax", label: "Satellites per cluster", kind: "single", min: 0, max: 24, step: 1 },
  { key: "satSpread", label: "Satellite spread", kind: "single", min: 0.3, max: 4, step: 0.05, unit: "×r" },
  { key: "dissolve", label: "Rim dissolve", kind: "single", min: 0, max: 1, step: 0.01 },
  { key: "lobesMax", label: "Silhouette lobes", kind: "single", min: 1, max: 6, step: 1 },
  { key: "lobeSpread", label: "Lobe spread", kind: "single", min: 0.1, max: 1.2, step: 0.01 },
  { key: "rimWidth", label: "Dark-mode rim width", kind: "single", min: 0, max: 5, step: 0.1, unit: "px" },

  { group: "Rays", key: "rays", label: "Ray count", kind: "pair", min: 0, max: 8, step: 1 },
  { key: "rayHalf", label: "Ray half-angle", kind: "pair", min: 0.02, max: 0.8, step: 0.01, unit: "rad" },

  { group: "Lifetime & pool", key: "lifespan", label: "Lifespan", kind: "pair", min: 200, max: 5000, step: 50, unit: "ms" },
  { key: "maxParticles", label: "Particle pool", kind: "single", min: 50, max: 2000, step: 10 },

  { group: "Flash", key: "flash", label: "Flash mode", kind: "select", options: ["none", "white", "invert"] },
  { key: "flashMs", label: "Flash duration", kind: "single", min: 20, max: 800, step: 10, unit: "ms" },
  { key: "flashPeak", label: "Flash peak opacity", kind: "single", min: 0, max: 1, step: 0.05 },
];

function fmt(n, step) {
  const decimals = (String(step).split(".")[1] || "").length;
  return decimals ? n.toFixed(decimals) : String(Math.round(n));
}

function mkRange(f, value) {
  const input = document.createElement("input");
  input.type = "range";
  input.min = f.min; input.max = f.max; input.step = f.step; input.value = value;
  return input;
}

function renderFields() {
  const fields = document.createElement("div");
  let currentGroup = null;
  for (const f of FIELDS) {
    if (f.group && f.group !== currentGroup) {
      currentGroup = f.group;
      const h = document.createElement("div");
      h.className = "group-title";
      h.textContent = f.group;
      fields.appendChild(h);
    }
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = f.label + (f.unit ? ` (${f.unit})` : "");
    const val = document.createElement("span");
    val.className = "val";
    label.append(name, val);
    row.appendChild(label);

    if (f.kind === "select") {
      val.textContent = state[f.key];
      const select = document.createElement("select");
      for (const opt of f.options) {
        const o = document.createElement("option");
        o.value = opt; o.textContent = opt;
        if (opt === state[f.key]) o.selected = true;
        select.appendChild(o);
      }
      select.addEventListener("input", () => {
        state[f.key] = select.value;
        val.textContent = state[f.key];
        onChange();
      });
      row.appendChild(select);
    } else if (f.kind === "single") {
      val.textContent = fmt(state[f.key], f.step);
      const input = mkRange(f, state[f.key]);
      input.addEventListener("input", () => {
        state[f.key] = Number(input.value);
        val.textContent = fmt(state[f.key], f.step);
        onChange();
      });
      row.appendChild(input);
    } else {
      const n = f.kind === "pair" ? 2 : 3;
      const updateVal = () => { val.textContent = state[f.key].map((v) => fmt(v, f.step)).join(" – "); };
      updateVal();
      const wrap = document.createElement("div");
      wrap.className = f.kind;
      for (let i = 0; i < n; i++) {
        const input = mkRange(f, state[f.key][i]);
        input.addEventListener("input", () => {
          state[f.key][i] = Number(input.value);
          updateVal();
          onChange();
        });
        wrap.appendChild(input);
      }
      row.appendChild(wrap);
    }
    fields.appendChild(row);
  }
  fieldsMount.replaceChildren(fields);
}

panel.innerHTML = `
  <div class="group-title" style="margin-top:0">Krackle tuner</div>
  <div id="fields-mount"></div>
  <div class="actions">
    <button id="reburst">⟲ Reburst</button>
    <button id="reseed">🎲 New seed</button>
    <button id="reset">↺ Reset</button>
    <button id="copy">⧉ Copy config</button>
  </div>
  <pre id="config-json"></pre>
`;
const fieldsMount = document.getElementById("fields-mount");
const configJson = document.getElementById("config-json");

// Panel interactions never bubble to krackle's own click listener — sliders
// and buttons shouldn't detonate a burst on every fiddle.
panel.addEventListener("click", (e) => e.stopPropagation());

let handle = null;
let on = true;
let applyTimer = 0;

function apply() {
  handle?.destroy();
  handle = on ? initKrackle(structuredClone(state)) : null;
}

function refreshJson() {
  configJson.textContent = JSON.stringify(state, null, 2);
}

function onChange() {
  refreshJson();
  clearTimeout(applyTimer);
  applyTimer = setTimeout(apply, 120);
}

let lastPoint = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener("click", (e) => {
  if (e.detail === 0 || panel.contains(e.target)) return;
  lastPoint = { x: e.clientX, y: e.clientY };
});

document.getElementById("reburst").addEventListener("click", () => {
  document.dispatchEvent(new MouseEvent("click", {
    clientX: lastPoint.x, clientY: lastPoint.y, bubbles: true, detail: 1,
  }));
});
document.getElementById("reseed").addEventListener("click", () => {
  state.seed = (Math.random() * 2 ** 31) | 0;
  onChange();
});
document.getElementById("reset").addEventListener("click", () => {
  Object.assign(state, structuredClone(DEFAULTS));
  renderFields();
  onChange();
});
document.getElementById("copy").addEventListener("click", () => {
  navigator.clipboard.writeText(JSON.stringify(state, null, 2));
});

document.getElementById("tune").addEventListener("click", () => {
  panel.classList.toggle("open");
});

renderFields();
refreshJson();
apply();

document.getElementById("theme").addEventListener("click", () => {
  html.dataset.theme = html.dataset.theme === "dark" ? "light" : "dark";
});
const power = document.getElementById("power");
power.addEventListener("click", () => {
  on = !on;
  apply();
  power.textContent = on ? "⏻ On" : "⏻ Off";
  document.getElementById("stat").textContent = on ? "idle" : "destroyed";
});
setInterval(() => {
  if (!on) return;
  document.getElementById("stat").textContent =
    "canvas ×" + document.querySelectorAll("canvas").length;
}, 1000);
