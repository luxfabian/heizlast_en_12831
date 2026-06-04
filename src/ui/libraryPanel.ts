import type { Editor } from '../editor/editorState.js';
import { WALL_PRESETS, WINDOW_PRESETS, DOOR_PRESETS, GARAGE_PRESETS, FLOOR_PRESETS } from '../library/presets.js';
import type { WallTypePreset, OpeningTypePreset, CeilingTypePreset } from '../library/presets.js';
import { loadCustomPresets, addCustomWallPreset, addCustomOpeningPreset, addCustomFloorPreset, removeCustomPreset } from '../library/customPresets.js';
import { getBoundaryCategoryColor } from '../editor/adjacency.js';
import type { BoundaryCategory } from '../model/types.js';
import { v4 as uuidv4 } from '../utils/uuid.js';

// Persistent collapsed-state (survives panel re-renders which happen on every mouse move)
const collapsedSections = new Set<string>(['walls', 'windows', 'doors', 'garageDoors', 'floors']);

// ---- DOM helpers ----

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {},
  ...children: (HTMLElement | Text | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

// ---- Section header ----

function makeSection(
  id: string,
  title: string,
  onAddClick: () => void,
): { section: HTMLDivElement; body: HTMLDivElement } {
  const isCollapsed = collapsedSections.has(id);
  const section = el('div', { class: 'lib-section' });

  const header = el('div', { class: 'lib-section-header' });
  const toggle = el('button', { class: 'lib-collapse-btn', 'data-section': id, title: 'Ein-/Ausklappen' });
  toggle.textContent = isCollapsed ? '▸' : '▾';
  toggle.addEventListener('click', () => {
    if (collapsedSections.has(id)) collapsedSections.delete(id);
    else collapsedSections.add(id);
    toggle.textContent = collapsedSections.has(id) ? '▸' : '▾';
    body.style.display = collapsedSections.has(id) ? 'none' : '';
  });

  const titleEl = el('span', { class: 'lib-section-title-text' }, title);
  const addBtn  = el('button', { class: 'lib-add-btn', title: 'Eigenen Typ hinzufügen' }, '+');
  addBtn.addEventListener('click', e => { e.stopPropagation(); onAddClick(); });

  header.appendChild(toggle);
  header.appendChild(titleEl);
  header.appendChild(addBtn);
  section.appendChild(header);

  const body = el('div', { class: 'lib-section-body' });
  body.style.display = isCollapsed ? 'none' : '';
  section.appendChild(body);

  return { section, body };
}

// ---- One-liner preset row ----

function makePresetRow(
  name: string,
  valueLabel: string,
  dotColor: string | null,
  iconChar: string | null,
  isActive: boolean,
  isCustom: boolean,
  onClick: () => void,
  onDelete?: () => void,
): HTMLDivElement {
  const row = el('div', { class: `lib-card${isActive ? ' lib-card--active' : ''}` });

  if (dotColor) {
    row.appendChild(el('span', { class: 'lib-dot', style: `background:${dotColor}` }));
  } else if (iconChar) {
    row.appendChild(el('span', { class: 'lib-opening-icon' }, iconChar));
  }

  row.appendChild(el('span', { class: 'lib-card-name' }, name));
  row.appendChild(el('span', { class: 'lib-card-value' }, valueLabel));

  if (isCustom && onDelete) {
    const del = el('button', { class: 'lib-delete-btn', title: 'Löschen' }, '×');
    del.addEventListener('click', e => { e.stopPropagation(); onDelete(); });
    row.appendChild(del);
  }

  row.addEventListener('click', onClick);
  return row;
}

// ---- Main entry ----

export function renderLibraryPanel(container: HTMLElement, editor: Editor): void {
  container.innerHTML = '';
  const state  = editor.getState();
  const custom = loadCustomPresets();

  // ── Walls ─────────────────────────────────────────────
  const { section: wallSec, body: wallBody } = makeSection('walls', 'Wandtypen', () =>
    openAddDialog('wall', editor)
  );
  container.appendChild(wallSec);
  const customWallIds = new Set(custom.walls.map(p => p.id));
  const allWalls: (WallTypePreset & { isCustom?: boolean })[] = [
    ...WALL_PRESETS.filter(p => !customWallIds.has(p.id)),
    ...custom.walls.map(p => ({ ...p, isCustom: true })),
  ];
  for (const p of allWalls) {
    wallBody.appendChild(makePresetRow(
      p.name,
      `U ${p.uValue.toFixed(2)} · ${p.thickness} mm`,
      getBoundaryCategoryColor(p.defaultCategory),
      null,
      state.activeWallPresetId === p.id,
      !!p.isCustom,
      () => {
        editor.setActiveWallPreset(p.id);
        editor.setTool('wall');
        editor.selectLibraryItem(p.id, 'wall');
      },
      p.isCustom ? () => { removeCustomPreset(p.id); editor.invalidate(); } : undefined,
    ));
  }

  // ── Windows ───────────────────────────────────────────
  const { section: winSec, body: winBody } = makeSection('windows', 'Fenster', () =>
    openAddDialog('window', editor)
  );
  container.appendChild(winSec);
  renderOpeningSection(winBody, WINDOW_PRESETS, custom.windows, state.activeWindowPresetId, editor);

  // ── Doors ─────────────────────────────────────────────
  const { section: doorSec, body: doorBody } = makeSection('doors', 'Türen', () =>
    openAddDialog('door', editor)
  );
  container.appendChild(doorSec);
  renderOpeningSection(doorBody, DOOR_PRESETS, custom.doors, state.activeDoorPresetId, editor);

  // ── Garage doors ──────────────────────────────────────
  const { section: garSec, body: garBody } = makeSection('garageDoors', 'Garagentore', () =>
    openAddDialog('garage_door', editor)
  );
  container.appendChild(garSec);
  renderOpeningSection(garBody, GARAGE_PRESETS, custom.garageDoors, state.activeGaragePresetId, editor);

  // ── Floor types ───────────────────────────────────────
  const { section: floorSec, body: floorBody } = makeSection('floors', 'Bodenaufbauten', () =>
    openAddDialog('floor', editor)
  );
  container.appendChild(floorSec);
  const customFloorIds = new Set(custom.floors.map(p => p.id));
  const allFloors: (CeilingTypePreset & { isCustom?: boolean })[] = [
    ...FLOOR_PRESETS.filter(p => !customFloorIds.has(p.id)),
    ...custom.floors.map(p => ({ ...p, isCustom: true })),
  ];
  for (const p of allFloors) {
    floorBody.appendChild(makePresetRow(
      p.name,
      `U ${p.uValue.toFixed(2)}`,
      getBoundaryCategoryColor(p.defaultCategory),
      null,
      state.selectedLibraryItemId === p.id,
      !!p.isCustom,
      () => editor.selectLibraryItem(p.id, 'floor'),
      p.isCustom ? () => { removeCustomPreset(p.id); editor.invalidate(); } : undefined,
    ));
  }
}

function renderOpeningSection(
  body: HTMLDivElement,
  builtin: OpeningTypePreset[],
  customList: OpeningTypePreset[],
  activeId: string,
  editor: Editor,
): void {
  const customIds = new Set(customList.map(p => p.id));
  const all = [
    ...builtin.filter(p => !customIds.has(p.id)),
    ...customList.map(p => ({ ...p, isCustom: true as const })),
  ];
  for (const p of all) {
    const icon = p.type === 'window' ? '⬜' : p.type === 'door' ? '🚪' : '🅿';
    const meta = `U ${p.uValue.toFixed(1)} · ${p.width / 10}×${p.height / 10}`;
    const isCustom = 'isCustom' in p && !!p.isCustom;
    body.appendChild(makePresetRow(
      p.name, meta, null, icon,
      activeId === p.id,
      isCustom,
      () => {
        editor.setActiveOpeningPreset(p.type, p.id);
        editor.setTool(p.type);
        editor.selectLibraryItem(p.id, p.type);
      },
      isCustom ? () => { removeCustomPreset(p.id); editor.invalidate(); } : undefined,
    ));
  }
}

// ---- Add/edit custom-preset dialog ----

type AddMode = 'wall' | 'window' | 'door' | 'garage_door' | 'floor';

function openAddDialog(mode: AddMode, editor: Editor): void {
  const dialog = document.getElementById('add-preset-dialog') as HTMLDialogElement | null;
  if (!dialog) return;

  const titleEl   = dialog.querySelector('#dialog-title')!;
  const fieldsEl  = dialog.querySelector('#dialog-fields')! as HTMLElement;
  const submitBtn = dialog.querySelector('#dialog-submit')! as HTMLButtonElement;

  const addTitles: Record<AddMode, string> = {
    wall: 'Neuer Wandtyp', window: 'Neues Fenster',
    door: 'Neue Tür', garage_door: 'Neues Garagentor',
    floor: 'Neuer Bodenaufbau',
  };
  titleEl.textContent = addTitles[mode];
  submitBtn.textContent = 'Hinzufügen';
  fieldsEl.innerHTML = '';

  const nameInp = makeDialogInput('Bezeichnung', 'text', 'Mein Typ');
  const uValInp = makeDialogInput('U-Wert (W/m²K)', 'number', '0.20');
  uValInp.step = '0.01'; uValInp.min = '0.05'; uValInp.max = '5';
  fieldsEl.appendChild(makeDialogField('Bezeichnung', nameInp));
  fieldsEl.appendChild(makeDialogField('U-Wert (W/m²K)', uValInp));

  let thickInp: HTMLInputElement | null = null;
  let catSel:   HTMLSelectElement | null = null;
  let widthInp: HTMLInputElement | null = null;
  let heightInp: HTMLInputElement | null = null;

  if (mode === 'wall' || mode === 'floor') {
    const defaultThick = mode === 'wall' ? '300' : undefined;
    if (mode === 'wall') {
      thickInp = makeDialogInput('Wanddicke (mm)', 'number', defaultThick!);
      thickInp.min = '50'; thickInp.max = '1000';
      fieldsEl.appendChild(makeDialogField('Wanddicke (mm)', thickInp));
    }

    catSel = document.createElement('select');
    catSel.className = 'input';
    const cats: [BoundaryCategory, string][] = mode === 'wall'
      ? [
          ['exterior',     'Außenwand'],
          ['adj_heated',   'Innenwand'],
          ['ground',       'Erdreich'],
          ['unheated',     'Unbeheizt'],
          ['adj_neighbor', 'Nachbargebäude'],
        ]
      : [
          ['ground',       'Erdreich'],
          ['adj_heated',   'Beheizt (darüber)'],
          ['exterior',     'Außenluft'],
          ['unheated',     'Unbeheizt'],
          ['adj_neighbor', 'Nachbargebäude'],
        ];
    for (const [v, l] of cats) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = l;
      catSel.appendChild(opt);
    }
    fieldsEl.appendChild(makeDialogField('Grenzkategorie', catSel));

  } else {
    widthInp  = makeDialogInput('Breite (mm)', 'number', '1200');
    heightInp = makeDialogInput('Höhe (mm)', 'number', '1400');
    widthInp.min  = '100'; widthInp.max  = '10000';
    heightInp.min = '100'; heightInp.max = '5000';
    fieldsEl.appendChild(makeDialogField('Breite (mm)', widthInp));
    fieldsEl.appendChild(makeDialogField('Höhe (mm)',   heightInp));
  }

  submitBtn.onclick = () => {
    const name = nameInp.value.trim() || 'Benutzerdefiniert';
    const uVal = Math.max(0.05, Math.min(5, Number(uValInp.value) || 0.20));
    const id = `custom_${uuidv4().slice(0, 8)}`;

    if (mode === 'wall' && thickInp && catSel) {
      const preset: WallTypePreset = {
        id, name, description: name, uValue: uVal,
        thickness: Math.max(50, Number(thickInp.value) || 300),
        defaultCategory: catSel.value as BoundaryCategory,
      };
      addCustomWallPreset(preset);
      editor.setActiveWallPreset(id);
      editor.selectLibraryItem(id, 'wall');

    } else if (mode === 'floor' && catSel) {
      const preset: CeilingTypePreset = { id, name, uValue: uVal, defaultCategory: catSel.value as BoundaryCategory };
      addCustomFloorPreset(preset);
      editor.selectLibraryItem(id, 'floor');

    } else if (widthInp && heightInp) {
      const preset: OpeningTypePreset = {
        id, name, type: mode as 'window' | 'door' | 'garage_door',
        uValue: uVal,
        width:  Math.max(100, Number(widthInp.value)  || 1200),
        height: Math.max(100, Number(heightInp.value) || 1400),
      };
      addCustomOpeningPreset(preset);
      editor.setActiveOpeningPreset(mode as 'window' | 'door' | 'garage_door', id);
      editor.selectLibraryItem(id, mode as 'window' | 'door' | 'garage_door');
    }

    dialog.close();
    editor.invalidate();
  };

  dialog.showModal();
}

function makeDialogInput(label: string, type: string, placeholder: string): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type        = type;
  inp.className   = 'input lib-field';
  inp.placeholder = placeholder;
  inp.value       = placeholder;
  void label;
  return inp;
}

function makeDialogField(label: string, input: HTMLElement): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  wrap.appendChild(lbl);
  wrap.appendChild(input);
  return wrap;
}
