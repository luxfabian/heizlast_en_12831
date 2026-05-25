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

  // Room strip — proportional coloured segments
  stripEl.innerHTML = '';
  const maxLoad = Math.max(...result.rooms.map(r => r.result.totalLoss), 1);
  const floor = project.floors[0];
  for (const rr of result.rooms) {
    const room = floor.rooms.find(r => r.id === rr.roomId);
    if (!room) continue;
    const share = rr.result.totalLoss / result.buildingTotal;
    const intensity = rr.result.totalLoss / maxLoad;
    const r = Math.round(30 + intensity * 180);
    const g = Math.round(80 - intensity * 50);
    const b = Math.round(180 - intensity * 150);
    const seg = document.createElement('div');
    seg.className = 'rb-room-seg';
    seg.style.flex = String(Math.max(share * 100, 0.5));
    seg.style.background = `rgb(${r},${g},${b})`;
    seg.title = `${room.label}: ${Math.round(rr.result.totalLoss)} W`;
    seg.textContent = share > 0.06 ? room.label : '';
    stripEl.appendChild(seg);
  }

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
  const floor   = project.floors[0];
  const roomMap = new Map(floor.rooms.map(r => [r.id, r]));

  // ── 1. Loss breakdown by category ──────────────────────────────
  const catSection = el('div', { class: 'rb-section' });
  catSection.appendChild(el('div', { class: 'rb-section-title' }, 'Verluste nach Kategorie'));

  const catTable = el('table', { class: 'rb-table' });
  const { exterior, ground, adjNeighbor, ventilation } = result.lossByCategory;
  const rows: [string, number][] = [
    ['Außenluft / Unbeheizt', exterior],
    ['Erdreich', ground],
    ['Nachbargebäude', adjNeighbor],
    ['Lüftung', ventilation],
  ];
  for (const [label, w] of rows) {
    if (w <= 0) continue;
    const tr = el('tr', {});
    tr.innerHTML = `<td>${label}</td><td class="rb-num">${Math.round(w)} W</td>
      <td class="rb-bar-cell"><div class="rb-bar" style="width:${(w / result.designHeatLoad * 100).toFixed(1)}%"></div></td>`;
    catTable.appendChild(tr);
  }
  // Separator + total row
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
  container.appendChild(catSection);

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

    // Expandable category-summed breakdown
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
  container.appendChild(roomSection);

  // ── 3. Hull group editor (collapsible) ─────────────────────────
  const hullToggle = el('details', { class: 'rb-collapsible' });
  hullToggle.appendChild(el('summary', { class: 'rb-collapsible-title' }, 'Hüllflächengruppen'));
  renderHullGroupEditor(hullToggle, project, editor, result);
  container.appendChild(hullToggle);
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

// Kept for backwards compat — no longer called but exported in case external code references it
export function renderResultsPanel(
  container: HTMLElement,
  result: HeizlastResult,
  project: Project,
  editor: Editor,
): void {
  renderDetailPanel(container, result, project, editor);
}
