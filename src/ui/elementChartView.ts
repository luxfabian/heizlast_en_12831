import type { HeizlastResult, Project, BoundaryCategory, Floor as FloorType } from '../model/types.js';
import { getElementName } from '../model/elementLabel.js';
import { renderFloor, type RenderState } from '../editor/canvasRenderer.js';

const HULL_CATS = new Set<BoundaryCategory>(['exterior', 'ground', 'adj_neighbor', 'unheated']);
const MAX_BARS = 20;

// ── Color ramp (blue → violet → red) ─────────────────────────────────────────

function heatColor(t: number, alpha = 1): string {
  const stops: [number, number, number][] = [
    [ 37,  99, 235],
    [147,  51, 234],
    [220,  38,  38],
  ];
  const seg = Math.min(Math.floor(t * 2), 1);
  const u   = t * 2 - seg;
  const c1  = stops[seg], c2 = stops[seg + 1];
  const r   = Math.round(c1[0] + (c2[0] - c1[0]) * u);
  const g   = Math.round(c1[1] + (c2[1] - c1[1]) * u);
  const b   = Math.round(c1[2] + (c2[2] - c1[2]) * u);
  return alpha < 1
    ? `rgba(${r},${g},${b},${alpha})`
    : `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// ── Data types ────────────────────────────────────────────────────────────────

interface BarEntry {
  elementId:   string;
  elementType: string;
  name:        string;
  heatLoss:    number;
  inHull:      boolean;
}

function buildBars(result: HeizlastResult, project: Project, filterRoomId: string | null): BarEntry[] {
  const byId = new Map<string, BarEntry>();
  for (const { roomId, result: rr } of result.rooms) {
    if (filterRoomId !== null && roomId !== filterRoomId) continue;
    for (const el of rr.elementBreakdown) {
      const loss = Math.abs(el.heatLoss);
      const existing = byId.get(el.elementId);
      if (!existing || loss > existing.heatLoss) {
        byId.set(el.elementId, {
          elementId:   el.elementId,
          elementType: el.elementType,
          name:        getElementName(project, el.elementId, el.elementType),
          heatLoss:    loss,
          inHull:      HULL_CATS.has(el.boundaryCategory),
        });
      }
    }
  }
  return [...byId.values()]
    .filter(e => e.heatLoss > 0.5)
    .sort((a, b) => b.heatLoss - a.heatLoss)
    .slice(0, MAX_BARS);
}

// ── CAD preview helpers ───────────────────────────────────────────────────────

function findFloor(project: Project, elementId: string, elementType: string): FloorType | null {
  for (const floor of project.floors) {
    if (elementType === 'wall' && floor.walls.some(w => w.id === elementId)) return floor;
    if (['window', 'door', 'garage_door'].includes(elementType)
        && floor.openings.some(o => o.id === elementId)) return floor;
    if (elementType === 'floor'
        && floor.rooms.some(r => r.floors?.some(s => s.id === elementId))) return floor;
    if (elementType === 'ceiling'
        && floor.rooms.some(r => r.ceilings?.some(s => s.id === elementId))) return floor;
  }
  return null;
}

function elementCenter(floor: FloorType, elementId: string, elementType: string): { x: number; y: number } | null {
  if (elementType === 'wall') {
    const w = floor.walls.find(w => w.id === elementId);
    if (w) return { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
  }
  if (['window', 'door', 'garage_door'].includes(elementType)) {
    const o = floor.openings.find(o => o.id === elementId);
    if (o) {
      const wall = floor.walls.find(w => w.id === o.wallId);
      if (wall) {
        const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
        if (len > 0) {
          const t = (o.positionAlongWall + o.width / 2) / len;
          return { x: wall.start.x + (wall.end.x - wall.start.x) * t,
                   y: wall.start.y + (wall.end.y - wall.start.y) * t };
        }
      }
    }
  }
  for (const room of floor.rooms) {
    const surfs = elementType === 'floor' ? room.floors : room.ceilings;
    if (surfs?.some(s => s.id === elementId)) {
      const ws = room.wallIds.map(id => floor.walls.find(w => w.id === id)).filter(Boolean);
      if (ws.length) {
        const xs = ws.flatMap(w => [w!.start.x, w!.end.x]);
        const ys = ws.flatMap(w => [w!.start.y, w!.end.y]);
        return { x: (Math.min(...xs) + Math.max(...xs)) / 2,
                 y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      }
    }
  }
  return null;
}

function paintPreview(
  canvas: HTMLCanvasElement,
  floor: FloorType,
  entry: BarEntry,
  result: HeizlastResult,
): void {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.width  / dpr;
  const H   = canvas.height / dpr;

  // Fit entire floor plan with margin
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const w of floor.walls) {
    for (const p of [w.start, w.end]) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) return;
  const PAD_MM = 800;
  const scale  = Math.min(W / (maxX - minX + PAD_MM * 2), H / (maxY - minY + PAD_MM * 2));
  const vp = {
    scale,
    offsetX: W / 2 - (minX + maxX) / 2 * scale,
    offsetY: H / 2 - (minY + maxY) / 2 * scale,
  };

  const state: RenderState = {
    showHeatMap:        false,
    showBoundaryLabels: false,
    showRoomLabels:     false,
    gridEnabled:        false,
    tool:               'select',
    selectedWallId:     entry.elementType === 'wall' ? entry.elementId : undefined,
    selectedOpeningId:  ['window', 'door', 'garage_door'].includes(entry.elementType)
                          ? entry.elementId : undefined,
    heizlastResult:     result,
  };

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderFloor(ctx, floor, vp, state, W, H);

  // Amber crosshair on element center
  const ctr = elementCenter(floor, entry.elementId, entry.elementType);
  if (ctr) {
    const cx = ctr.x * scale + vp.offsetX;
    const cy = ctr.y * scale + vp.offsetY;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth   = 1.5;
    const sz = 10;
    ctx.beginPath();
    ctx.moveTo(cx - sz, cy); ctx.lineTo(cx + sz, cy);
    ctx.moveTo(cx, cy - sz); ctx.lineTo(cx, cy + sz);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#fbbf24';
    ctx.stroke();
  }
}

// ── Chart drawing (pure canvas) ───────────────────────────────────────────────

const PAD_L  = 76;
const PAD_T  = 24;
const PAD_R  = 32;
const PAD_B  = 130;
const BAR_W  = 34;
const BAR_GAP = 10;
const CHART_H = 320;

function chartDims(n: number) {
  const chartW = n * (BAR_W + BAR_GAP) - BAR_GAP;
  return { totalW: PAD_L + chartW + PAD_R, totalH: PAD_T + CHART_H + PAD_B, chartW };
}

function drawChart(
  ctx:           CanvasRenderingContext2D,
  bars:          BarEntry[],
  totalW:        number,
  chartW:        number,
  selectedIndex: number,
): void {
  const maxLoss = bars[0]?.heatLoss ?? 1;
  ctx.fillStyle = '#0f1117';
  ctx.fillRect(0, 0, totalW, PAD_T + CHART_H + PAD_B);

  // Y gridlines + labels
  const Y_TICKS = 5;
  for (let i = 0; i <= Y_TICKS; i++) {
    const frac = i / Y_TICKS;
    const y    = PAD_T + CHART_H * (1 - frac);
    ctx.strokeStyle = '#1e2535';
    ctx.lineWidth   = i === 0 ? 1 : 0.5;
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + chartW, y); ctx.stroke();
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4a9eff';
    ctx.fillText(`${Math.round(maxLoss * frac)} W`, PAD_L - 6, y);
  }

  // Rotated Y-axis label
  ctx.save();
  ctx.translate(14, PAD_T + CHART_H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '11px "Inter", system-ui';
  ctx.fillStyle = '#64748b';
  ctx.fillText('Wärmeverlust (W)', 0, 0);
  ctx.restore();

  // Bars
  for (let i = 0; i < bars.length; i++) {
    const bar   = bars[i];
    const t     = bar.heatLoss / maxLoss;
    const barH  = Math.max(t * CHART_H, 1);
    const x     = PAD_L + i * (BAR_W + BAR_GAP);
    const y     = PAD_T + CHART_H - barH;
    const isSel = i === selectedIndex;

    if (bar.inHull) {
      ctx.fillStyle   = heatColor(t, isSel ? 1 : 0.82);
      ctx.fillRect(x, y, BAR_W, barH);
      ctx.strokeStyle = isSel ? '#ffffff' : heatColor(t);
      ctx.lineWidth   = isSel ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, BAR_W - 1, barH - 1);
    } else {
      ctx.strokeStyle = isSel ? '#ffffff' : heatColor(t, 0.65);
      ctx.lineWidth   = isSel ? 2 : 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, BAR_W - 1.5, Math.max(barH - 1.5, 1));
    }

    // Value above bar
    ctx.font = '8px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = isSel ? '#ffffff' : (bar.inHull ? '#cbd5e1' : '#64748b');
    ctx.fillText(`${Math.round(bar.heatLoss)}`, x + BAR_W / 2, y - 2);

    // 45° label
    ctx.save();
    ctx.translate(x + BAR_W / 2, PAD_T + CHART_H + 8);
    ctx.rotate(Math.PI / 4);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '10px "Inter", system-ui';
    ctx.fillStyle = isSel ? '#e2e8f0' : '#94a3b8';
    ctx.fillText(bar.name, 0, 0);
    ctx.restore();
  }

  // X-axis baseline
  ctx.strokeStyle = '#2a3550'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_L, PAD_T + CHART_H); ctx.lineTo(PAD_L + chartW, PAD_T + CHART_H);
  ctx.stroke();
}

// ── Main render entry point ───────────────────────────────────────────────────

export function renderElementChart(
  container: HTMLElement,
  result:    HeizlastResult,
  project:   Project,
): void {
  container.innerHTML = '';
  container.style.flexDirection = 'column';
  container.style.background    = '#0f1117';
  container.style.overflow      = 'hidden';

  // ── Title bar ──────────────────────────────────────────────────────────────
  const totalW = result.designHeatLoad;

  const titleBar = document.createElement('div');
  titleBar.style.cssText = 'padding:14px 24px 12px;border-bottom:1px solid #1e2535;flex-shrink:0';
  titleBar.innerHTML = `
    <div style="font-size:15px;font-weight:700;color:#cbd5e1;font-family:'Inter',system-ui;margin-bottom:3px">
      Wärmeverlust je Bauteil
    </div>
    <div style="font-size:10px;color:#64748b;font-family:'Courier New',monospace">
      Φ<sub style="font-size:8px">HL</sub> = ${(totalW / 1000).toFixed(2)} kW
      &nbsp;·&nbsp;
      θ<sub style="font-size:8px">e</sub> = ${result.designTemperature} °C
      &nbsp;·&nbsp;
      Top-${MAX_BARS} Elemente
    </div>`;
  container.appendChild(titleBar);

  // ── Controls: room filter dropdown ────────────────────────────────────────
  const controlsRow = document.createElement('div');
  controlsRow.style.cssText = 'padding:10px 24px;border-bottom:1px solid #1e2535;flex-shrink:0;display:flex;align-items:center;gap:12px';

  const filterLabel = document.createElement('label');
  filterLabel.textContent = 'Raum:';
  filterLabel.style.cssText = 'font-size:11px;font-weight:600;color:#64748b;font-family:"Inter",system-ui;text-transform:uppercase;letter-spacing:0.06em;white-space:nowrap';

  const roomSel = document.createElement('select');
  roomSel.className = 'select';
  roomSel.style.cssText = 'max-width:300px;height:28px;font-size:12px';

  const optAll = document.createElement('option');
  optAll.value = ''; optAll.textContent = 'Alle Elemente';
  roomSel.appendChild(optAll);

  const allRooms = project.floors.flatMap(f => f.rooms);
  for (const { roomId, result: rr } of result.rooms) {
    const room = allRooms.find(r => r.id === roomId);
    if (!room) continue;
    const opt = document.createElement('option');
    opt.value = roomId;
    opt.textContent = `${room.label} (${Math.round(rr.totalLoss)} W)`;
    roomSel.appendChild(opt);
  }

  controlsRow.appendChild(filterLabel);
  controlsRow.appendChild(roomSel);
  container.appendChild(controlsRow);

  // ── Content area ──────────────────────────────────────────────────────────
  const contentArea = document.createElement('div');
  contentArea.style.cssText = 'flex:1;position:relative;overflow:hidden';
  container.appendChild(contentArea);

  // Scrollable chart column (centered)
  const scrollArea = document.createElement('div');
  scrollArea.style.cssText = 'position:absolute;inset:0;overflow:auto;display:flex;flex-direction:column;align-items:center;padding:24px 24px 24px 24px';
  contentArea.appendChild(scrollArea);

  // Chart canvas
  const dpr    = window.devicePixelRatio || 1;
  const chartCanvas = document.createElement('canvas');
  scrollArea.appendChild(chartCanvas);

  // Legend
  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;gap:24px;align-items:center;margin-top:16px;font-size:11px;color:#64748b;font-family:"Inter",system-ui';

  const mkItem = (label: string, solid: boolean) => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:8px';
    const sw = document.createElement('div');
    sw.style.cssText = `width:24px;height:14px;border:1.5px solid #6366f1;border-radius:2px;${solid ? 'background:rgba(99,102,241,0.75)' : ''}`;
    item.appendChild(sw);
    item.appendChild(Object.assign(document.createElement('span'), { textContent: label }));
    return item;
  };
  legend.appendChild(mkItem('Thermische Hülle (Nettoverlust nach außen)', true));
  legend.appendChild(mkItem('Interner Wärmeaustausch', false));
  scrollArea.appendChild(legend);

  // ── Preview panel (bottom-right, overlaid, square) ────────────────────────
  const PREV_SIZE = 300;
  const previewPanel = document.createElement('div');
  previewPanel.style.cssText = [
    `position:absolute;bottom:16px;right:16px`,
    `width:${PREV_SIZE}px;height:${PREV_SIZE}px`,
    `background:#0d1117;border:1px solid #2a3550;border-radius:6px`,
    `display:flex;flex-direction:column;overflow:hidden`,
    `box-shadow:0 4px 24px rgba(0,0,0,0.5)`,
  ].join(';');
  contentArea.appendChild(previewPanel);

  const prevHeader = document.createElement('div');
  prevHeader.style.cssText = 'padding:5px 10px;border-bottom:1px solid #1e2535;flex-shrink:0;display:flex;align-items:baseline;justify-content:space-between;gap:8px';
  prevHeader.innerHTML = `
    <span style="font-size:10px;font-weight:600;color:#64748b;font-family:'Inter',system-ui;text-transform:uppercase;letter-spacing:0.06em">Bauteilvorschau</span>
    <span id="prev-floor-label" style="font-size:10px;color:#93c5fd;font-family:'Inter',system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></span>`;
  previewPanel.appendChild(prevHeader);

  const prevBody = document.createElement('div');
  prevBody.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden';
  previewPanel.appendChild(prevBody);

  const prevPlaceholder = document.createElement('div');
  prevPlaceholder.style.cssText = 'font-size:11px;color:#334155;font-family:"Inter",system-ui;text-align:center;padding:16px';
  prevPlaceholder.textContent = 'Element anklicken';
  prevBody.appendChild(prevPlaceholder);

  const prevCanvas = document.createElement('canvas');
  const PREV_CANVAS_H = PREV_SIZE - 26; // subtract header
  prevCanvas.width  = PREV_SIZE * dpr;
  prevCanvas.height = PREV_CANVAS_H * dpr;
  prevCanvas.style.cssText = `width:${PREV_SIZE}px;height:${PREV_CANVAS_H}px;display:none`;
  prevBody.appendChild(prevCanvas);

  const prevInfo = document.createElement('div');
  prevInfo.style.cssText = [
    'position:absolute;bottom:0;left:0;right:0',
    'padding:4px 8px;background:rgba(13,17,23,0.85)',
    'font-size:9px;color:#94a3b8;font-family:"Courier New",monospace',
    'display:none',
  ].join(';');
  prevBody.appendChild(prevInfo);

  // ── State & update logic ──────────────────────────────────────────────────
  let bars: BarEntry[] = [];
  let selectedIndex = -1;

  function updatePreview(idx: number): void {
    if (idx < 0 || idx >= bars.length) return;
    const entry = bars[idx];
    const floor = findFloor(project, entry.elementId, entry.elementType);
    if (!floor) return;

    const floorLabelEl = previewPanel.querySelector<HTMLElement>('#prev-floor-label');
    if (floorLabelEl) floorLabelEl.textContent = floor.label;

    prevPlaceholder.style.display = 'none';
    prevCanvas.style.display = 'block';
    prevInfo.style.display = 'block';
    paintPreview(prevCanvas, floor, entry, result);
    prevInfo.textContent = `${entry.name}  ·  ${Math.round(entry.heatLoss)} W`;
  }

  function rebuildChart(filterRoomId: string | null): void {
    bars = buildBars(result, project, filterRoomId);
    selectedIndex = -1;

    if (bars.length === 0) {
      chartCanvas.style.display = 'none';
      legend.style.display = 'none';
      return;
    }

    chartCanvas.style.display = '';
    legend.style.display = 'flex';

    const { totalW: tw, totalH: th, chartW: cw } = chartDims(bars.length);
    chartCanvas.width        = tw * dpr;
    chartCanvas.height       = th * dpr;
    chartCanvas.style.width  = `${tw}px`;
    chartCanvas.style.height = `${th}px`;

    const ctx2 = chartCanvas.getContext('2d')!;
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawChart(ctx2, bars, tw, cw, -1);
  }

  function redraw(): void {
    if (!bars.length) return;
    const { totalW: tw, chartW: cw } = chartDims(bars.length);
    const ctx2 = chartCanvas.getContext('2d')!;
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawChart(ctx2, bars, tw, cw, selectedIndex);
  }

  // Bar click detection
  chartCanvas.addEventListener('click', (e: MouseEvent) => {
    const rect = chartCanvas.getBoundingClientRect();
    const x    = e.clientX - rect.left;
    const y    = e.clientY - rect.top;
    const baseY = PAD_T;
    if (y < baseY || y > PAD_T + CHART_H) return;
    const col = Math.floor((x - PAD_L) / (BAR_W + BAR_GAP));
    if (col < 0 || col >= bars.length) return;
    const barX = PAD_L + col * (BAR_W + BAR_GAP);
    if (x < barX || x > barX + BAR_W) return;
    selectedIndex = col;
    redraw();
    updatePreview(selectedIndex);
  });

  // Room filter change
  roomSel.addEventListener('change', () => {
    rebuildChart(roomSel.value || null);
    prevPlaceholder.style.display = '';
    prevCanvas.style.display = 'none';
    prevInfo.style.display = 'none';
  });

  // Initial render
  rebuildChart(null);
}
