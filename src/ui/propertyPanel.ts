import type { Room, WallSegment, Opening, BoundaryCategory, RoomCeiling, RoomFloor, Project } from '../model/types.js';
import type { Editor } from '../editor/editorState.js';
import { getBoundaryCategoryLabel, getBoundaryCategoryColor } from '../editor/adjacency.js';
import { getRoomPolygon, polygonIntersectionArea } from '../calc/heizlast.js';
import { WALL_PRESETS, WINDOW_PRESETS, DOOR_PRESETS, GARAGE_PRESETS, CEILING_PRESETS, FLOOR_PRESETS } from '../library/presets.js';
import type { WallTypePreset, OpeningTypePreset, CeilingTypePreset } from '../library/presets.js';
import { loadCustomPresets, addCustomWallPreset, addCustomOpeningPreset, addCustomFloorPreset } from '../library/customPresets.js';
import { v4 as uuidv4 } from '../utils/uuid.js';


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
  const state  = editor.getState();
  const _proj  = editor.getProject() as import('../model/types.js').Project;
  const floor  = _proj.floors[state.activeFloorIndex] ?? _proj.floors[0];
  const sortedFloors = [..._proj.floors].sort((a, b) => a.level - b.level);
  const floorIdx  = sortedFloors.findIndex(f => f.id === floor.id);
  const floorAbove = floorIdx >= 0 ? sortedFloors[floorIdx + 1] : undefined;
  const floorBelow = floorIdx > 0  ? sortedFloors[floorIdx - 1] : undefined;
  const hasAbove = !!floorAbove;
  const hasBelow = !!floorBelow;

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
    if (room) { renderRoomPanel(container, room, editor, hasAbove, hasBelow, floor, floorAbove, floorBelow); return; }
  }
  if (state.selectedLibraryItemId && state.selectedLibraryItemType) {
    renderLibraryItemPanel(container, state.selectedLibraryItemId, state.selectedLibraryItemType, editor);
    return;
  }
  if (state.selectedFloorId) {
    const selFloor = _proj.floors.find(f => f.id === state.selectedFloorId);
    if (selFloor) { renderFloorPropertiesPanel(container, selFloor, editor, _proj); return; }
  }

  // Nothing selected — show hint + project-level settings
  const hint = el('div', { class: 'panel-hint' });
  hint.innerHTML = `
    <div class="hint-icon">↖</div>
    <div>Element auswählen oder Werkzeug wählen</div>
    <div class="hint-sub">Q = Auswahl · W = Wand · F = Fenster · T = Tür · G = Tor</div>
  `;
  container.appendChild(hint);

  renderUncertaintySection(container, _proj, editor);
}

function renderUncertaintySection(container: HTMLElement, proj: Project, editor: Editor): void {
  const sec = section('Unsicherheitsanalyse');
  container.appendChild(sec);

  const note = el('div', { class: 'panel-info' });
  note.innerHTML = 'Gausssche Fehlerfortpflanzung · systematisches Modell · Ergebnis als ±σ';
  sec.appendChild(note);

  const unc = proj.uncertainty ?? { uRelPct: 0, aRelPct: 0, nRelPct: 0 };

  function updateUnc(patch: Partial<typeof unc>): void {
    const current = (editor.getProject() as Project).uncertainty ?? { uRelPct: 0, aRelPct: 0, nRelPct: 0 };
    editor.updateProject({ uncertainty: { ...current, ...patch } });
  }

  const uInp = numInput(unc.uRelPct, 0, 50);
  uInp.step = '1';
  uInp.addEventListener('change', () => updateUnc({ uRelPct: Number(uInp.value) }));
  sec.appendChild(field('ε_U — U-Wert (%)', uInp));

  const aInp = numInput(unc.aRelPct, 0, 50);
  aInp.step = '1';
  aInp.addEventListener('change', () => updateUnc({ aRelPct: Number(aInp.value) }));
  sec.appendChild(field('ε_A — Fläche (%)', aInp));

  const nInp = numInput(unc.nRelPct, 0, 50);
  nInp.step = '1';
  nInp.addEventListener('change', () => updateUnc({ nRelPct: Number(nInp.value) }));
  sec.appendChild(field('ε_n — Luftwechsel (%)', nInp));
}

// ---- Room panel ----

function renderRoomPanel(
  container: HTMLElement, room: Room, editor: Editor,
  hasAbove: boolean, hasBelow: boolean,
  floor?: import('../model/types.js').Floor,
  floorAbove?: import('../model/types.js').Floor,
  floorBelow?: import('../model/types.js').Floor,
): void {
  const sec = section('Raum');
  container.appendChild(sec);

  const labelInp = el('input', { type: 'text', class: 'input', value: room.label }) as HTMLInputElement;
  labelInp.addEventListener('change', () => editor.updateRoom(room.id, { label: labelInp.value }));
  sec.appendChild(field('Bezeichnung', labelInp));

  const roomTypeSel = el('select', { class: 'select' }) as HTMLSelectElement;
  const currentRoomType = room.roomType ?? ((room as any).isHeated === false ? 'reduced' : 'heated');
  ([['heated', 'Beheizt'], ['reduced', 'Reduziert'], ['unheated', 'Unbeheizt']] as [string, string][]).forEach(([v, lbl]) => {
    const opt = el('option', { value: v }, lbl);
    if (v === currentRoomType) opt.selected = true;
    roomTypeSel.appendChild(opt);
  });
  roomTypeSel.addEventListener('change', () =>
    editor.updateRoom(room.id, { roomType: roomTypeSel.value as 'heated' | 'reduced' | 'unheated' }));
  sec.appendChild(field('Raumtyp', roomTypeSel));

  if (currentRoomType === 'unheated') {
    const info = el('div', { class: 'panel-info' }, 'Raumtemperatur wird als Gleichgewichtstemperatur berechnet');
    sec.appendChild(info);
  } else {
    const tempInp = numInput(room.designTemperature, -20, 30);
    tempInp.addEventListener('change', () => editor.updateRoom(room.id, { designTemperature: Number(tempInp.value) }));
    sec.appendChild(field('Raumtemperatur θint (°C)', tempInp));
  }

  const heightInp = numInput(room.ceilingHeight, 1000, 6000);
  heightInp.addEventListener('change', () => editor.updateRoom(room.id, { ceilingHeight: Number(heightInp.value) }));
  sec.appendChild(field('Raumhöhe (mm)', heightInp));

  renderFloorsSection(container, room, editor, hasBelow, floor, floorBelow);

  // Ventilation
  const airInp = numInput(room.minAirChanges ?? 0.5, 0, 5);
  airInp.step = '0.1';
  airInp.addEventListener('change', () => editor.updateRoom(room.id, { minAirChanges: Number(airInp.value) }));
  sec.appendChild(field('Mindestluftwechsel n (h⁻¹)', airInp));

  if (room.area) {
    const volM3 = room.volumeOverride ?? (room.area * room.ceilingHeight / 1000);
    const info = el('div', { class: 'panel-info' }, `Fläche: ${room.area.toFixed(2)} m²  ·  Volumen: ${volM3.toFixed(1)} m³`);
    sec.appendChild(info);
  }

  renderCeilingsSection(container, room, editor, hasAbove, floor, floorAbove);
}

// ---- Floors section ----

const FLOOR_CATS: BoundaryCategory[] = ['ground', 'adj_heated', 'adj_reduced', 'unheated', 'exterior', 'adj_neighbor'];

function renderFloorsSection(
  container: HTMLElement,
  room: Room,
  editor: Editor,
  hasBelow: boolean,
  floor?: import('../model/types.js').Floor,
  floorBelow?: import('../model/types.js').Floor,
): void {
  const floors = room.floors ?? [];
  const multi  = floors.length > 1;

  const secEl   = el('div', { class: 'panel-section' });
  const titleRow = el('div', { class: 'ceil-section-header' });
  titleRow.appendChild(el('span', { class: 'panel-section-title' }, 'Böden'));
  if (!hasBelow) {
    const addBtn = el('button', { class: 'btn btn-sm', title: 'Bodenelement hinzufügen' }, '+ Boden');
    addBtn.addEventListener('click', () => {
      const newFloor: RoomFloor = { id: uuidv4(), uValue: 0.25, boundaryCategory: 'ground', typePresetId: 'floor_neubau' };
      editor.updateRoom(room.id, { floors: [...floors, newFloor] });
    });
    titleRow.appendChild(addBtn);
  }
  secEl.appendChild(titleRow);

  // When there is a floor below, show the rooms below that this floor covers.
  if (hasBelow && floorBelow && floorBelow.rooms.length > 0) {
    secEl.appendChild(el('div', { class: 'adj-auto-note' },
      'Der U-Wert dieses Bodens wird als Decken-U-Wert der darunterliegenden Räume übernommen.'));

    const upperPoly = floor ? getRoomPolygon(room, floor) : null;

    for (const lowerRoom of floorBelow.rooms) {
      let areaStr = '';
      if (upperPoly) {
        const lowerPoly = getRoomPolygon(lowerRoom, floorBelow);
        if (lowerPoly) {
          const m2 = polygonIntersectionArea(upperPoly, lowerPoly) / 1_000_000;
          if (m2 < 0.01) continue;
          areaStr = `${m2.toFixed(2)} m²  ·  `;
        }
      }
      const row = el('div', { class: 'ceil-inherited-row' });
      row.appendChild(el('span', { class: 'ceil-inherited-room' }, lowerRoom.label));
      row.appendChild(el('span', { class: 'ceil-inherited-val' },
        `${areaStr}${lowerRoom.designTemperature} °C`));
      secEl.appendChild(row);
    }
  }

  for (let i = 0; i < floors.length; i++) {
    secEl.appendChild(makeFloorCard(room, floors, i, multi, editor, hasBelow));
  }

  if (multi) {
    const volInp = numInput(room.volumeOverride ?? parseFloat((((room.area ?? 0) * room.ceilingHeight / 1000).toFixed(1))), 0, 100000);
    volInp.step = '0.1';
    volInp.addEventListener('change', () => editor.updateRoom(room.id, { volumeOverride: Number(volInp.value) }));
    secEl.appendChild(field('Raumvolumen manuell (m³)', volInp));
  }

  container.appendChild(secEl);
}

function makeFloorCard(
  room: Room,
  floors: RoomFloor[],
  index: number,
  multi: boolean,
  editor: Editor,
  hasBelow: boolean,
): HTMLDivElement {
  const flr  = floors[index];
  const card = el('div', { class: 'ceil-card' });

  const cardHeader = el('div', { class: 'ceil-card-header' });
  const labelInp   = el('input', {
    type: 'text', class: 'input ceil-label-inp',
    placeholder: `Boden ${index + 1}`,
    value: flr.label ?? '',
  }) as HTMLInputElement;
  labelInp.addEventListener('change', () => {
    const updated = floors.map((f, i) => i === index ? { ...f, label: labelInp.value || undefined } : f);
    editor.updateRoom(room.id, { floors: updated });
  });
  cardHeader.appendChild(labelInp);

  if (!hasBelow && floors.length > 1) {
    const removeBtn = el('button', { class: 'btn btn-sm btn-danger', title: 'Entfernen' }, '×');
    removeBtn.addEventListener('click', () => {
      const updated = floors.filter((_, i) => i !== index);
      const patch: Partial<Room> = { floors: updated };
      if (updated.length <= 1) patch.volumeOverride = undefined;
      editor.updateRoom(room.id, patch);
    });
    cardHeader.appendChild(removeBtn);
  }
  card.appendChild(cardHeader);

  const allFloorPresets = [...FLOOR_PRESETS, ...loadCustomPresets().floors];
  const presetSel = el('select', { class: 'input' }) as HTMLSelectElement;
  presetSel.appendChild(el('option', { value: '' }, '— Benutzerdefiniert —'));
  for (const p of allFloorPresets) {
    const opt = el('option', { value: p.id }, `${p.name} (U ${p.uValue.toFixed(2)})`) as HTMLOptionElement;
    opt.selected = p.id === flr.typePresetId;
    presetSel.appendChild(opt);
  }
  presetSel.addEventListener('change', () => {
    if (presetSel.value === '') {
      const updated = floors.map((f, i) => i === index ? { ...f, typePresetId: undefined } : f);
      editor.updateRoom(room.id, { floors: updated });
      return;
    }
    const p = allFloorPresets.find(pr => pr.id === presetSel.value);
    if (!p) return;
    const patch = { typePresetId: p.id, uValue: p.uValue };
    const updated = floors.map((f, i) => i === index ? { ...f, ...patch } : f);
    editor.updateRoom(room.id, { floors: updated });
  });
  card.appendChild(field('Bodenaufbau', presetSel));

  // U-value: read-only when preset is selected, editable for custom
  if (flr.typePresetId) {
    card.appendChild(el('div', { class: 'panel-info' }, `U = ${flr.uValue.toFixed(3)} W/m²K`));
  } else {
    const uInp = el('input', { type: 'number', class: 'input', min: '0.05', max: '5', step: '0.01', value: String(flr.uValue) }) as HTMLInputElement;
    uInp.addEventListener('change', () => {
      const updated = floors.map((f, i) => i === index ? { ...f, uValue: Number(uInp.value) } : f);
      editor.updateRoom(room.id, { floors: updated });
    });
    card.appendChild(field('U-Wert (W/m²K)', uInp));
  }

  if (!hasBelow) {
    const catSel = el('select', { class: 'input' }) as HTMLSelectElement;
    for (const cat of FLOOR_CATS) {
      const opt = el('option', { value: cat }, getBoundaryCategoryLabel(cat)) as HTMLOptionElement;
      if (cat === flr.boundaryCategory) opt.selected = true;
      catSel.appendChild(opt);
    }
    catSel.addEventListener('change', () => {
      const updated = floors.map((f, i) => i === index ? { ...f, boundaryCategory: catSel.value as BoundaryCategory } : f);
      editor.updateRoom(room.id, { floors: updated });
    });
    card.appendChild(field('Grenzkategorie', catSel));

    if (flr.boundaryCategory === 'unheated' || flr.boundaryCategory === 'adj_reduced') {
      const tInp = numInput(flr.unheatedSpaceTemp ?? 10, -20, 30);
      tInp.addEventListener('change', () => {
        const updated = floors.map((f, i) => i === index ? { ...f, unheatedSpaceTemp: Number(tInp.value) } : f);
        editor.updateRoom(room.id, { floors: updated });
      });
      card.appendChild(field('Temp. darunter (°C)', tInp));
    } else if (flr.boundaryCategory === 'adj_neighbor') {
      const tInp = numInput(flr.unheatedSpaceTemp ?? 15, -20, 30);
      tInp.addEventListener('change', () => {
        const updated = floors.map((f, i) => i === index ? { ...f, unheatedSpaceTemp: Number(tInp.value) } : f);
        editor.updateRoom(room.id, { floors: updated });
      });
      card.appendChild(field('Temp. Nachbar (°C)', tInp));
    }

    if (multi) {
      const areaInp = numInput(flr.areaOverride ?? room.area ?? 0, 0, 10000);
      areaInp.step = '0.01';
      areaInp.addEventListener('change', () => {
        const updated = floors.map((f, i) => i === index ? { ...f, areaOverride: Number(areaInp.value) } : f);
        editor.updateRoom(room.id, { floors: updated });
      });
      card.appendChild(field('Fläche (m²)', areaInp));
    }
  }

  return card;
}

// ---- Ceilings section ----

const CEIL_CATS: BoundaryCategory[] = ['exterior', 'unheated', 'adj_heated', 'adj_reduced', 'adj_neighbor'];

function renderCeilingsSection(
  container: HTMLElement,
  room: Room,
  editor: Editor,
  hasAbove: boolean,
  floor?: import('../model/types.js').Floor,
  floorAbove?: import('../model/types.js').Floor,
): void {
  const ceilings = room.ceilings ?? [];
  const multi = ceilings.length > 1;

  const secEl = el('div', { class: 'panel-section' });
  const titleRow = el('div', { class: 'ceil-section-header' });
  titleRow.appendChild(el('span', { class: 'panel-section-title' }, 'Decken'));
  if (!hasAbove) {
    const addBtn = el('button', { class: 'btn btn-sm', title: 'Decke hinzufügen' }, '+ Decke');
    addBtn.addEventListener('click', () => {
      const newCeil: RoomCeiling = { id: uuidv4(), uValue: 0.20, boundaryCategory: 'exterior', typePresetId: 'roof_neubau' };
      editor.updateRoom(room.id, { ceilings: [...ceilings, newCeil] });
    });
    titleRow.appendChild(addBtn);
  }
  secEl.appendChild(titleRow);

  // When there is a floor above, show its rooms' floor configs as the effective ceiling.
  if (hasAbove && floorAbove && floorAbove.rooms.length > 0) {
    secEl.appendChild(el('div', { class: 'adj-auto-note' },
      'Decke wird automatisch aus dem Bodenaufbau der darüber liegenden Räume abgeleitet.'));

    const allFloorPresets = [...FLOOR_PRESETS, ...loadCustomPresets().floors];
    const lowerPoly = floor ? getRoomPolygon(room, floor) : null;

    for (const upperRoom of floorAbove.rooms) {
      const flr = upperRoom.floors?.[0];
      if (!flr) continue;

      let areaStr = '';
      if (lowerPoly) {
        const upperPoly = getRoomPolygon(upperRoom, floorAbove);
        if (upperPoly) {
          const m2 = polygonIntersectionArea(lowerPoly, upperPoly) / 1_000_000;
          if (m2 >= 0.01) areaStr = `${m2.toFixed(2)} m²  ·  `;
          else continue; // no meaningful overlap — skip this room
        }
      }

      const preset = allFloorPresets.find(p => p.id === flr.typePresetId);
      const presetName = preset ? preset.name : 'Benutzerdefiniert';

      const row = el('div', { class: 'ceil-inherited-row' });
      row.appendChild(el('span', { class: 'ceil-inherited-room' }, upperRoom.label));
      row.appendChild(el('span', { class: 'ceil-inherited-val' },
        `${areaStr}${upperRoom.designTemperature} °C  ·  ${presetName}  ·  U = ${flr.uValue.toFixed(3)} W/m²K`));
      secEl.appendChild(row);
    }

  } else {
    for (let i = 0; i < ceilings.length; i++) {
      secEl.appendChild(makeCeilingCard(room, ceilings, i, multi, editor, hasAbove));
    }
  }

  // Volume override — show when multiple ceilings (irregular geometry)
  if (multi) {
    const volInp = numInput(room.volumeOverride ?? parseFloat((((room.area ?? 0) * room.ceilingHeight / 1000).toFixed(1))), 0, 100000);
    volInp.step = '0.1';
    volInp.addEventListener('change', () => editor.updateRoom(room.id, { volumeOverride: Number(volInp.value) }));
    secEl.appendChild(field('Raumvolumen manuell (m³)', volInp));
  } else if (room.volumeOverride !== undefined) {
    // Single ceiling but manual override still set — keep editable
    const volInp = numInput(room.volumeOverride, 0, 100000);
    volInp.step = '0.1';
    volInp.addEventListener('change', () => editor.updateRoom(room.id, { volumeOverride: Number(volInp.value) }));
    secEl.appendChild(field('Raumvolumen manuell (m³)', volInp));
  }

  container.appendChild(secEl);
}

function makeCeilingCard(
  room: Room,
  ceilings: RoomCeiling[],
  index: number,
  multi: boolean,
  editor: Editor,
  hasAbove: boolean,
): HTMLDivElement {
  const ceil = ceilings[index];
  const card = el('div', { class: 'ceil-card' });

  const cardHeader = el('div', { class: 'ceil-card-header' });
  const labelInp = el('input', {
    type: 'text', class: 'input ceil-label-inp',
    placeholder: `Decke ${index + 1}`,
    value: ceil.label ?? '',
  }) as HTMLInputElement;
  labelInp.addEventListener('change', () => {
    const updated = ceilings.map((c, i) => i === index ? { ...c, label: labelInp.value || undefined } : c);
    editor.updateRoom(room.id, { ceilings: updated });
  });
  cardHeader.appendChild(labelInp);

  if (!hasAbove && ceilings.length > 1) {
    const removeBtn = el('button', { class: 'btn btn-sm btn-danger', title: 'Entfernen' }, '×');
    removeBtn.addEventListener('click', () => {
      const updated = ceilings.filter((_, i) => i !== index);
      const patch: Partial<Room> = { ceilings: updated };
      if (updated.length <= 1) patch.volumeOverride = undefined;
      editor.updateRoom(room.id, patch);
    });
    cardHeader.appendChild(removeBtn);
  }
  card.appendChild(cardHeader);

  if (hasAbove) {
    card.appendChild(el('div', { class: 'adj-auto-note' },
      'U-Wert und Grenzkategorie werden automatisch aus dem Bodenaufbau der oberen Etage übernommen. Dieser Aufbau gilt nur für Deckenflächen ohne Raum darüber.'));
  }

  const presetLabel = hasAbove ? 'Aufbau Restfläche' : 'Deckenaufbau';
  const presetSel = el('select', { class: 'input' }) as HTMLSelectElement;
  presetSel.appendChild(el('option', { value: '' }, '— Benutzerdefiniert —'));
  for (const p of CEILING_PRESETS) {
    const opt = el('option', { value: p.id }, `${p.name} (U ${p.uValue.toFixed(2)})`) as HTMLOptionElement;
    opt.selected = p.id === ceil.typePresetId;
    presetSel.appendChild(opt);
  }
  presetSel.addEventListener('change', () => {
    if (presetSel.value === '') {
      const updated = ceilings.map((c, i) => i === index ? { ...c, typePresetId: undefined } : c);
      editor.updateRoom(room.id, { ceilings: updated });
      return;
    }
    const p = CEILING_PRESETS.find(pr => pr.id === presetSel.value);
    if (!p) return;
    const patch = { typePresetId: p.id, uValue: p.uValue };
    const updated = ceilings.map((c, i) => i === index ? { ...c, ...patch } : c);
    editor.updateRoom(room.id, { ceilings: updated });
  });
  card.appendChild(field(presetLabel, presetSel));

  // U-value: read-only when preset is selected, editable for custom
  if (ceil.typePresetId) {
    card.appendChild(el('div', { class: 'panel-info' }, `U = ${ceil.uValue.toFixed(3)} W/m²K`));
  } else {
    const uInp = el('input', { type: 'number', class: 'input', min: '0.05', max: '5', step: '0.01', value: String(ceil.uValue) }) as HTMLInputElement;
    uInp.addEventListener('change', () => {
      const updated = ceilings.map((c, i) => i === index ? { ...c, uValue: Number(uInp.value) } : c);
      editor.updateRoom(room.id, { ceilings: updated });
    });
    card.appendChild(field('U-Wert (W/m²K)', uInp));
  }

  if (!hasAbove) {
    const catSel = el('select', { class: 'input' }) as HTMLSelectElement;
    for (const cat of CEIL_CATS) {
      const opt = el('option', { value: cat }, getBoundaryCategoryLabel(cat)) as HTMLOptionElement;
      if (cat === ceil.boundaryCategory) opt.selected = true;
      catSel.appendChild(opt);
    }
    catSel.addEventListener('change', () => {
      const updated = ceilings.map((c, i) => i === index ? { ...c, boundaryCategory: catSel.value as BoundaryCategory } : c);
      editor.updateRoom(room.id, { ceilings: updated });
    });
    card.appendChild(field('Grenzkategorie', catSel));

    if (multi) {
      const areaInp = numInput(ceil.areaOverride ?? room.area ?? 0, 0, 10000);
      areaInp.step = '0.01';
      areaInp.addEventListener('change', () => {
        const updated = ceilings.map((c, i) => i === index ? { ...c, areaOverride: Number(areaInp.value) } : c);
        editor.updateRoom(room.id, { ceilings: updated });
      });
      card.appendChild(field('Fläche (m²)', areaInp));
    } else if (ceil.areaOverride !== undefined) {
      const areaInp = numInput(ceil.areaOverride, 0, 10000);
      areaInp.step = '0.01';
      areaInp.addEventListener('change', () => {
        const updated = ceilings.map((c, i) => i === index ? { ...c, areaOverride: Number(areaInp.value) || undefined } : c);
        editor.updateRoom(room.id, { ceilings: updated });
      });
      card.appendChild(field('Fläche überschreiben (m²)', areaInp));
    }

    if (ceil.boundaryCategory === 'unheated' || ceil.boundaryCategory === 'adj_reduced') {
      const tInp = numInput(ceil.unheatedSpaceTemp ?? 10, -20, 30);
      tInp.addEventListener('change', () => {
        const updated = ceilings.map((c, i) => i === index ? { ...c, unheatedSpaceTemp: Number(tInp.value) } : c);
        editor.updateRoom(room.id, { ceilings: updated });
      });
      card.appendChild(field('Temp. darüber (°C)', tInp));
    } else if (ceil.boundaryCategory === 'adj_neighbor') {
      const tInp = numInput(ceil.unheatedSpaceTemp ?? 15, -20, 30);
      tInp.addEventListener('change', () => {
        const updated = ceilings.map((c, i) => i === index ? { ...c, unheatedSpaceTemp: Number(tInp.value) } : c);
        editor.updateRoom(room.id, { ceilings: updated });
      });
      card.appendChild(field('Temp. Nachbar (°C)', tInp));
    }
  }

  return card;
}

// ---- Library item panel ----

function renderLibraryItemPanel(
  container: HTMLElement,
  id: string,
  type: 'wall' | 'window' | 'door' | 'garage_door' | 'floor',
  editor: Editor,
): void {
  const custom = loadCustomPresets();

  if (type === 'wall') {
    const builtin = WALL_PRESETS.find(p => p.id === id);
    const customP = custom.walls.find(p => p.id === id);
    const preset  = customP ?? builtin;
    if (!preset) return;
    void customP; // isCustom no longer needed — save always uses original ID

    const sec = section('Wandtyp');
    container.appendChild(sec);

    const nameInp = el('input', { type: 'text', class: 'input', value: preset.name }) as HTMLInputElement;
    const uInp    = el('input', { type: 'number', class: 'input', min: '0.05', max: '5', step: '0.01', value: String(preset.uValue) }) as HTMLInputElement;
    const thkInp  = el('input', { type: 'number', class: 'input', min: '50', max: '1000', step: '10', value: String(preset.thickness) }) as HTMLInputElement;

    sec.appendChild(field('Name', nameInp));
    sec.appendChild(field('U-Wert (W/m²K)', uInp));
    sec.appendChild(field('Dicke (mm)', thkInp));

    const saveBtn = el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:8px' }, 'Speichern');
    saveBtn.addEventListener('click', () => {
      const uVal = Number(uInp.value);
      const thk  = Number(thkInp.value);
      const p: WallTypePreset = {
        id, name: nameInp.value.trim() || preset.name,
        description: nameInp.value.trim() || preset.name,
        uValue: uVal, thickness: thk,
      };
      addCustomWallPreset(p);
      editor.syncPresetToProject(id, uVal, thk);
      editor.setActiveWallPreset(id);
      editor.selectLibraryItem(id, 'wall');
    });
    container.appendChild(saveBtn);

  } else if (type === 'floor') {
    const builtin = FLOOR_PRESETS.find(p => p.id === id);
    const customP = custom.floors.find(p => p.id === id);
    const preset  = customP ?? builtin;
    if (!preset) return;
    void customP; // isCustom no longer needed — save always uses original ID

    const sec = section('Bodenaufbau');
    container.appendChild(sec);

    const nameInp = el('input', { type: 'text', class: 'input', value: preset.name }) as HTMLInputElement;
    const uInp    = el('input', { type: 'number', class: 'input', min: '0.05', max: '5', step: '0.01', value: String(preset.uValue) }) as HTMLInputElement;

    sec.appendChild(field('Name', nameInp));
    sec.appendChild(field('U-Wert (W/m²K)', uInp));

    const saveBtn = el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:8px' }, 'Speichern');
    saveBtn.addEventListener('click', () => {
      const uVal = Number(uInp.value);
      const p: CeilingTypePreset = {
        id, name: nameInp.value.trim() || preset.name,
        uValue: uVal,
      };
      addCustomFloorPreset(p);
      editor.syncPresetToProject(id, uVal);
      editor.selectLibraryItem(id, 'floor');
    });
    container.appendChild(saveBtn);

  } else {
    // Opening: window / door / garage_door
    const builtinList = type === 'window' ? WINDOW_PRESETS : type === 'door' ? DOOR_PRESETS : GARAGE_PRESETS;
    const customList  = type === 'window' ? custom.windows : type === 'door' ? custom.doors : custom.garageDoors;
    const builtin  = builtinList.find(p => p.id === id);
    const customP  = customList.find(p => p.id === id);
    const preset   = customP ?? builtin;
    if (!preset) return;
    void customP; // isCustom no longer needed — save always uses original ID

    const typeLabel = type === 'window' ? 'Fenster' : type === 'door' ? 'Tür' : 'Garagentor';
    const sec = section(typeLabel + 'typ');
    container.appendChild(sec);

    const nameInp   = el('input', { type: 'text', class: 'input', value: preset.name }) as HTMLInputElement;
    const uInp      = el('input', { type: 'number', class: 'input', min: '0.3', max: '5', step: '0.1', value: String(preset.uValue) }) as HTMLInputElement;
    const widthInp  = el('input', { type: 'number', class: 'input', min: '100', max: '10000', step: '10', value: String(preset.width) }) as HTMLInputElement;
    const heightInp = el('input', { type: 'number', class: 'input', min: '100', max: '5000',  step: '10', value: String(preset.height) }) as HTMLInputElement;

    sec.appendChild(field('Name', nameInp));
    sec.appendChild(field('U-Wert (W/m²K)', uInp));
    sec.appendChild(field('Breite (mm)', widthInp));
    sec.appendChild(field('Höhe (mm)', heightInp));

    const saveBtn = el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:8px' }, 'Speichern');
    saveBtn.addEventListener('click', () => {
      const uVal = Number(uInp.value);
      const p: OpeningTypePreset = {
        id, name: nameInp.value.trim() || preset.name,
        type: preset.type,
        uValue: uVal,
        width:  Number(widthInp.value),
        height: Number(heightInp.value),
      };
      addCustomOpeningPreset(p);
      editor.syncPresetToProject(id, uVal);
      editor.setActiveOpeningPreset(preset.type, id);
      editor.selectLibraryItem(id, preset.type);
    });
    container.appendChild(saveBtn);
  }
}

// ---- Floor properties panel ----

function renderFloorPropertiesPanel(
  container: HTMLElement,
  floor: import('../model/types.js').Floor,
  editor: Editor,
  project: import('../model/types.js').Project,
): void {
  const sec = section('Etage');
  container.appendChild(sec);

  // Name (label)
  const labelInp = el('input', { type: 'text', class: 'input', value: floor.label }) as HTMLInputElement;
  labelInp.addEventListener('change', () => editor.renameFloor(floor.id, labelInp.value || floor.label));
  sec.appendChild(field('Bezeichnung', labelInp));

  // Default ceiling height
  const hInp = numInput(floor.defaultCeilingHeight, 1000, 6000);
  hInp.addEventListener('change', () => {
    const h = Number(hInp.value);
    const updatedFloors = project.floors.map(f => f.id === floor.id ? { ...f, defaultCeilingHeight: h } : f);
    editor.updateProject({ floors: updatedFloors });
  });
  sec.appendChild(field('Standard-Raumhöhe (mm)', hInp));

  // Stats
  const totalArea   = floor.rooms.reduce((s, r) => s + (r.area ?? 0), 0);
  const wallCount   = floor.walls.length;
  const roomCount   = floor.rooms.length;
  const floorOrder  = [...project.floors].sort((a, b) => a.level - b.level).findIndex(f => f.id === floor.id);
  const levelLabel  = floorOrder === 0 ? 'EG' : `${floorOrder}. OG`;
  sec.appendChild(el('div', { class: 'panel-info' },
    `${levelLabel}  ·  ${roomCount} Räume  ·  ${totalArea.toFixed(1)} m²  ·  ${wallCount} Wände`));
}

// ---- Wall panel ----

const EXTERIOR_CATS: BoundaryCategory[] = ['exterior', 'ground', 'unheated', 'adj_neighbor'];

function renderWallPanel(container: HTMLElement, wall: WallSegment, editor: Editor, floor: import('../model/types.js').Floor): void {
  const wallRooms = floor.rooms.filter(r => r.wallIds.includes(wall.id));
  const isInterior = wallRooms.length >= 2;
  const color = getBoundaryCategoryColor(wall.boundaryCategory);

  // ── Adjacency banner ──
  const banner = el('div', { class: 'adj-banner', style: `border-color: ${color}` });

  const dot = el('span', { class: 'adj-dot', style: `background:${color}` });
  banner.appendChild(dot);

  const catStrong = el('strong', {}, getBoundaryCategoryLabel(wall.boundaryCategory));
  banner.appendChild(catStrong);

  if (isInterior) {
    const [r1, r2] = wallRooms;
    const sub = el('span', { class: 'adj-sub' });
    sub.appendChild(el('span', { class: 'adj-room-chip' }, `${r1.label} (${r1.designTemperature} °C)`));
    sub.appendChild(document.createTextNode(' ↔ '));
    sub.appendChild(el('span', { class: 'adj-room-chip' }, `${r2.label} (${r2.designTemperature} °C)`));
    banner.appendChild(sub);
  } else if (wallRooms.length === 1) {
    const sub = el('span', { class: 'adj-sub' });
    sub.appendChild(el('span', { class: 'adj-room-chip' }, `${wallRooms[0].label} (${wallRooms[0].designTemperature} °C)`));
    sub.appendChild(document.createTextNode(' → '));
    sub.appendChild(document.createTextNode(getBoundaryCategoryLabel(wall.boundaryCategory)));
    banner.appendChild(sub);
  }

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
    if (presetSel.value === '') {
      editor.updateWall(wall.id, { typePresetId: undefined });
      return;
    }
    const p = allWallPresets.find(pr => pr.id === presetSel.value);
    if (!p) return;
    editor.updateWall(wall.id, { typePresetId: p.id, uValue: p.uValue, thickness: p.thickness });
  });
  sec.appendChild(field('Wandtyp', presetSel));

  // Boundary category — only relevant for exterior walls
  if (!isInterior) {
    const catSel = el('select', { class: 'input' }) as HTMLSelectElement;
    for (const cat of EXTERIOR_CATS) {
      const opt = el('option', { value: cat }, getBoundaryCategoryLabel(cat)) as HTMLOptionElement;
      if (cat === wall.boundaryCategory) opt.selected = true;
      catSel.appendChild(opt);
    }
    catSel.addEventListener('change', () =>
      editor.updateWall(wall.id, { boundaryCategory: catSel.value as BoundaryCategory })
    );
    sec.appendChild(field('Grenzkategorie', catSel));

    if (wall.boundaryCategory === 'unheated') {
      const utInp = numInput(wall.unheatedSpaceTemp ?? 4, -20, 30);
      utInp.addEventListener('change', () => editor.updateWall(wall.id, { unheatedSpaceTemp: Number(utInp.value) }));
      sec.appendChild(field('Temp. unbeheizter Raum (°C)', utInp));
    } else if (wall.boundaryCategory === 'adj_neighbor') {
      const ntInp = numInput(wall.unheatedSpaceTemp ?? 15, -20, 30);
      ntInp.addEventListener('change', () => editor.updateWall(wall.id, { unheatedSpaceTemp: Number(ntInp.value) }));
      sec.appendChild(field('Temp. Nachbargebäude (°C)', ntInp));
    }
  }

  // U-value and thickness — read-only when a preset is selected
  if (wall.typePresetId) {
    sec.appendChild(el('div', { class: 'panel-info' },
      `U = ${wall.uValue.toFixed(2)} W/m²K  ·  ${wall.thickness} mm`));
  } else {
    const uInp = el('input', { type: 'number', class: 'input', min: '0.05', max: '5', step: '0.01', value: String(wall.uValue) }) as HTMLInputElement;
    uInp.addEventListener('change', () => editor.updateWall(wall.id, { uValue: Number(uInp.value) }));
    sec.appendChild(field('U-Wert (W/m²K)', uInp));

    const thickInp = numInput(wall.thickness, 50, 1000);
    thickInp.addEventListener('change', () => editor.updateWall(wall.id, { thickness: Number(thickInp.value) }));
    sec.appendChild(field('Wanddicke (mm)', thickInp));
  }

  // Length info
  const lenM = (Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) / 1000).toFixed(3);
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
    if (opPresetSel.value === '') {
      editor.updateOpening(op.id, { typePresetId: undefined });
      return;
    }
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

  // U-value — read-only when a preset is selected
  if (op.typePresetId) {
    sec.appendChild(el('div', { class: 'panel-info' }, `U = ${op.uValue.toFixed(1)} W/m²K`));
  } else {
    const uInp = el('input', { type: 'number', class: 'input', min: '0.3', max: '5', step: '0.1', value: String(op.uValue) }) as HTMLInputElement;
    uInp.addEventListener('change', () => editor.updateOpening(op.id, { uValue: Number(uInp.value) }));
    sec.appendChild(field('U-Wert (W/m²K)', uInp));
  }

  const areaM2 = (op.width * op.height / 1_000_000).toFixed(3);
  container.appendChild(el('div', { class: 'panel-info' }, `Fläche: ${areaM2} m²`));

  const delBtn = el('button', { class: 'btn btn-danger btn-sm', style: 'margin-top:8px' }, 'Öffnung löschen');
  delBtn.addEventListener('click', () => editor.deleteSelectedOpening());
  container.appendChild(delBtn);
}
