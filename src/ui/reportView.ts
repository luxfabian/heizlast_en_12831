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
  const prevRoomId = (container.querySelector('#rp-room-select') as HTMLSelectElement | null)?.value ?? '';
  container.innerHTML = '';

  const roomMap = new Map(project.floors.flatMap(f => f.rooms).map(r => [r.id, r]));
  const wrap = el('div', { class: 'rp-wrap' });
  container.appendChild(wrap);

  // ── 1. Building-level summary ───────────────────────────────────
  const summarySection = el('div', { class: 'rp-section' });
  wrap.appendChild(summarySection);

  const kpis = el('div', { class: 'rp-kpis' });
  const kpiItems: [string, string][] = [
    [`${(result.designHeatLoad / 1000).toFixed(2)} kW`, 'Φ<sub>HL</sub> gesamt'],
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

  // ── 2. Room selector (sticky) ────────────────────────────────────
  const selectorRow = el('div', { class: 'rp-selector-row' });
  selectorRow.appendChild(el('label', { class: 'rp-selector-label', for: 'rp-room-select' }, 'Raum'));

  const select = el('select', { class: 'select rp-select', id: 'rp-room-select' });
  select.appendChild(el('option', { value: '' }, '— Raum auswählen —'));
  for (const rr of result.rooms) {
    const room = roomMap.get(rr.roomId);
    if (!room) continue;
    const opt = el('option', { value: rr.roomId });
    const isUnheated = room.roomType === 'unheated';
    const tempLabel = isUnheated
      ? `≈${rr.result.effectiveTemperature.toFixed(1)} °C`
      : `${room.designTemperature} °C`;
    opt.textContent = `${room.label}  (${Math.round(rr.result.totalLoss)} W, ${tempLabel})`;
    select.appendChild(opt);
  }
  selectorRow.appendChild(select);
  wrap.appendChild(selectorRow);

  // ── 3. Room detail ───────────────────────────────────────────────
  const detailDiv = el('div', { class: 'rp-room-detail' });
  wrap.appendChild(detailDiv);

  const showRoom = (roomId: string) => {
    detailDiv.innerHTML = '';
    if (!roomId) return;
    const rr = result.rooms.find(r => r.roomId === roomId);
    const room = roomMap.get(roomId);
    if (!rr || !room) return;
    renderRoomDetail(detailDiv, rr.result, room, roomMap);
  };

  select.addEventListener('change', () => showRoom(select.value));

  // Restore previous selection if still valid
  if (prevRoomId && [...select.options].some(o => o.value === prevRoomId)) {
    select.value = prevRoomId;
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

  const kpiData: [string, string][] = [
    [`${area.toFixed(1)} m²`,       'Fläche'],
    [tempDisplay,                    isUnheated ? 'θ<sub>eq</sub>' : 'θ<sub>i</sub>'],
    [`${res.volume.toFixed(1)} m³`,  'Volumen'],
    [`${Math.round(res.totalLoss)} W`,         'Φ<sub>HL</sub>'],
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
