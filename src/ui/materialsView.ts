import type { Project } from '../model/types.js';
import type { Editor } from '../editor/editorState.js';
import {
  WALL_PRESETS, WINDOW_PRESETS, DOOR_PRESETS, GARAGE_PRESETS, FLOOR_PRESETS,
  ALL_PRESET_IDS, DEFAULT_ACTIVE_PRESET_IDS,
} from '../library/presets.js';
import type { WallTypePreset, OpeningTypePreset, CeilingTypePreset } from '../library/presets.js';
import { loadCustomPresets, removeCustomPreset } from '../library/customPresets.js';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, ...children: (HTMLElement | Text | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

// ── Catalog item type ─────────────────────────────────────────────────────────

interface CItem { id: string; name: string; value: string; desc: string }

function wItem(p: WallTypePreset): CItem {
  return { id: p.id, name: p.name, value: `U ${p.uValue.toFixed(2)} · ${p.thickness} mm`, desc: p.description };
}
function oItem(p: OpeningTypePreset): CItem {
  return { id: p.id, name: p.name, value: `U ${p.uValue.toFixed(1)} · ${p.width / 10}×${p.height / 10} cm`, desc: '' };
}
function sItem(p: CeilingTypePreset): CItem {
  return { id: p.id, name: p.name, value: `U ${p.uValue.toFixed(2)} W/m²K`, desc: '' };
}

function wp(...ids: string[]): CItem[] { return ids.map(id => wItem(WALL_PRESETS.find(p => p.id === id)!)); }
function op(list: OpeningTypePreset[], ...ids: string[]): CItem[] { return ids.map(id => oItem(list.find(p => p.id === id)!)); }
function fp(...ids: string[]): CItem[] { return ids.map(id => sItem(FLOOR_PRESETS.find(p => p.id === id)!)); }

// ── Static catalog definition ─────────────────────────────────────────────────

const CATALOG: Array<{
  title: string;
  source?: string;
  subs: Array<{ label: string; items: CItem[] }>;
}> = [
  {
    title: 'Wandtypen',
    source: 'TABULA DE · GEG 2023 · KfW',
    subs: [
      { label: 'Außenwände — Neubau',                   items: wp('aw_kfw40', 'aw_kfw55', 'aw_neubau') },
      { label: 'Außenwände — Bestand (TABULA DE)',       items: wp('aw_2002_2015', 'aw_1995_2001', 'aw_1984_1994', 'aw_altbau', 'aw_1958_1968', 'aw_vor1958') },
      { label: 'Innenwände',                             items: wp('iw_massiv', 'iw_std', 'iw_leicht') },
      { label: 'Kellerwände / Erdanliegend',             items: wp('keller') },
    ],
  },
  {
    title: 'Fenster',
    source: 'TABULA DE · DIN EN 673',
    subs: [
      { label: 'Dreifachverglasung — Neubaustandard',          items: op(WINDOW_PRESETS, 'win_triple_60x60', 'win_triple_80x120', 'win_triple_100x120', 'win_triple_120x140') },
      { label: 'Doppelverglasung Wärmeschutz — 1995 bis 2015', items: op(WINDOW_PRESETS, 'win_double_80x120', 'win_double_100x120', 'win_double_120x140', 'win_double_150x140', 'win_double_200x140') },
      { label: 'Ältere Verglasung (TABULA DE, vor 1995)',       items: op(WINDOW_PRESETS, 'win_old_80x120', 'win_old_120x140', 'win_single_80x120', 'win_single_120x140') },
    ],
  },
  {
    title: 'Türen',
    source: 'GEG 2023 · TABULA DE',
    subs: [
      { label: 'Innentüren',  items: op(DOOR_PRESETS, 'door_int_75', 'door_int_87', 'door_int_100') },
      { label: 'Außentüren',  items: op(DOOR_PRESETS, 'door_ext_100', 'door_ext_125', 'door_ext_old') },
    ],
  },
  {
    title: 'Garagentore',
    source: 'Herstellerdaten',
    subs: [
      { label: 'Ungedämmte Sektionaltore', items: op(GARAGE_PRESETS, 'garage_240x200', 'garage_250x225', 'garage_300x225', 'garage_500x225') },
      { label: 'Gedämmte Sektionaltore',   items: op(GARAGE_PRESETS, 'garage_insul') },
    ],
  },
  {
    title: 'Bodenaufbauten',
    source: 'GEG 2023 · TABULA DE',
    subs: [
      { label: 'Bodenplatten (erdberührend)',  items: fp('floor_kfw40', 'floor_neubau', 'floor_2002', 'floor_1995', 'floor_altbau') },
      { label: 'Decken / Zwischenböden',       items: fp('floor_above', 'floor_ext') },
    ],
  },
];

// ── Main render function ──────────────────────────────────────────────────────

export function renderMaterialsView(container: HTMLElement, editor: Editor): void {
  const project  = editor.getProject() as Project;
  // undefined = legacy project; treat all as active so panel is unchanged
  const activeIds = project.activePresetIds !== undefined
    ? new Set(project.activePresetIds)
    : new Set(ALL_PRESET_IDS);

  container.innerHTML = '';
  const wrap = el('div', { class: 'mv-wrap' });
  container.appendChild(wrap);

  // ── Header ────────────────────────────────────────────
  const hdr = el('div', { class: 'mv-hdr' });
  hdr.appendChild(el('p', { class: 'mv-hdr-desc' },
    'Wählen Sie, welche Materialien in der Bibliothek (linke Leiste) erscheinen. ' +
    'Aktive Einträge sind hervorgehoben.'
  ));
  const btns = el('div', { class: 'mv-hdr-btns' });

  const mkBtn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = el('button', { class: 'btn btn-sm', title }) as HTMLButtonElement;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  btns.appendChild(mkBtn('Alle',     'Alle Standardmaterialien aktivieren',        () => apply([...ALL_PRESET_IDS])));
  btns.appendChild(mkBtn('Standard', 'Auf Standardauswahl zurücksetzen',           () => apply([...DEFAULT_ACTIVE_PRESET_IDS])));
  btns.appendChild(mkBtn('Keine',    'Alle Standardmaterialien deaktivieren',      () => apply([])));
  hdr.appendChild(btns);
  wrap.appendChild(hdr);

  function apply(ids: string[]): void {
    editor.updateProject({ activePresetIds: ids });
    // re-render is triggered via editor.onChange in main.ts
  }

  function toggle(id: string): void {
    const proj = editor.getProject() as Project;
    const cur  = proj.activePresetIds !== undefined ? new Set(proj.activePresetIds) : new Set(ALL_PRESET_IDS);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    apply([...cur]);
  }

  // ── Catalog sections ──────────────────────────────────
  for (const section of CATALOG) {
    const secEl = el('div', { class: 'mv-section' });
    const titleRow = el('div', { class: 'mv-section-head' });
    titleRow.appendChild(el('span', { class: 'mv-section-title' }, section.title));
    if (section.source) titleRow.appendChild(el('span', { class: 'mv-source' }, section.source));
    secEl.appendChild(titleRow);

    for (const sub of section.subs) {
      if (sub.items.length === 0) continue;
      secEl.appendChild(el('div', { class: 'mv-sub-title' }, sub.label));
      const grid = el('div', { class: 'mv-grid' });
      for (const item of sub.items) {
        grid.appendChild(makeCard(item, activeIds.has(item.id), toggle));
      }
      secEl.appendChild(grid);
    }
    wrap.appendChild(secEl);
  }

  // ── Custom presets ────────────────────────────────────
  const custom = loadCustomPresets();
  type CustomEntry = { id: string; name: string; value: string; badge: string };
  const allCustom: CustomEntry[] = [
    ...custom.walls.map(p       => ({ id: p.id, name: p.name, value: `U ${p.uValue.toFixed(2)} · ${p.thickness} mm`, badge: 'Wand' })),
    ...custom.windows.map(p     => ({ id: p.id, name: p.name, value: `U ${p.uValue.toFixed(1)} · ${p.width/10}×${p.height/10} cm`, badge: 'Fenster' })),
    ...custom.doors.map(p       => ({ id: p.id, name: p.name, value: `U ${p.uValue.toFixed(1)} · ${p.width/10}×${p.height/10} cm`, badge: 'Tür' })),
    ...custom.garageDoors.map(p => ({ id: p.id, name: p.name, value: `U ${p.uValue.toFixed(1)} · ${p.width/10}×${p.height/10} cm`, badge: 'Tor' })),
    ...custom.floors.map(p      => ({ id: p.id, name: p.name, value: `U ${p.uValue.toFixed(2)} W/m²K`, badge: 'Boden' })),
  ];

  const custSec = el('div', { class: 'mv-section' });
  const custHead = el('div', { class: 'mv-section-head' });
  custHead.appendChild(el('span', { class: 'mv-section-title' }, 'Eigene Typen'));
  custSec.appendChild(custHead);

  if (allCustom.length === 0) {
    custSec.appendChild(el('p', { class: 'mv-empty' },
      'Keine eigenen Materialien. Erstellen Sie welche über die + Schaltflächen in der linken Bibliothek.'
    ));
  } else {
    const grid = el('div', { class: 'mv-grid' });
    for (const item of allCustom) {
      const card = el('div', { class: 'mv-card mv-card--always' });
      const info = el('div', { class: 'mv-card-info' });
      const nameRow = el('div', { class: 'mv-card-name' });
      nameRow.appendChild(el('span', { class: 'mv-badge' }, item.badge));
      nameRow.appendChild(document.createTextNode(' ' + item.name));
      info.appendChild(nameRow);
      info.appendChild(el('div', { class: 'mv-card-value' }, item.value));
      card.appendChild(info);
      const delBtn = el('button', { class: 'btn btn-sm mv-btn-del', title: 'Löschen' }, '×') as HTMLButtonElement;
      delBtn.addEventListener('click', () => { removeCustomPreset(item.id); editor.invalidate(); renderMaterialsView(container, editor); });
      card.appendChild(delBtn);
      grid.appendChild(card);
    }
    custSec.appendChild(grid);
  }
  wrap.appendChild(custSec);
}

function makeCard(item: CItem, isActive: boolean, onToggle: (id: string) => void): HTMLDivElement {
  const card = el('div', { class: `mv-card${isActive ? ' mv-card--on' : ''}` });

  const info = el('div', { class: 'mv-card-info' });
  info.appendChild(el('div', { class: 'mv-card-name' }, item.name));
  info.appendChild(el('div', { class: 'mv-card-value' }, item.value));
  if (item.desc) info.appendChild(el('div', { class: 'mv-card-desc' }, item.desc));
  card.appendChild(info);

  const btn = el('button', {
    class: `btn btn-sm ${isActive ? 'mv-btn-on' : 'mv-btn-off'}`,
    title: isActive ? 'Aus Bibliothek entfernen' : 'Zur Bibliothek hinzufügen',
  }, isActive ? '✓' : '+') as HTMLButtonElement;
  btn.addEventListener('click', e => { e.stopPropagation(); onToggle(item.id); });
  card.appendChild(btn);

  card.addEventListener('click', () => onToggle(item.id));
  return card;
}
