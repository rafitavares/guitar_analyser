// Utilitários compartilhados
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

async function apiGet(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function apiCmd(cmd, value) {
  return fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, value }),
  });
}

function fmt(x, d = 0) {
  return Number.isFinite(x) ? x.toFixed(d) : "—";
}

// Formata com unidade automática (k/M)
function fmtSI(x, unit, d = 1) {
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toFixed(d) + " M" + unit;
  if (a >= 1e3) return (x / 1e3).toFixed(d) + " k" + unit;
  return x.toFixed(0) + " " + unit;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Lê as cores definidas no :root
const CSSV = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
