import { initKrackle } from "./krackle.esm.min.js";

const html = document.documentElement;
let handle = initKrackle();
let on = true;
document.getElementById("theme").addEventListener("click", () => {
  html.dataset.theme = html.dataset.theme === "dark" ? "light" : "dark";
});
const power = document.getElementById("power");
power.addEventListener("click", () => {
  if (on) { handle.destroy(); power.textContent = "⏻ Off"; }
  else { handle = initKrackle(); power.textContent = "⏻ On"; }
  on = !on;
  document.getElementById("stat").textContent = on ? "idle" : "destroyed";
});
setInterval(() => {
  if (!on) return;
  document.getElementById("stat").textContent =
    "canvas ×" + document.querySelectorAll("canvas").length;
}, 1000);
