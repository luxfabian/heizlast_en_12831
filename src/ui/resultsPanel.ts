import type { HeizlastResult, Project, HullGroup, BoundaryCategory } from '../model/types.js';
import { getBoundaryCategoryLabel } from '../editor/adjacency.js';
import type { Editor } from '../editor/editorState.js';
import { v4 as uuidv4 } from '../utils/uuid.js';

function energyLabel(wPerM2: number): { label: string; color: string } {
  if (wPerM2 < 10)  return { label: 'A+++', color: '#16a34a' };
  if (wPerM2 < 20)  return { label: 'A++',  color: '#22c55e' };
  if (wPerM2 < 35)  return { label: 'A+',   color: '#4ade80' };
  if (wPerM2 < 50)  return { label: 'A',    color: '#86efac' };
  if (wPerM2 < 75)  return { label: 'B',    color: '#bef264' };
  if (wPerM2 < 100) return { label: 'C',    color: '#fbbf24' };
  if (wPerM2 < 125) return { label: 'D',    color: '#f97316' };
  if (wPerM2 < 160) return { label: 'E',    color: '#ef4444' };
  return               { label: 'F',    color: '#991b1b' };
}

export function renderResultsBench(
  bench: HTMLElement,
  detailEl: HTMLElement,
  totalEl: HTMLElement,
  specificEl: HTMLElement,
  stripEl: HTMLElement,
  result: HeizlastResult,
  project: Project,
  editor: Editor,
): void {
  const kw = (result.designHeatLoad / 1000).toFixed(1);
  totalEl.textContent = `${kw} kW`;

  const spec = result.designSpecificHeatLoad;
  specificEl.textContent = `${spec.toFixed(0)} W/m²`;
  specificEl.style.color = spec > 100 ? 'var(--red)' : '';

  const { label, color } = energyLabel(spec);
  const energyEl = document.getElementById('rb-energy');
  if (energyEl) {
    energyEl.textContent = label;
    energyEl.style.color = color;
    energyEl.style.borderColor = color;
  }

  // Colorbar — total W per room, normalized same as canvas heatLoadColor()
  stripEl.innerHTML = '';
  const roomLoads = result.rooms.map(rr => rr.result.totalLoss);
  const maxLoad = Math.max(...roomLoads, 1);
  const minW = Math.floor(Math.min(...roomLoads));
  const maxW = Math.ceil(maxLoad);

  const stops = Array.from({ length: 9 }, (_, i) => {
    const t = Math.min(1, (minW + (i / 8) * (maxW - minW)) / maxLoad);
    return `rgb(${Math.round(10 + t * 200)},${Math.round(60 - t * 40)},${Math.round(160 - t * 140)})`;
  }).join(', ');

  const wrap = document.createElement('div');
  wrap.className = 'rb-colorbar-wrap';
  const minLbl = document.createElement('span');
  minLbl.className = 'rb-colorbar-label';
  minLbl.textContent = `${Math.round(minW)} W`;
  const bar = document.createElement('div');
  bar.className = 'rb-colorbar';
  bar.style.background = `linear-gradient(to right, ${stops})`;
  const maxLbl = document.createElement('span');
  maxLbl.className = 'rb-colorbar-label';
  maxLbl.textContent = `${Math.round(maxW)} W`;
  wrap.appendChild(minLbl);
  wrap.appendChild(bar);
  wrap.appendChild(maxLbl);
  stripEl.appendChild(wrap);

  renderDetailPanel(detailEl, result, project, editor);
  bench.classList.add('has-results');
}

// ---- Detail panel ----

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {},
  ...children: (HTMLElement | Text | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children)
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

const BOUNDARY_CATS: BoundaryCategory[] = ['exterior', 'adj_heated', 'adj_reduced', 'ground', 'unheated'];

function renderDetailPanel(
  container: HTMLElement,
  result: HeizlastResult,
  project: Project,
  editor: Editor,
): void {
  container.innerHTML = '';
  const roomMap = new Map(project.floors.flatMap(f => f.rooms).map(r => [r.id, r]));

  // Two-column layout: left = tables, right = chart
  const cols = el('div', { class: 'rb-detail-cols' });
  const leftCol  = el('div', { class: 'rb-detail-left' });
  const rightCol = el('div', { class: 'rb-detail-right' });
  cols.appendChild(leftCol);
  cols.appendChild(rightCol);

  // ── 1. Loss breakdown by category ──────────────────────────────
  const catSection = el('div', { class: 'rb-section' });
  catSection.appendChild(el('div', { class: 'rb-section-title' }, 'Verluste nach Kategorie'));

  const catTable = el('table', { class: 'rb-table' });
  const { exterior, ground, adjNeighbor, ventilation } = result.lossByCategory;
  const catRows: [string, number][] = [
    ['Außenluft / Unbeheizt', exterior],
    ['Erdreich', ground],
    ['Nachbargebäude', adjNeighbor],
    ['Lüftung', ventilation],
  ];
  for (const [label, w] of catRows) {
    if (w <= 0) continue;
    const tr = el('tr', {});
    tr.innerHTML = `<td>${label}</td><td class="rb-num">${Math.round(w)} W</td>
      <td class="rb-bar-cell"><div class="rb-bar" style="width:${(w / result.designHeatLoad * 100).toFixed(1)}%"></div></td>`;
    catTable.appendChild(tr);
  }
  const totalTr = el('tr', { class: 'rb-total-row' });
  totalTr.innerHTML = `<td>ΦHL gesamt</td>
    <td class="rb-num"><strong>${Math.round(result.designHeatLoad)} W (${(result.designHeatLoad / 1000).toFixed(1)} kW)</strong></td>
    <td></td>`;
  catTable.appendChild(totalTr);
  catSection.appendChild(catTable);

  const metaRow = el('div', { class: 'rb-meta-row' });
  metaRow.innerHTML =
    `<span>θe = <strong>${result.designTemperature} °C</strong></span>` +
    (result.plz ? `<span>PLZ ${result.plz}</span>` : '') +
    `<span>q = <strong>${result.designSpecificHeatLoad.toFixed(0)} W/m²</strong></span>`;
  catSection.appendChild(metaRow);
  leftCol.appendChild(catSection);

  // ── 2. Per-room compact table ───────────────────────────────────
  const roomSection = el('div', { class: 'rb-section' });
  roomSection.appendChild(el('div', { class: 'rb-section-title' }, 'Raumübersicht'));

  const roomTable = el('table', { class: 'rb-table rb-room-table' });
  roomTable.innerHTML = `<thead><tr>
    <th>Raum</th><th>m²</th><th>°C</th><th>ΦHL (W)</th><th>W/m²</th>
  </tr></thead>`;
  const tbody = el('tbody', {});

  for (const rr of result.rooms) {
    const room = roomMap.get(rr.roomId);
    if (!room) continue;
    const area = room.area ?? 0;
    const spec = area > 0 ? rr.result.totalLoss / area : 0;

    const tr = el('tr', { class: 'rb-room-row clickable', 'data-room-id': rr.roomId });
    tr.innerHTML = `
      <td>${room.label}</td>
      <td class="rb-num">${area.toFixed(1)}</td>
      <td class="rb-num">${room.designTemperature}</td>
      <td class="rb-num"><strong>${Math.round(rr.result.totalLoss)}</strong></td>
      <td class="rb-num">${spec.toFixed(0)}</td>
    `;

    const detailRow = el('tr', { class: 'rb-detail-row hidden', 'data-for': rr.roomId });
    const detailCell = el('td', { colspan: '5', class: 'rb-detail-cell' });
    renderCategoryBreakdown(detailCell, rr.result.elementBreakdown);
    detailRow.appendChild(detailCell);
    tr.addEventListener('click', () => detailRow.classList.toggle('hidden'));
    tbody.appendChild(tr);
    tbody.appendChild(detailRow);
  }
  roomTable.appendChild(tbody);
  roomSection.appendChild(roomTable);
  leftCol.appendChild(roomSection);

  // ── 3. Hull group editor (collapsible, left column) ─────────────
  const hullToggle = el('details', { class: 'rb-collapsible' });
  hullToggle.appendChild(el('summary', { class: 'rb-collapsible-title' }, 'Hüllflächengruppen'));
  renderHullGroupEditor(hullToggle, project, editor, result);
  leftCol.appendChild(hullToggle);

  // ── 4. Temperature chart (right column) ────────────────────────
  const chartLabel = el('div', { class: 'rb-chart-label' }, 'ΦHL(θe)');
  rightCol.appendChild(chartLabel);
  rightCol.appendChild(renderTempChart(result, project));

  container.appendChild(cols);
}

// ---- Category-grouped element breakdown (Task 2) ----

type BreakdownEntry = HeizlastResult['rooms'][0]['result']['elementBreakdown'][0];

function renderCategoryBreakdown(container: HTMLElement, breakdown: BreakdownEntry[]): void {
  // Group by (boundaryCategory, elementType bucket)
  type GroupKey = string;
  const groups = new Map<GroupKey, { label: string; catLabel: string; area: number; heatLoss: number }>();

  for (const e of breakdown) {
    const typeBucket =
      e.elementType === 'wall' ? 'Wände' :
      e.elementType === 'floor' ? 'Boden' :
      e.elementType === 'ceiling' ? 'Decke' :
      'Öffnungen'; // window | door | garage_door

    const catLabel = getBoundaryCategoryLabel(e.boundaryCategory);
    const key = `${e.boundaryCategory}::${typeBucket}`;
    const existing = groups.get(key);
    if (existing) {
      existing.area     += e.area;
      existing.heatLoss += e.heatLoss;
    } else {
      groups.set(key, { label: typeBucket, catLabel, area: e.area, heatLoss: e.heatLoss });
    }
  }

  const totalLoss = breakdown.reduce((s, e) => s + e.heatLoss, 0);

  const t = el('table', { class: 'rb-breakdown-table' });
  t.innerHTML = `<thead><tr><th>Element</th><th>Kat.</th><th>A (m²)</th><th>ΦT (W)</th></tr></thead>`;
  const tb = el('tbody', {});

  for (const [, g] of groups) {
    if (Math.abs(g.heatLoss) < 0.5) continue;
    const tr = el('tr', {});
    tr.innerHTML = `
      <td>${g.label}</td>
      <td><small>${g.catLabel}</small></td>
      <td class="rb-num">${g.area.toFixed(1)}</td>
      <td class="rb-num">${Math.round(g.heatLoss)}</td>
    `;
    tb.appendChild(tr);
  }

  // Transmission total row
  const ttTr = el('tr', { class: 'rb-breakdown-total' });
  ttTr.innerHTML = `<td colspan="3">ΦT Transmission</td><td class="rb-num"><strong>${Math.round(totalLoss)}</strong></td>`;
  tb.appendChild(ttTr);

  t.appendChild(tb);
  container.appendChild(t);
}

// ---- Heat load vs. outside temperature chart ----

const CHART_CYAN   = '#06b6d4';  // matches var(--cyan) / #rb-total
const CHART_ORANGE = '#f97316';  // matches var(--orange)

function renderTempChart(result: HeizlastResult, _project: Project): SVGSVGElement {
  const tDesign     = result.designTemperature;
  const tRef        = 20;
  const tMax        = 17;
  const groundLoad  = result.lossByCategory.ground;
  const variableLoad = result.designHeatLoad - groundLoad;

  const pts: { te: number; kw: number }[] = [];
  for (let te = Math.min(tDesign, -20); te <= tMax; te++) {
    const factor = Math.max(0, (tRef - te) / (tRef - tDesign));
    pts.push({ te, kw: Math.max(0, (groundLoad + variableLoad * factor) / 1000) });
  }
  const ns = 'http://www.w3.org/2000/svg';
  if (!pts.length) return document.createElementNS(ns, 'svg');

  const maxKw = Math.max(...pts.map(p => p.kw));
  const W = 300, H = 188, PL = 36, PR = 8, PT = 18, PB = 20;  // W/H ≈ 1.6
  const cw = W - PL - PR, ch = H - PT - PB;

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'rb-temp-chart');

  const px = (te: number) => PL + (te - pts[0].te) / (pts[pts.length - 1].te - pts[0].te) * cw;
  const py = (kw: number) => PT + ch - (kw / maxKw) * ch;

  const svgEl = (tag: string, attrs: Record<string, string>) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const svgTxt = (x: number, y: number, anchor: string, txt: string, fill = '#475569') => {
    const e = document.createElementNS(ns, 'text');
    e.setAttribute('x', String(x)); e.setAttribute('y', String(y));
    e.setAttribute('text-anchor', anchor); e.setAttribute('class', 'chart-axis-label');
    e.setAttribute('fill', fill); e.textContent = txt;
    return e;
  };

  // Vertical grid lines every 5°C
  for (let te = Math.ceil(pts[0].te / 5) * 5; te <= tMax; te += 5) {
    const x = px(te);
    svg.appendChild(svgEl('line', { x1: String(x), y1: String(PT), x2: String(x), y2: String(PT + ch), stroke: '#1e2840', 'stroke-width': '0.8' }));
    svg.appendChild(svgTxt(x, H - 3, 'middle', `${te}°`));
  }

  // y-axis: max kW label at top
  svg.appendChild(svgTxt(PL - 3, PT + 4, 'end', `${maxKw.toFixed(1)}`));
  svg.appendChild(svgTxt(PL - 3, PT + 12, 'end', 'kW'));

  // x-axis baseline
  svg.appendChild(svgEl('line', { x1: String(PL), y1: String(PT + ch), x2: String(W - PR), y2: String(PT + ch), stroke: '#334155', 'stroke-width': '0.8' }));

  // Design temperature: vertical dashed line in orange
  const dpX = px(tDesign);
  svg.appendChild(svgEl('line', {
    x1: String(dpX), y1: String(PT), x2: String(dpX), y2: String(PT + ch),
    stroke: CHART_ORANGE, 'stroke-width': '1', 'stroke-dasharray': '3 2',
  }));
  // Design temp label (above top, centred on line)
  svg.appendChild(svgTxt(dpX, PT - 3, 'middle', `${tDesign}°`, CHART_ORANGE));

  // Fill under curve — subtle cyan tint
  const dArea = [`M ${px(pts[0].te)} ${PT + ch}`];
  for (const p of pts) dArea.push(`L ${px(p.te)} ${py(p.kw)}`);
  dArea.push(`L ${px(pts[pts.length - 1].te)} ${PT + ch} Z`);
  svg.appendChild(svgEl('path', { d: dArea.join(' '), fill: 'rgba(6,182,212,0.07)' }));

  // Curve in cyan
  const dLine = [`M ${px(pts[0].te)} ${py(pts[0].kw)}`];
  for (const p of pts.slice(1)) dLine.push(`L ${px(p.te)} ${py(p.kw)}`);
  svg.appendChild(svgEl('path', { d: dLine.join(' '), fill: 'none', stroke: CHART_CYAN, 'stroke-width': '1.5', 'stroke-linejoin': 'round' }));

  return svg;
}

// ---- Hull group editor ----

function renderHullGroupEditor(
  container: HTMLElement,
  project: Project,
  editor: Editor,
  result: HeizlastResult,
): void {
  const hullTable = el('table', { class: 'rb-table rb-hull-table' });
  hullTable.innerHTML = `<thead><tr><th>Hüllgruppe</th><th>ΦT (W)</th><th>Anteil</th></tr></thead>`;
  const tb = el('tbody', {});
  for (const he of result.hullSummary) {
    const tr = el('tr', {});
    tr.innerHTML = `
      <td>${he.hullName}</td>
      <td class="rb-num">${Math.round(he.totalTransmissionLoss)}</td>
      <td class="rb-num">${(he.shareOfBuildingTotal * 100).toFixed(0)}%</td>
    `;
    tb.appendChild(tr);
  }
  hullTable.appendChild(tb);
  container.appendChild(hullTable);

  for (const hull of project.hullGroups) {
    const box = el('div', { class: 'hull-box' });
    const nameInput = el('input', { type: 'text', value: hull.name, class: 'input' }) as HTMLInputElement;
    nameInput.addEventListener('change', () => {
      const updated = project.hullGroups.map(hg =>
        hg.id === hull.id ? { ...hg, name: nameInput.value } : hg);
      editor.updateProject({ hullGroups: updated });
    });
    box.appendChild(nameInput);

    const catRow = el('div', { class: 'cat-row' });
    for (const cat of BOUNDARY_CATS) {
      const cb = el('input', { type: 'checkbox', id: `hull_${hull.id}_${cat}` }) as HTMLInputElement;
      cb.checked = hull.categories.includes(cat);
      cb.addEventListener('change', () => {
        const cats = BOUNDARY_CATS.filter(c => {
          const inp = box.querySelector(`#hull_${hull.id}_${c}`) as HTMLInputElement;
          return inp?.checked;
        });
        const updated = project.hullGroups.map(hg =>
          hg.id === hull.id ? { ...hg, categories: cats } : hg);
        editor.updateProject({ hullGroups: updated });
      });
      const lbl = el('label', { for: `hull_${hull.id}_${cat}` }, getBoundaryCategoryLabel(cat));
      const wrap = el('span', { class: 'cat-check' });
      wrap.appendChild(cb); wrap.appendChild(lbl);
      catRow.appendChild(wrap);
    }
    box.appendChild(catRow);

    if (!hull.isDefault) {
      const delBtn = el('button', { class: 'btn btn-danger btn-xs' }, 'Löschen');
      delBtn.addEventListener('click', () => {
        editor.updateProject({ hullGroups: project.hullGroups.filter(hg => hg.id !== hull.id) });
      });
      box.appendChild(delBtn);
    }
    container.appendChild(box);
  }

  const addBtn = el('button', { class: 'btn btn-secondary btn-sm' }, '+ Neue Hüllgruppe');
  addBtn.addEventListener('click', () => {
    const newHull: HullGroup = {
      id: uuidv4(), name: 'Neue Hüllgruppe', categories: ['exterior'], isDefault: false,
    };
    editor.updateProject({ hullGroups: [...project.hullGroups, newHull] });
  });
  container.appendChild(addBtn);
}

// ---- Sankey chart — heat load distribution ----
//
// Left nodes = loss categories (exterior, ground, adj_neighbor, ventilation).
// Right nodes = rooms.
// Ribbon width = category-portion flowing into each room.
// The total flow on both sides equals designHeatLoad, so the Sankey is balanced.
// Internal adj losses (adj_heated / adj_reduced) are excluded — they cancel within
// the building and are not part of designHeatLoad.

export function renderSankey(container: HTMLElement, result: HeizlastResult, project: Project): void {
  container.innerHTML = '';
  const total = result.designHeatLoad;
  if (total <= 0) return;

  const roomMap = new Map(project.floors.flatMap(f => f.rooms).map(r => [r.id, r]));

  // ── Category definitions ──────────────────────────────────────────────────
  interface CatDef { key: string; label: string; color: string; total: number }
  const allCats: CatDef[] = [
    { key: 'exterior', label: 'Außenluft / Unbeheizt', color: '#ef4444', total: result.lossByCategory.exterior },
    { key: 'ground',   label: 'Erdreich',              color: '#f97316', total: result.lossByCategory.ground },
    { key: 'neighbor', label: 'Nachbargebäude',        color: '#a855f7', total: result.lossByCategory.adjNeighbor },
    { key: 'vent',     label: 'Lüftung',               color: '#06b6d4', total: result.lossByCategory.ventilation },
  ];
  const cats = allCats.filter(c => c.total > 0);

  // ── Per-room category flows ───────────────────────────────────────────────
  const getRoomFlow = (rr: HeizlastResult['rooms'][0], key: string): number => {
    const eb = rr.result.elementBreakdown;
    if (key === 'exterior')  return eb.filter(e => e.boundaryCategory === 'exterior' || e.boundaryCategory === 'unheated').reduce((s, e) => s + e.heatLoss, 0);
    if (key === 'ground')    return eb.filter(e => e.boundaryCategory === 'ground').reduce((s, e) => s + e.heatLoss, 0);
    if (key === 'neighbor')  return eb.filter(e => e.boundaryCategory === 'adj_neighbor').reduce((s, e) => s + e.heatLoss, 0);
    return rr.result.ventilationLoss;
  };

  const rooms = result.rooms
    .map(rr => ({
      id:    rr.roomId,
      label: roomMap.get(rr.roomId)?.label ?? rr.roomId,
      flows: Object.fromEntries(cats.map(c => [c.key, getRoomFlow(rr, c.key)])),
      total: cats.reduce((s, c) => s + getRoomFlow(rr, c.key), 0),
    }))
    .filter(r => r.total > 0);

  if (!rooms.length || !cats.length) return;

  // ── SVG layout constants ──────────────────────────────────────────────────
  // viewBox sized for full-view rendering; SVG scales to fill container via CSS.
  const W = 800, H = 500;
  const YTOP = 60, YBOT = H - 60;
  const AVAIL = YBOT - YTOP;
  const GAP = 8;
  const LX = 200, LW = 18;   // left node
  const RX = 582, RW = 18;   // right node
  const MX = (LX + LW + RX) / 2;

  const leftTotalBar  = AVAIL - (cats.length  - 1) * GAP;
  const rightTotalBar = AVAIL - (rooms.length - 1) * GAP;
  const pxPerW = Math.min(leftTotalBar / total, rightTotalBar / total);
  const nodeH  = (flow: number) => Math.max(3, flow * pxPerW);

  interface NodePos { y: number; h: number }
  let ly = YTOP;
  const catPos: NodePos[]  = cats.map(c  => { const h = nodeH(c.total);  const p = { y: ly, h }; ly += h + GAP; return p; });
  let ry = YTOP;
  const roomPos: NodePos[] = rooms.map(r => { const h = nodeH(r.total);  const p = { y: ry, h }; ry += h + GAP; return p; });

  // ── SVG builder ───────────────────────────────────────────────────────────
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'sk-svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const s = (tag: string, attrs: Record<string, string>) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const txt = (x: number, y: number, anchor: string, content: string, cls: string) => {
    const e = document.createElementNS(ns, 'text');
    e.setAttribute('x', String(x)); e.setAttribute('y', String(y));
    e.setAttribute('text-anchor', anchor); e.setAttribute('class', cls);
    e.setAttribute('dominant-baseline', 'middle');
    e.textContent = content;
    return e;
  };

  // ── Ribbons ───────────────────────────────────────────────────────────────
  const catOff  = catPos.map(() => 0);
  const roomOff = roomPos.map(() => 0);

  for (let ci = 0; ci < cats.length; ci++) {
    for (let ri = 0; ri < rooms.length; ri++) {
      const flow = rooms[ri].flows[cats[ci].key] ?? 0;
      if (flow < 0.5) continue;
      const fh = Math.max(1, flow * pxPerW);

      const y0t = catPos[ci].y  + catOff[ci];
      const y1t = roomPos[ri].y + roomOff[ri];

      catOff[ci]  += fh;
      roomOff[ri] += fh;

      const d = [
        `M ${LX + LW} ${y0t}`,
        `C ${MX} ${y0t} ${MX} ${y1t} ${RX} ${y1t}`,
        `L ${RX} ${y1t + fh}`,
        `C ${MX} ${y1t + fh} ${MX} ${y0t + fh} ${LX + LW} ${y0t + fh} Z`,
      ].join(' ');
      svg.appendChild(s('path', { d, fill: cats[ci].color, opacity: '0.25' }));
    }
  }

  // ── Left nodes + labels ───────────────────────────────────────────────────
  for (let ci = 0; ci < cats.length; ci++) {
    const { y, h } = catPos[ci];
    svg.appendChild(s('rect', { x: String(LX), y: String(y), width: String(LW), height: String(h), fill: cats[ci].color, rx: '2' }));
    const mid = y + h / 2;
    svg.appendChild(txt(LX - 10, mid - 6,  'end', cats[ci].label,                    'sk-label'));
    svg.appendChild(txt(LX - 10, mid + 8,  'end', `${Math.round(cats[ci].total)} W`, 'sk-value'));
    svg.appendChild(txt(LX - 10, mid + 20, 'end', `${(cats[ci].total / total * 100).toFixed(0)} %`, 'sk-pct'));
  }

  // ── Right nodes + labels — single row, mixed styles via tspan ───────────
  for (let ri = 0; ri < rooms.length; ri++) {
    const { y, h } = roomPos[ri];
    svg.appendChild(s('rect', { x: String(RX), y: String(y), width: String(RW), height: String(h), fill: '#3b82f6', rx: '2' }));
    const mid = y + h / 2;
    const pct = (rooms[ri].total / total * 100).toFixed(0);

    const textEl = document.createElementNS(ns, 'text');
    textEl.setAttribute('x', String(RX + RW + 10));
    textEl.setAttribute('y', String(mid));
    textEl.setAttribute('text-anchor', 'start');
    textEl.setAttribute('dominant-baseline', 'middle');

    const span = (text: string, style: string) => {
      const t = document.createElementNS(ns, 'tspan');
      t.setAttribute('style', style);
      t.textContent = text;
      return t;
    };
    const sep = () => span('  ·  ', 'font-size:9px;fill:#475569;font-family:"Courier New",monospace');

    textEl.appendChild(span(rooms[ri].label,
      'font-size:11px;fill:#94a3b8;font-family:"Inter",system-ui,sans-serif'));
    textEl.appendChild(sep());
    textEl.appendChild(span(`${Math.round(rooms[ri].total)} W`,
      'font-size:10px;fill:#cbd5e1;font-family:"Courier New",monospace;font-weight:600'));
    textEl.appendChild(sep());
    textEl.appendChild(span(`${pct} %`,
      'font-size:9px;fill:#475569;font-family:"Courier New",monospace'));

    svg.appendChild(textEl);
  }

  // ── Title + subtitle ──────────────────────────────────────────────────────
  svg.appendChild(txt(W / 2, 22, 'middle', 'Heizlastverteilung', 'sk-title'));
  svg.appendChild(txt(W / 2, 38, 'middle',
    `Gesamtheizlast ΦHL = ${(total / 1000).toFixed(2)} kW  ·  Normaussentemperatur θe = ${result.designTemperature} °C`,
    'sk-subtitle'));

  container.appendChild(svg);
}

// Kept for backwards compat — no longer called but exported in case external code references it
export function renderResultsPanel(
  container: HTMLElement,
  result: HeizlastResult,
  project: Project,
  editor: Editor,
): void {
  renderDetailPanel(container, result, project, editor);
}
