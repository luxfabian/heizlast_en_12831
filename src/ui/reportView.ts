import type { HeizlastResult, Project, Room, RoomHeizlastResult, BoundaryCategory } from '../model/types.js';
import { getBoundaryCategoryLabel } from '../editor/adjacency.js';
import type { Editor } from '../editor/editorState.js';
import { renderHullGroupEditor } from './resultsPanel.js';

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

const TYPE_DE: Record<string, string> = {
  wall: 'Wand', window: 'Fenster', door: 'Tür',
  garage_door: 'Tor', floor: 'Boden', ceiling: 'Decke',
};

const CAT_ORDER: Record<string, number> = {
  exterior: 0, unheated: 1, ground: 2, adj_heated: 3, adj_reduced: 4,
};

export function renderReport(
  container: HTMLElement,
  result: HeizlastResult,
  project: Project,
  editor: Editor,
): void {
  // Preserve selected room across re-renders (e.g. hull-group edits)
  const prevRoomId = (container.querySelector('.rp-dropdown-trigger') as HTMLElement | null)?.dataset.rpSelected ?? '';
  container.innerHTML = '';

  const roomMap = new Map(project.floors.flatMap(f => f.rooms).map(r => [r.id, r]));
  const wrap = el('div', { class: 'rp-wrap' });
  container.appendChild(wrap);

  // ── 1. Building-level summary ───────────────────────────────────
  const summarySection = el('div', { class: 'rp-section' });
  wrap.appendChild(summarySection);

  const kpis = el('div', { class: 'rp-kpis' });
  const phiHLkW = (result.designHeatLoad / 1000).toFixed(2);
  const phiHLText = result.sigmaW
    ? `${phiHLkW} ± ${(result.sigmaW / 1000).toFixed(2)} kW`
    : `${phiHLkW} kW`;
  const kpiItems: [string, string][] = [
    [phiHLText, 'Φ<sub>HL</sub> gesamt'],
    [`${result.designSpecificHeatLoad.toFixed(0)} W/m²`, 'Spezifisch'],
    [`${result.designTemperature} °C`, 'θ<sub>e</sub> Norm'],
  ];
  if (result.plz) kpiItems.push([result.plz, 'PLZ']);
  for (const [value, labelHtml] of kpiItems) {
    const kpi = el('div', { class: 'rp-kpi' });
    kpi.appendChild(el('div', { class: 'rp-kpi-value' }, value));
    const lbl = el('div', { class: 'rp-kpi-label' });
    lbl.innerHTML = labelHtml;
    kpi.appendChild(lbl);
    kpis.appendChild(kpi);
  }
  summarySection.appendChild(kpis);

  // Loss-by-category table
  summarySection.appendChild(el('div', { class: 'rp-section-title' }, 'Verluste nach Kategorie'));
  const catTable = el('table', { class: 'rp-table' });
  catTable.innerHTML = `<thead><tr>
    <th>Kategorie</th><th class="rp-num">Φ<sub>HL</sub> (W)</th><th class="rp-num">Anteil</th>
  </tr></thead>`;
  const catTbody = el('tbody', {});
  const catRows: [string, number][] = [
    ['Außenluft',       result.lossByCategory.exterior],
    ['Erdreich',        result.lossByCategory.ground],
    ['Nachbargebäude',  result.lossByCategory.adjNeighbor],
    ['Lüftungsverlust', result.lossByCategory.ventilation],
  ];
  for (const [label, w] of catRows) {
    const tr = el('tr', {});
    tr.innerHTML = `<td>${label}</td>
      <td class="rp-num">${Math.round(w)}</td>
      <td class="rp-num">${(w / result.designHeatLoad * 100).toFixed(0)} %</td>`;
    catTbody.appendChild(tr);
  }
  const totTr = el('tr', { class: 'rp-total-row' });
  totTr.innerHTML = `<td><strong>Gesamt</strong></td>
    <td class="rp-num"><strong>${Math.round(result.designHeatLoad)}</strong></td><td></td>`;
  catTbody.appendChild(totTr);
  catTable.appendChild(catTbody);
  summarySection.appendChild(catTable);

  // Hull-group editor (collapsible)
  const hullToggle = el('details', { class: 'rp-collapsible' });
  hullToggle.appendChild(el('summary', { class: 'rp-collapsible-title' }, 'Hüllflächengruppen'));
  renderHullGroupEditor(hullToggle, project, editor, result);
  summarySection.appendChild(hullToggle);

  // ── 1b. Gaussian distribution plot (only when uncertainty is set) ─
  if (result.sigmaW && result.sigmaW > 0) {
    const gaussSection = el('div', { class: 'rp-section' });
    const gaussTitle = el('div', { class: 'rp-section-title' });
    gaussTitle.innerHTML = 'Wahrscheinlichkeitsverteilung Φ<sub>HL</sub>';
    gaussSection.appendChild(gaussTitle);
    renderGaussPlot(gaussSection, result.designHeatLoad, result.sigmaW);
    wrap.appendChild(gaussSection);
  }

  // ── 2. Room selector (sticky) ────────────────────────────────────
  const selectorRow = el('div', { class: 'rp-selector-row' });
  selectorRow.appendChild(el('label', { class: 'rp-selector-label' }, 'Raum'));

  const dropdown = el('div', { class: 'rp-dropdown' });

  const trigger = el('button', { class: 'rp-dropdown-trigger', type: 'button' });
  trigger.dataset.rpSelected = '';
  const triggerContent = el('span', { class: 'rp-dd-trigger-content' });
  triggerContent.appendChild(el('span', { class: 'rp-dd-placeholder' }, '— Raum auswählen —'));
  trigger.appendChild(triggerContent);
  trigger.insertAdjacentHTML('beforeend',
    '<svg class="rp-dd-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 4 L6 8 L10 4"/></svg>');
  dropdown.appendChild(trigger);

  const ddList = el('div', { class: 'rp-dropdown-list' });
  const placeholderItem = el('div', { class: 'rp-dd-item rp-dd-item-placeholder' });
  placeholderItem.dataset.value = '';
  placeholderItem.textContent = '— Raum auswählen —';
  ddList.appendChild(placeholderItem);

  type RoomEntry = { roomId: string; name: string; loadW: number; tempLabel: string };
  const roomEntries: RoomEntry[] = [];
  for (const rr of result.rooms) {
    const room = roomMap.get(rr.roomId);
    if (!room) continue;
    const isUnheated = room.roomType === 'unheated';
    const tempLabel = isUnheated
      ? `≈${rr.result.effectiveTemperature.toFixed(1)} °C`
      : `${room.designTemperature} °C`;
    const loadW = Math.round(rr.result.totalLoss);
    roomEntries.push({ roomId: rr.roomId, name: room.label, loadW, tempLabel });

    const item = el('div', { class: 'rp-dd-item' });
    item.dataset.value = rr.roomId;
    const statsDiv = el('div', { class: 'rp-dd-stats' });
    const loadSpan = el('span', { class: loadW === 0 ? 'rp-dd-load rp-dd-load-zero' : 'rp-dd-load' }, `${loadW} W`);
    const tempSpan = el('span', { class: 'rp-dd-temp' }, tempLabel);
    statsDiv.appendChild(loadSpan);
    statsDiv.appendChild(tempSpan);
    item.appendChild(el('span', { class: 'rp-dd-name' }, room.label));
    item.appendChild(statsDiv);
    ddList.appendChild(item);
  }
  dropdown.appendChild(ddList);
  selectorRow.appendChild(dropdown);
  wrap.appendChild(selectorRow);

  // ── 3. Room detail ───────────────────────────────────────────────
  const detailDiv = el('div', { class: 'rp-room-detail' });
  wrap.appendChild(detailDiv);

  function setTriggerContent(roomId: string): void {
    trigger.dataset.rpSelected = roomId;
    ddList.querySelectorAll<HTMLElement>('.rp-dd-item').forEach(it =>
      it.classList.toggle('rp-dd-selected', it.dataset.value === roomId));
    triggerContent.innerHTML = '';
    if (!roomId) {
      triggerContent.appendChild(el('span', { class: 'rp-dd-placeholder' }, '— Raum auswählen —'));
      return;
    }
    const entry = roomEntries.find(e => e.roomId === roomId);
    if (!entry) return;
    const statsDiv = el('div', { class: 'rp-dd-stats' });
    statsDiv.appendChild(el('span', { class: 'rp-dd-load' }, `${entry.loadW} W`));
    statsDiv.appendChild(el('span', { class: 'rp-dd-temp' }, entry.tempLabel));
    triggerContent.appendChild(el('span', { class: 'rp-dd-name' }, entry.name));
    triggerContent.appendChild(statsDiv);
  }

  const showRoom = (roomId: string) => {
    setTriggerContent(roomId);
    detailDiv.innerHTML = '';
    if (!roomId) return;
    const rr = result.rooms.find(r => r.roomId === roomId);
    const room = roomMap.get(roomId);
    if (!rr || !room) return;
    renderRoomDetail(detailDiv, rr.result, room, roomMap);
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  ddList.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.rp-dd-item');
    if (!item) return;
    dropdown.classList.remove('open');
    showRoom(item.dataset.value ?? '');
  });

  function closeOnOutsideClick(e: MouseEvent): void {
    if (!dropdown.isConnected) { document.removeEventListener('click', closeOnOutsideClick); return; }
    if (!dropdown.contains(e.target as Node)) dropdown.classList.remove('open');
  }
  document.addEventListener('click', closeOnOutsideClick);

  if (prevRoomId && roomEntries.some(e => e.roomId === prevRoomId)) {
    showRoom(prevRoomId);
  }
}

function renderRoomDetail(
  container: HTMLElement,
  res: RoomHeizlastResult,
  room: Room,
  roomMap: Map<string, Room>,
): void {
  const area = room.area ?? 0;
  const spec = area > 0 ? res.totalLoss / area : 0;

  // ── Room header KPIs ─────────────────────────────────────────────
  const header = el('div', { class: 'rp-room-header' });
  header.appendChild(el('div', { class: 'rp-room-title' }, room.label));
  const kpis = el('div', { class: 'rp-room-kpis' });
  const isUnheated = room.roomType === 'unheated';
  const tempDisplay = isUnheated
    ? `≈${res.effectiveTemperature.toFixed(1)} °C`
    : `${room.designTemperature} °C`;

  const phiHLRoom = res.sigmaW
    ? `${Math.round(res.totalLoss)} ± ${Math.round(res.sigmaW)} W`
    : `${Math.round(res.totalLoss)} W`;
  const kpiData: [string, string][] = [
    [`${area.toFixed(1)} m²`,       'Fläche'],
    [tempDisplay,                    isUnheated ? 'θ<sub>eq</sub>' : 'θ<sub>i</sub>'],
    [`${res.volume.toFixed(1)} m³`,  'Volumen'],
    [phiHLRoom,                      'Φ<sub>HL</sub>'],
    [`${Math.round(res.transmissionLoss)} W`,   'Φ<sub>T</sub>'],
    [`${Math.round(res.ventilationLoss)} W`,    'Φ<sub>V</sub>'],
    [`${spec.toFixed(0)} W/m²`,     'Spezif.'],
    [`${res.nMin.toFixed(2)} h⁻¹`,  'n<sub>Min</sub>'],
  ];
  for (const [value, labelHtml] of kpiData) {
    const kpi = el('div', { class: 'rp-rkpi' });
    kpi.appendChild(el('span', { class: 'rp-rkpi-v' }, value));
    const lbl = el('span', { class: 'rp-rkpi-l' });
    lbl.innerHTML = labelHtml;
    kpi.appendChild(lbl);
    kpis.appendChild(kpi);
  }
  header.appendChild(kpis);
  container.appendChild(header);

  // ── Adjacent rooms ───────────────────────────────────────────────
  const adjEntries = res.elementBreakdown.filter(e => e.adjacentRoomId);
  if (adjEntries.length > 0) {
    const adjSection = el('div', { class: 'rp-section' });
    adjSection.appendChild(el('div', { class: 'rp-section-title' }, 'Erkannte Nachbarräume'));

    type AdjData = { cat: BoundaryCategory; loss: number; area: number };
    const adjMap = new Map<string, AdjData>();
    for (const e of adjEntries) {
      const id = e.adjacentRoomId!;
      const d = adjMap.get(id);
      if (d) { d.loss += e.heatLoss; d.area += e.area; }
      else adjMap.set(id, { cat: e.boundaryCategory as BoundaryCategory, loss: e.heatLoss, area: e.area });
    }

    const adjTable = el('table', { class: 'rp-table' });
    adjTable.innerHTML = `<thead><tr>
      <th>Raum</th><th class="rp-num">θ<sub>i</sub> (°C)</th>
      <th>Kategorie</th><th class="rp-num">A (m²)</th><th class="rp-num">Φ<sub>T</sub> (W)</th>
    </tr></thead>`;
    const adjTbody = el('tbody', {});
    for (const [adjId, d] of adjMap) {
      const adjRoom = roomMap.get(adjId);
      const tr = el('tr', {});
      tr.innerHTML = `
        <td>${adjRoom?.label ?? adjId}</td>
        <td class="rp-num">${adjRoom?.designTemperature ?? '—'}</td>
        <td><small>${getBoundaryCategoryLabel(d.cat)}</small></td>
        <td class="rp-num">${d.area.toFixed(1)}</td>
        <td class="rp-num">${Math.round(d.loss)}</td>
      `;
      adjTbody.appendChild(tr);
    }
    adjTable.appendChild(adjTbody);
    adjSection.appendChild(adjTable);
    container.appendChild(adjSection);
  }

  // ── Surface-by-surface breakdown ─────────────────────────────────
  const surfSection = el('div', { class: 'rp-section' });
  surfSection.appendChild(el('div', { class: 'rp-section-title' }, 'Thermische Flächenbilanz'));

  const surfTable = el('table', { class: 'rp-table rp-surf-table' });
  surfTable.innerHTML = `<thead><tr>
    <th>Element</th><th>Grenzraum</th>
    <th class="rp-num">A (m²)</th><th class="rp-num">U (W/m²K)</th>
    <th class="rp-num">f<sub>ij</sub></th><th class="rp-num">ΔT (K)</th><th class="rp-num">Φ<sub>T</sub> (W)</th>
  </tr></thead>`;
  const surfTbody = el('tbody', {});

  const sorted = [...res.elementBreakdown].sort(
    (a, b) => (CAT_ORDER[a.boundaryCategory] ?? 5) - (CAT_ORDER[b.boundaryCategory] ?? 5),
  );

  let lastCat = '';
  for (const e of sorted) {
    if (Math.abs(e.heatLoss) < 0.1) continue;
    if (e.boundaryCategory !== lastCat) {
      lastCat = e.boundaryCategory;
      const groupTr = el('tr', { class: 'rp-group-row' });
      groupTr.innerHTML = `<td colspan="7">${getBoundaryCategoryLabel(e.boundaryCategory as BoundaryCategory)}</td>`;
      surfTbody.appendChild(groupTr);
    }
    const adjRoom = e.adjacentRoomId ? roomMap.get(e.adjacentRoomId) : undefined;
    const tr = el('tr', {});
    tr.innerHTML = `
      <td>${TYPE_DE[e.elementType] ?? e.elementType}</td>
      <td class="rp-muted">${adjRoom ? adjRoom.label : '—'}</td>
      <td class="rp-num">${e.area.toFixed(2)}</td>
      <td class="rp-num">${e.uValue.toFixed(3)}</td>
      <td class="rp-num">${e.fij.toFixed(3)}</td>
      <td class="rp-num">${e.actualDeltaT.toFixed(1)}</td>
      <td class="rp-num">${Math.round(e.heatLoss)}</td>
    `;
    surfTbody.appendChild(tr);
  }

  const tTr = el('tr', { class: 'rp-total-row' });
  tTr.innerHTML = `<td colspan="6">Gesamte Transmission Φ<sub>T</sub></td>
    <td class="rp-num"><strong>${Math.round(res.transmissionLoss)}</strong></td>`;
  surfTbody.appendChild(tTr);
  surfTable.appendChild(surfTbody);
  surfSection.appendChild(surfTable);
  container.appendChild(surfSection);

  // ── Ventilation ──────────────────────────────────────────────────
  const ventSection = el('div', { class: 'rp-section' });
  ventSection.appendChild(el('div', { class: 'rp-section-title' }, 'Lüftungsverlust'));
  const ventTable = el('table', { class: 'rp-table' });
  const ventTbody = el('tbody', {});
  const ventRows: [string, string][] = [
    ['Raumvolumen V',                                `${res.volume.toFixed(1)} m³`],
    ['Mindestluftwechsel n<sub>Min</sub>',           `${res.nMin.toFixed(2)} h⁻¹`],
    ['Lüftungswärmeverlust Φ<sub>V</sub>',          `${Math.round(res.ventilationLoss)} W`],
  ];
  for (const [label, value] of ventRows) {
    const tr = el('tr', {});
    tr.innerHTML = `<td>${label}</td><td class="rp-num">${value}</td>`;
    ventTbody.appendChild(tr);
  }
  ventTable.appendChild(ventTbody);
  ventSection.appendChild(ventTable);
  container.appendChild(ventSection);
}

// ── Gaussian distribution plot ────────────────────────────────────────────────

function renderGaussPlot(container: HTMLElement, mu: number, sigma: number): void {
  const W = 620, H = 114;
  const ML = 10, MR = 10, MT = 22, MB = 42;
  const PW = W - ML - MR;
  const PH = H - MT - MB;
  const BASE = MT + PH;

  const RANGE = 6;
  const xMin = mu - RANGE * sigma;
  const xMax = mu + RANGE * sigma;

  const toSx = (x: number) => ML + (x - xMin) / (xMax - xMin) * PW;
  const PDF_K = 1 / (sigma * Math.sqrt(2 * Math.PI));
  const pdf   = (x: number) => PDF_K * Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
  const toSy  = (p: number) => MT + (1 - p / PDF_K) * PH;

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.cssText = 'width:100%;height:auto;display:block';

  function path(x1: number, x2: number, steps: number): string {
    const pts = [`M${toSx(x1).toFixed(1)},${BASE}`];
    for (let i = 0; i <= steps; i++) {
      const x = x1 + (i / steps) * (x2 - x1);
      pts.push(`L${toSx(x).toFixed(1)},${toSy(pdf(x)).toFixed(1)}`);
    }
    pts.push(`L${toSx(x2).toFixed(1)},${BASE} Z`);
    return pts.join(' ');
  }

  function curve(steps = 220): string {
    const pts: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = xMin + (i / steps) * (xMax - xMin);
      pts.push(`${i === 0 ? 'M' : 'L'}${toSx(x).toFixed(1)},${toSy(pdf(x)).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  function line(x1: number, y1: number, x2: number, y2: number,
    stroke: string, sw: number, dash = ''): SVGLineElement {
    const l = document.createElementNS(NS, 'line') as SVGLineElement;
    l.setAttribute('x1', x1.toFixed(1)); l.setAttribute('y1', y1.toFixed(1));
    l.setAttribute('x2', x2.toFixed(1)); l.setAttribute('y2', y2.toFixed(1));
    l.setAttribute('stroke', stroke);
    l.setAttribute('stroke-width', String(sw));
    if (dash) l.setAttribute('stroke-dasharray', dash);
    return l;
  }

  function text(x: number, y: number, content: string,
    anchor: string, size: number, fill: string): SVGTextElement {
    const t = document.createElementNS(NS, 'text') as SVGTextElement;
    t.setAttribute('x', x.toFixed(1)); t.setAttribute('y', y.toFixed(1));
    t.setAttribute('text-anchor', anchor);
    t.setAttribute('font-size', String(size));
    t.setAttribute('font-family', '"Courier New", monospace');
    t.setAttribute('fill', fill);
    t.textContent = content;
    return t;
  }

  // ±2σ band
  const p2 = document.createElementNS(NS, 'path');
  p2.setAttribute('d', path(mu - 2 * sigma, mu + 2 * sigma, 80));
  p2.setAttribute('fill', 'rgba(99,102,241,0.12)');
  svg.appendChild(p2);

  // ±1σ band
  const p1 = document.createElementNS(NS, 'path');
  p1.setAttribute('d', path(mu - sigma, mu + sigma, 60));
  p1.setAttribute('fill', 'rgba(99,102,241,0.28)');
  svg.appendChild(p1);

  // Bell curve
  const cv = document.createElementNS(NS, 'path');
  cv.setAttribute('d', curve());
  cv.setAttribute('fill', 'none');
  cv.setAttribute('stroke', 'rgba(147,197,253,0.85)');
  cv.setAttribute('stroke-width', '1.8');
  svg.appendChild(cv);

  // Mean dashed line
  const muX = toSx(mu);
  svg.appendChild(line(muX, MT, muX, BASE, 'rgba(255,255,255,0.30)', 1, '4,3'));

  // X-axis
  svg.appendChild(line(ML, BASE, W - MR, BASE, 'rgba(255,255,255,0.10)', 1));

  // Ticks + kW labels + σ labels at −2σ…+2σ
  const fmt = (w: number) => `${(w / 1000).toFixed(2)} kW`;
  for (const k of [-2, -1, 0, 1, 2]) {
    const xv = mu + k * sigma;
    const sx = toSx(xv);
    const isMu = k === 0;

    svg.appendChild(line(sx, BASE, sx, BASE + 4, 'rgba(255,255,255,0.18)', 1));
    svg.appendChild(text(sx, BASE + 14, fmt(xv), 'middle', 8,
      isMu ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.38)'));

    const sigLbl = isMu ? 'μ' : (k > 0 ? `+${k}σ` : `${k}σ`);
    svg.appendChild(text(sx, BASE + 26, sigLbl, 'middle', 7.5,
      isMu ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.22)'));
  }

  // Percentage annotations inside the bands
  svg.appendChild(text(muX, toSy(PDF_K * 0.50), '68.3 %', 'middle', 8,
    'rgba(255,255,255,0.45)'));
  svg.appendChild(text(toSx(mu + 1.55 * sigma), toSy(PDF_K * 0.14), '95.5 %', 'middle', 7,
    'rgba(255,255,255,0.28)'));

  container.appendChild(svg);
}
