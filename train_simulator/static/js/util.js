// Shared utilities. Author: Rafael Tavares
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const SVGNS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

function fmt(x, d = 0) {
  return Number.isFinite(x) ? x.toFixed(d) : "—";
}

// Formats with an automatic unit prefix (k/M)
function fmtSI(x, unit, d = 1) {
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toFixed(d) + " M" + unit;
  if (a >= 1e3) return (x / 1e3).toFixed(a >= 1e5 ? 0 : d) + " k" + unit;
  return x.toFixed(0) + " " + unit;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
