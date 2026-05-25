import type { Room, WallSegment, Opening, BoundaryCategory } from '../model/types.js';
import type { Editor } from '../editor/editorState.js';
import { getBoundaryCategoryLabel, getBoundaryCategoryColor } from '../editor/adjacency.js';
import { WALL_PRESETS, WINDOW_PRESETS, DOOR_PRESETS, GARAGE_PRESETS } from '../library/presets.js';
import type { WallTypePreset, OpeningTypePreset } from '../library/presets.js';
import { loadCustomPresets } from '../library/customPresets.js';

const BOUNDARY_CATS: BoundaryCategory[] = ['exterior', 'adj_heated', 'adj_reduced', 'ground', 'unheated', 'adj_neighbor'];

// ---- Preset data for quick-size buttons ----
const WINDOW_SIZE_PRESETS = [
  { label: '60×60',   w: 600,  h: 600  },
  { label: '80×120',  w: 800,  h: 1200 },
  { label: '100×120', w: 1000, h: 1200 },
  { label: '120×140', w: 1200, h: 1400 },
  { label: '150×140', w: 1500, h: 1400 },
  { label: '200×140', w: 2000, h: 1400 },
];
const DOOR_SIZE_PRESETS = [
  { label: '75×200',   w: 750,  h: 2000 },
  { label: '87.5×200', w: 875,  h: 2000 },
  { label: '100×200',  w: 1000, h: 2000 },
  { label: '125×210',  w: 1250, h: 2100 },
];
const GARAGE_SIZE_PRESETS = [
  { label: '240×200', w: 2400, h: 2000 },
  { label: '250×225', w: 2500, h: 2250 },
  { label: '300×225', w: 3000, h: 2250 },
  { label: '500×225', w: 5000, h: 2250 },
];

// ---- Tiny DOM helpers ----

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {},
  ...children: (HTMLElement | Text | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function field(labelText: string, input: HTMLElement): HTMLDivElement {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(el('label', {}, labelText));
  wrap.appendChild(input);
  return wrap;
}

function numInput(value: number, min: number, max: number): HTMLInputElement {
  const inp = el('input', { type: 'number', class: 'input', min: String(min), max: String(max), value: String(value) }) as HTMLInputElement;
  return inp;
}

function section(title: string): HTMLDivElement {
  const s = el('div', { class: 'panel-section' });
  s.appendChild(el('div', { class: 'panel-section-title' }, title));
  return s;
}

// ---- Main render entry ----

export function renderPropertyPanel(container: HTMLElement, editor: Editor): void {
  container.innerHTML = '';
  const state = editor.getState();
  const floor = (editor.getProject() as import('../model/types.js').Project).floors[0];

  if (state.selectedOpeningId) {
    const op = floor.openings.find(o => o.id === state.selectedOpeningId);
    if (op) { renderOpeningPanel(container, op, editor); return; }
  }
  if (state.selectedWallId) {
    const wall = floor.walls.find(w => w.id === state.selectedWallId);
    if (wall) { renderWallPanel(container, wall, editor, floor); return; }
  }
  if (state.selectedRoomId) {
    const room = floor.rooms.find(r => r.id === state.selectedRoomId);
    if (room) { renderRoomPanel(container, room, editor); return; }
  }

  // Nothing selected — show hint
  const hint = el('div', { class: 'panel-hint' });
  hint.innerHTML = `
    <div class="hint-icon">↖</div>
    <div>Element auswählen oder Werkzeug wählen</div>
    <div class="hint-sub">Q = Auswahl · W = Wand · F = Fenster · T = Tür · G = Tor</div>
  `;
  container.appendChild(hint);
}

// ---- Room panel ----

function renderRoomPanel(container: HTMLElement, room: Room, editor: Editor): void {
  const sec = section('Raum');
  container.appendChild(sec);

  const labelInp = el('input', { type: 'text', class: 'input', value: room.label }) as HTMLInputElement;
  labelInp.addEventListener('change', () => editor.updateRoom(room.id, { label: labelInp.value }));
  sec.appendChild(field('Bezeichnung', labelInp));

  const tempInp = numInput(room.designTemperature, -20, 30);
  tempInp.addEventListener('change', () => editor.updateRoom(room.id, { designTemperature: Number(tempInp.value) }));
  sec.appendChild(field('Raumtemperatur θint (°C)', tempInp));

  const heightInp = numInput(room.ceilingHeight, 1000, 6000);
  heightInp.addEventListener('change', () => editor.updateRoom(room.id, { ceilingHeight: Number(heightInp.value) }));
  sec.appendChild(field('Raumhöhe (mm)', heightInp));

  const floorSel = el('select', { class: 'input' }) as HTMLSelectElement;
  ([['ground', 'Erdreichplatte'], ['above_room', 'Über Raum'], ['exterior', 'Außenluft']]).forEach(([v, l]) => {
    const opt = el('option', { value: v }, l) as HTMLOptionElement;
    if (v === room.floorType) opt.selected = true;
    floorSel.appendChild(opt);
  });
  floorSel.addEventListener('change', () => editor.updateRoom(room.id, { floorType: floorSel.value as Room['floorType'] }));
  sec.appendChild(field('Bodentyp', floorSel));

  const airInp = numInput(room.minAirChanges ?? 0.5, 0, 5);
  airInp.step = '0.1';
  airInp.addEventListener('change', () => editor.updateRoom(room.id, { minAirChanges: Number(airInp.value) }));
  sec.appendChild(field('Mindestluftwechsel n (h⁻¹)', airInp));

  if (room.area) {
    const info = el('div', { class: 'panel-info' }, `Fläche: ${room.area.toFixed(2)} m²  ·  Volumen: ${(room.area * room.ceilingHeight / 1000).toFixed(1)} m³`);
    sec.appendChild(info);
  }
}

// ---- Wall panel ----

function renderWallPanel(container: HTMLElement, wall: WallSegment, editor: Editor, floor: import('../model/types.js').Floor): void {
  // Adjacency banner
  const banner = el('div', { class: 'adj-banner', style: `border-color: ${getBoundaryCategoryColor(wall.boundaryCategory)}` });
  banner.innerHTML = `
    <span class="adj-dot" style="background:${getBoundaryCategoryColor(wall.boundaryCategory)}"></span>
    <strong>${getBoundaryCategoryLabel(wall.boundaryCategory)}</strong>
    ${wall.adjacentRoomId ? `<span class="adj-sub">→ ${floor.rooms.find(r => r.id === wall.adjacentRoomId)?.label ?? '?'}</span>` : ''}
  `;
  container.appendChild(banner);

  const sec = section('Wand');
  container.appendChild(sec);

  // Wall type preset dropdown
  const custom = loadCustomPresets();
  const allWallPresets: WallTypePreset[] = [...WALL_PRESETS, ...custom.walls];
  const presetSel = el('select', { class: 'input' }) as HTMLSelectElement;
  const blankOpt = el('option', { value: '' }, '— Benutzerdefiniert —') as HTMLOptionElement;
  if (!allWallPresets.find(p => p.id === wall.typePresetId)) blankOpt.selected = true;
  presetSel.appendChild(blankOpt);
  for (const p of allWallPresets) {
    const opt = el('option', { value: p.id }, `${p.name} (U ${p.uValue.toFixed(2)}, ${p.thickness} mm)`) as HTMLOptionElement;
    if (p.id === wall.typePresetId) opt.selected = true;
    presetSel.appendChild(opt);
  }
  presetSel.addEventListener('change', () => {
    const p = allWallPresets.find(pr => pr.id === presetSel.value);
    if (!p) return;
    editor.updateWall(wall.id, { typePresetId: p.id, uValue: p.uValue, thickness: p.thickness, boundaryCategory: p.defaultCategory });
  });
  sec.appendChild(field('Wandtyp', presetSel));

  // Boundary category
  const catSel = el('select', { class: 'input' }) as HTMLSelectElement;
  for (const cat of BOUNDARY_CATS) {
    const opt = el('option', { value: cat }, getBoundaryCategoryLabel(cat)) as HTMLOptionElement;
    if (cat === wall.boundaryCategory) opt.selected = true;
    catSel.appendChild(opt);
  }
  catSel.addEventListener('change', () =>
    editor.updateWall(wall.id, { boundaryCategory: catSel.value as BoundaryCategory })
  );
  sec.appendChild(field('Grenzkategorie', catSel));

  // U-value
  const uInp = el('input', { type: 'number', class: 'input', min: '0.05', max: '5', step: '0.01', value: String(wall.uValue) }) as HTMLInputElement;
  uInp.addEventListener('change', () => editor.updateWall(wall.id, { uValue: Number(uInp.value) }));
  sec.appendChild(field('U-Wert Wand (W/m²K)', uInp));

  // Thickness
  const thickInp = numInput(wall.thickness, 50, 1000);
  thickInp.addEventListener('change', () => editor.updateWall(wall.id, { thickness: Number(thickInp.value) }));
  sec.appendChild(field('Wanddicke (mm)', thickInp));

  // Unheated space temp / neighbor building temp
  if (wall.boundaryCategory === 'unheated') {
    const utInp = numInput(wall.unheatedSpaceTemp ?? 4, -20, 30);
    utInp.addEventListener('change', () => editor.updateWall(wall.id, { unheatedSpaceTemp: Number(utInp.value) }));
    sec.appendChild(field('Temp. unbeheizter Raum (°C)', utInp));
  } else if (wall.boundaryCategory === 'adj_neighbor') {
    const ntInp = numInput(wall.unheatedSpaceTemp ?? 15, -20, 30);
    ntInp.addEventListener('change', () => editor.updateWall(wall.id, { unheatedSpaceTemp: Number(ntInp.value) }));
    sec.appendChild(field('Temp. Nachbargebäude (°C)', ntInp));
  }

  // Fixed vertex checkboxes
  const verSec = section('Endpunkte sperren');
  container.appendChild(verSec);
  const startRow = el('div', { class: 'constraint-row' });
  const startCb  = el('input', { type: 'checkbox' }) as HTMLInputElement;
  startCb.checked = !!wall.startFixed;
  startCb.addEventListener('change', () => editor.updateWall(wall.id, { startFixed: startCb.checked }));
  startRow.appendChild(startCb);
  startRow.appendChild(el('label', {}, 'Startpunkt fixiert'));
  verSec.appendChild(startRow);

  const endRow = el('div', { class: 'constraint-row' });
  const endCb  = el('input', { type: 'checkbox' }) as HTMLInputElement;
  endCb.checked = !!wall.endFixed;
  endCb.addEventListener('change', () => editor.updateWall(wall.id, { endFixed: endCb.checked }));
  endRow.appendChild(endCb);
  endRow.appendChild(el('label', {}, 'Endpunkt fixiert'));
  verSec.appendChild(endRow);

  // Wall length display
  const { dist: _d } = { dist: Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) };
  const lenM = (_d / 1000).toFixed(3);
  container.appendChild(el('div', { class: 'panel-info' }, `Länge: ${lenM} m  ·  Fläche: ${(Number(lenM) * wall.thickness / 1000).toFixed(2)} m²`));

  // Delete button
  const delBtn = el('button', { class: 'btn btn-danger btn-sm', style: 'margin-top:8px' }, 'Wand löschen');
  delBtn.addEventListener('click', () => editor.deleteSelectedWall());
  container.appendChild(delBtn);
}

// ---- Opening panel ----

function renderOpeningPanel(container: HTMLElement, op: Opening, editor: Editor): void {
  const typeLabel = op.type === 'window' ? 'Fenster' : op.type === 'door' ? 'Tür' : 'Garagentor';
  const sec = section(typeLabel);
  container.appendChild(sec);

  // Opening type preset dropdown
  const customPresets = loadCustomPresets();
  const builtinPresets = op.type === 'window' ? WINDOW_PRESETS : op.type === 'door' ? DOOR_PRESETS : GARAGE_PRESETS;
  const customOfType = op.type === 'window' ? customPresets.windows : op.type === 'door' ? customPresets.doors : customPresets.garageDoors;
  const allOpeningPresets: OpeningTypePreset[] = [...builtinPresets, ...customOfType];
  const opPresetSel = el('select', { class: 'input' }) as HTMLSelectElement;
  const opBlankOpt = el('option', { value: '' }, '— Benutzerdefiniert —') as HTMLOptionElement;
  if (!allOpeningPresets.find(p => p.id === op.typePresetId)) opBlankOpt.selected = true;
  opPresetSel.appendChild(opBlankOpt);
  for (const p of allOpeningPresets) {
    const opt = el('option', { value: p.id }, `${p.name} (U ${p.uValue.toFixed(1)}, ${p.width / 10}×${p.height / 10} cm)`) as HTMLOptionElement;
    if (p.id === op.typePresetId) opt.selected = true;
    opPresetSel.appendChild(opt);
  }
  opPresetSel.addEventListener('change', () => {
    const p = allOpeningPresets.find(pr => pr.id === opPresetSel.value);
    if (!p) return;
    editor.updateOpening(op.id, { typePresetId: p.id, uValue: p.uValue, width: p.width, height: p.height });
  });
  sec.appendChild(field(typeLabel + 'typ', opPresetSel));

  const widthInp  = numInput(op.width, 100, 10000);
  const heightInp = numInput(op.height, 100, 5000);
  widthInp.addEventListener('change',  () => editor.updateOpening(op.id, { width:  Number(widthInp.value)  }));
  heightInp.addEventListener('change', () => editor.updateOpening(op.id, { height: Number(heightInp.value) }));
  sec.appendChild(field('Breite (mm)', widthInp));
  sec.appendChild(field('Höhe (mm)',   heightInp));

  // Quick-size presets
  const presets = op.type === 'window' ? WINDOW_SIZE_PRESETS : op.type === 'door' ? DOOR_SIZE_PRESETS : GARAGE_SIZE_PRESETS;
  const btnRow = el('div', { class: 'btn-row', style: 'flex-wrap:wrap; gap:3px; margin-top:4px' });
  for (const p of presets) {
    const b = el('button', { class: 'btn btn-xs btn-secondary', title: `${p.w} × ${p.h} mm` }, p.label);
    b.addEventListener('click', () => {
      widthInp.value  = String(p.w);
      heightInp.value = String(p.h);
      editor.updateOpening(op.id, { width: p.w, height: p.h });
    });
    btnRow.appendChild(b);
  }
  sec.appendChild(el('div', { class: 'field' }, 'Schnellauswahl', btnRow));

  const uInp = el('input', { type: 'number', class: 'input', min: '0.3', max: '5', step: '0.1', value: String(op.uValue) }) as HTMLInputElement;
  uInp.addEventListener('change', () => editor.updateOpening(op.id, { uValue: Number(uInp.value) }));
  sec.appendChild(field('U-Wert (W/m²K)', uInp));

  const areaM2 = (op.width * op.height / 1_000_000).toFixed(3);
  container.appendChild(el('div', { class: 'panel-info' }, `Fläche: ${areaM2} m²`));

  const delBtn = el('button', { class: 'btn btn-danger btn-sm', style: 'margin-top:8px' }, 'Öffnung löschen');
  delBtn.addEventListener('click', () => editor.deleteSelectedOpening());
  container.appendChild(delBtn);
}
