// Utilitário genérico de gráfico de linhas/dispersão em canvas, usado por
// todos os testes (decaimento, espectro, inarmonicidade, batimento, sweep).
// Sem dependências externas — desenho direto em Canvas 2D.

export interface ChartSeries {
  points: { x: number; y: number }[];
  color: string;
  style?: "line" | "points" | "bars";
  lineWidth?: number;
  pointRadius?: number;
}

export interface ChartRefLine {
  axis: "x" | "y";
  value: number;
  color: string;
  label?: string;
  dashed?: boolean;
}

export interface ChartMarker {
  x: number;
  y: number;
  color: string;
  label?: string;
}

export interface ChartConfig {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  series: ChartSeries[];
  refLines?: ChartRefLine[];
  markers?: ChartMarker[];
  xLabel?: string;
  yLabel?: string;
  heightPx?: number;
  xLogScale?: boolean;
}

const PADDING = { top: 14, right: 14, bottom: 28, left: 42 };

export function setupCanvas(canvas: HTMLCanvasElement, heightPx: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.parentElement?.clientWidth || 320;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(heightPx * dpr);
  canvas.style.height = `${heightPx}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function xToPixel(x: number, cfg: ChartConfig, w: number): number {
  const plotW = w - PADDING.left - PADDING.right;
  if (cfg.xLogScale) {
    const logMin = Math.log10(Math.max(cfg.xMin, 1));
    const logMax = Math.log10(Math.max(cfg.xMax, 1));
    const logX = Math.log10(Math.max(x, 1));
    return PADDING.left + ((logX - logMin) / (logMax - logMin)) * plotW;
  }
  return PADDING.left + ((x - cfg.xMin) / (cfg.xMax - cfg.xMin)) * plotW;
}

function yToPixel(y: number, cfg: ChartConfig, h: number): number {
  const plotH = h - PADDING.top - PADDING.bottom;
  const frac = (y - cfg.yMin) / (cfg.yMax - cfg.yMin);
  return PADDING.top + plotH - frac * plotH;
}

export function drawChart(canvas: HTMLCanvasElement, cfg: ChartConfig): void {
  const heightPx = cfg.heightPx ?? 220;
  const ctx = setupCanvas(canvas, heightPx);
  const w = canvas.clientWidth || 320;
  const h = heightPx;

  ctx.clearRect(0, 0, w, h);

  // Grid + eixos
  ctx.strokeStyle = "#2a2f37";
  ctx.lineWidth = 1;
  ctx.font = "10px -apple-system, sans-serif";
  ctx.fillStyle = "#6b7480";

  const gridLinesY = 4;
  for (let i = 0; i <= gridLinesY; i++) {
    const y = cfg.yMin + ((cfg.yMax - cfg.yMin) * i) / gridLinesY;
    const py = yToPixel(y, cfg, h);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, py);
    ctx.lineTo(w - PADDING.right, py);
    ctx.stroke();
    ctx.fillText(formatTick(y), 2, py + 3);
  }

  const gridLinesX = 4;
  for (let i = 0; i <= gridLinesX; i++) {
    const x = cfg.xMin + ((cfg.xMax - cfg.xMin) * i) / gridLinesX;
    const px = xToPixel(x, cfg, w);
    ctx.fillText(formatTick(x), px - 10, h - PADDING.bottom + 14);
  }

  // Linhas de referência
  for (const ref of cfg.refLines ?? []) {
    ctx.strokeStyle = ref.color;
    ctx.lineWidth = 1;
    if (ref.dashed) ctx.setLineDash([4, 4]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    if (ref.axis === "y") {
      const py = yToPixel(ref.value, cfg, h);
      ctx.moveTo(PADDING.left, py);
      ctx.lineTo(w - PADDING.right, py);
    } else {
      const px = xToPixel(ref.value, cfg, w);
      ctx.moveTo(px, PADDING.top);
      ctx.lineTo(px, h - PADDING.bottom);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (ref.label) {
      ctx.fillStyle = ref.color;
      if (ref.axis === "y") {
        ctx.fillText(ref.label, w - PADDING.right - ctx.measureText(ref.label).width - 2, yToPixel(ref.value, cfg, h) - 3);
      } else {
        ctx.fillText(ref.label, xToPixel(ref.value, cfg, w) + 2, PADDING.top + 10);
      }
    }
  }

  // Séries
  for (const series of cfg.series) {
    ctx.strokeStyle = series.color;
    ctx.fillStyle = series.color;
    ctx.lineWidth = series.lineWidth ?? 2;

    if (series.style === "bars") {
      const barW = Math.max(2, (w - PADDING.left - PADDING.right) / Math.max(series.points.length, 1) - 4);
      for (const p of series.points) {
        const px = xToPixel(p.x, cfg, w);
        const py = yToPixel(p.y, cfg, h);
        const baseY = yToPixel(Math.max(cfg.yMin, 0), cfg, h);
        ctx.fillRect(px - barW / 2, Math.min(py, baseY), barW, Math.abs(baseY - py));
      }
    } else if (series.style === "points") {
      const r = series.pointRadius ?? 3;
      for (const p of series.points) {
        const px = xToPixel(p.x, cfg, w);
        const py = yToPixel(p.y, cfg, h);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      series.points.forEach((p, i) => {
        const px = xToPixel(p.x, cfg, w);
        const py = yToPixel(Math.max(cfg.yMin, Math.min(cfg.yMax, p.y)), cfg, h);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }

  // Marcadores
  for (const marker of cfg.markers ?? []) {
    const px = xToPixel(marker.x, cfg, w);
    const py = yToPixel(marker.y, cfg, h);
    ctx.fillStyle = marker.color;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    if (marker.label) {
      ctx.fillText(marker.label, px + 6, py - 6);
    }
  }
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

/** Gráfico radar (spider chart) para comparação entre instrumentos. */
export interface RadarSeries {
  label: string;
  color: string;
  /** Valores normalizados 0-100, um por eixo, na mesma ordem de `axes`. */
  values: number[];
}

export function drawRadarChart(
  canvas: HTMLCanvasElement,
  axes: string[],
  series: RadarSeries[],
  heightPx = 280
): void {
  const ctx = setupCanvas(canvas, heightPx);
  const w = canvas.clientWidth || 320;
  const h = heightPx;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2 - 6;
  const radius = Math.min(w, h) / 2 - 46;
  const n = axes.length;
  const angleStep = (Math.PI * 2) / n;

  // Anéis de grade
  ctx.strokeStyle = "#2a2f37";
  ctx.lineWidth = 1;
  for (let ring = 1; ring <= 4; ring++) {
    const r = (radius * ring) / 4;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const angle = -Math.PI / 2 + angleStep * i;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Eixos + rótulos
  ctx.fillStyle = "#9aa4b2";
  ctx.font = "11px -apple-system, sans-serif";
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + angleStep * i;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    ctx.strokeStyle = "#2a2f37";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();

    const labelX = cx + (radius + 12) * Math.cos(angle);
    const labelY = cy + (radius + 12) * Math.sin(angle);
    ctx.textAlign = Math.abs(Math.cos(angle)) < 0.3 ? "center" : Math.cos(angle) > 0 ? "left" : "right";
    ctx.fillText(axes[i] ?? "", labelX, labelY);
  }
  ctx.textAlign = "left";

  // Polígonos das séries
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color + "33";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const idx = i % n;
      const angle = -Math.PI / 2 + angleStep * idx;
      const value = Math.max(0, Math.min(100, s.values[idx] ?? 0));
      const r = (radius * value) / 100;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
