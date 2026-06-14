import type { Floor, Room, Project } from '../model/types.js';
import type { Editor } from '../editor/editorState.js';
import { wallLength } from '../editor/geometry.js';

// Persist expand/collapse state across re-renders
const expandedRooms  = new Set<string>();
const floorExpanded  = new Map<string, boolean>();

// ---- DOM helper ----

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {},
  ...children: (HTMLElement | Text | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

// ---- Main entry ----

export function renderRoomPanel(
  container: HTMLElement,
  project: Project,
  activeFloorIndex: number,
  editor?: Editor,
): void {
  container.innerHTML = '';

  // Add floor button
  if (editor) {
    const addBtn = el('button', { class: 'btn btn-sm floor-add-btn' }, '+ Etage');
    addBtn.addEventListener('click', () => editor.addFloor());
    container.appendChild(addBtn);
  }

  const floors    = project.floors;
  const canRemove = floors.length > 1;

  if (floors.length === 0) return;

  for (let fi = 0; fi < floors.length; fi++) {
    const floor    = floors[fi];
    const isActive = fi === activeFloorIndex;

    // Determine expansion state: use explicit choice if set, else default = active floor open
    const isExpanded = floorExpanded.has(floor.id) ? floorExpanded.get(floor.id)! : isActive;

    // ---- Floor section header ----
    const header = el('div', { class: `floor-section-header${isActive ? ' active' : ''}` });

    const toggleArrow = el('span', { class: 'floor-section-toggle' }, isExpanded ? '▾' : '▸');
    header.appendChild(toggleArrow);

    const label = el('span', { class: 'floor-section-label' }, floor.label);
    header.appendChild(label);

    if (editor && floors.length > 1) {
      const upBtn = el('button', {
        class: 'btn btn-xs floor-reorder-btn', title: 'Etage nach oben',
        ...(fi === 0 ? { disabled: '' } : {}),
      }, '↑') as HTMLButtonElement;
      upBtn.addEventListener('click', e => { e.stopPropagation(); editor.reorderFloor(floor.id, 'up'); });
      header.appendChild(upBtn);

      const downBtn = el('button', {
        class: 'btn btn-xs floor-reorder-btn', title: 'Etage nach unten',
        ...(fi === floors.length - 1 ? { disabled: '' } : {}),
      }, '↓') as HTMLButtonElement;
      downBtn.addEventListener('click', e => { e.stopPropagation(); editor.reorderFloor(floor.id, 'down'); });
      header.appendChild(downBtn);
    }

    let removeBtn: HTMLButtonElement | null = null;
    if (canRemove && editor) {
      removeBtn = el('button', { class: 'btn btn-xs floor-remove-btn', title: `Etage "${floor.label}" löschen` }, '×') as HTMLButtonElement;
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (confirm(`Etage "${floor.label}" und alle zugehörigen Räume löschen?`)) {
          floorExpanded.delete(floor.id);
          editor.removeFloor(floor.id);
        }
      });
      header.appendChild(removeBtn);
    }

    // ---- Collapsible floor body ----
    const floorBody = el('div', { class: 'floor-section-body' });
    floorBody.style.display = isExpanded ? '' : 'none';

    if (floor.rooms.length === 0) {
      floorBody.appendChild(el('div', { class: 'room-empty' }, 'Noch keine Räume erkannt'));
    } else {
      for (const room of floor.rooms) {
        floorBody.appendChild(makeRoomEntry(room, floor, editor));
      }
    }

    // Click: activate floor (if not active) and expand; toggle expand if already active.
    // Always select the floor so the property panel shows its details.
    header.addEventListener('click', e => {
      if (removeBtn && (e.target === removeBtn || removeBtn.contains(e.target as Node))) return;
      if (editor) editor.selectFloor(floor.id);
      if (!isActive && editor) {
        floorExpanded.set(floor.id, true);
        editor.setActiveFloor(fi);
      } else {
        const nowExpanded = floorBody.style.display !== 'none';
        floorExpanded.set(floor.id, !nowExpanded);
        toggleArrow.textContent = !nowExpanded ? '▾' : '▸';
        floorBody.style.display = !nowExpanded ? '' : 'none';
      }
    });

    container.appendChild(header);
    container.appendChild(floorBody);
  }
}

// ---- Room entry (header + collapsible body) ----

function makeRoomEntry(room: Room, floor: Floor, editor?: Editor): HTMLDivElement {
  const isCollapsed = !expandedRooms.has(room.id);
  const entry = el('div', { class: 'room-entry' });

  // Header
  const header = el('div', { class: 'room-entry-header' });
  const toggle = el('button', { class: 'room-toggle-btn' }, isCollapsed ? '▸' : '▾');

  const info = el('div', { class: 'room-entry-info' });
  info.appendChild(el('span', { class: 'room-entry-name' }, room.label));

  const meta = el('span', { class: 'room-entry-meta' });
  const parts: (HTMLElement | string)[] = [`${room.designTemperature} °C`];
  if (room.area != null) parts.push(` · ${room.area.toFixed(1)} m²`);
  if (room.heizlastResult) {
    const lossSpan = el('span', { class: 'room-heat-val' },
      ` · ${Math.round(room.heizlastResult.totalLoss)} W`);
    parts.push(lossSpan);
  }
  for (const p of parts) meta.appendChild(typeof p === 'string' ? document.createTextNode(p) : p);
  info.appendChild(meta);

  header.appendChild(toggle);
  header.appendChild(info);
  entry.appendChild(header);

  // Body
  const body = el('div', { class: 'room-entry-body' });
  body.style.display = isCollapsed ? 'none' : '';
  buildRoomBody(body, room, floor, editor);
  entry.appendChild(body);

  const doToggle = () => {
    if (expandedRooms.has(room.id)) expandedRooms.delete(room.id);
    else expandedRooms.add(room.id);
    const c = !expandedRooms.has(room.id);
    toggle.textContent = c ? '▸' : '▾';
    body.style.display = c ? 'none' : '';
  };

  toggle.addEventListener('click', doToggle);
  header.addEventListener('click', e => { if (e.target !== toggle) doToggle(); });

  return entry;
}

// ---- Room body: element breakdown table ----

function buildRoomBody(container: HTMLElement, room: Room, floor: Floor, editor?: Editor): void {
  const table = el('table', { class: 'room-breakdown-table' });
  const thead = el('thead');

  if (room.heizlastResult) {
    thead.appendChild(el('tr', {},
      el('th', {}, 'Element'),
      el('th', { class: 'num' }, 'm²'),
      el('th', { class: 'num' }, 'W'),
    ));
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const row of room.heizlastResult.elementBreakdown) {
      const { label, wallId, openingId } = elementLabel(row.elementId, row.elementType, floor, room);
      const lossW    = Math.round(row.heatLoss);
      const canClick = !!(wallId || openingId);
      const tr = el('tr', { class: [row.heatLoss < 0.5 ? 'row-zero' : '', canClick ? 'row-clickable' : ''].join(' ').trim() },
        el('td', {}, label),
        el('td', { class: 'num' }, `${row.area.toFixed(2)}`),
        el('td', { class: 'num loss-val' }, `${lossW}`),
      );
      if (canClick && editor) {
        tr.addEventListener('click',      () => editor.highlightElement(wallId, openingId));
        tr.addEventListener('mouseleave', () => editor.highlightElement());
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    const tfoot = el('tfoot');
    const { transmissionLoss, ventilationLoss, totalLoss } = room.heizlastResult;
    tfoot.appendChild(el('tr', { class: 'foot-transmission' },
      el('td', {}, 'Σ Transmission'), el('td', { class: 'num' }, ''),
      el('td', { class: 'num loss-val' }, `${Math.round(transmissionLoss)}`),
    ));
    tfoot.appendChild(el('tr', { class: 'foot-ventilation' },
      el('td', {}, 'Σ Lüftung'), el('td', { class: 'num' }, ''),
      el('td', { class: 'num loss-val' }, `${Math.round(ventilationLoss)}`),
    ));
    tfoot.appendChild(el('tr', { class: 'foot-total' },
      el('td', {}, 'Gesamt'), el('td', { class: 'num' }, ''),
      el('td', { class: 'num loss-val' }, `${Math.round(totalLoss)} W`),
    ));
    table.appendChild(tfoot);

  } else {
    thead.appendChild(el('tr', {},
      el('th', {}, 'Element'),
      el('th', { class: 'num' }, 'm²'),
    ));
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const wallId of room.wallIds) {
      const wall = floor.walls.find(w => w.id === wallId);
      if (!wall) continue;
      const wallOpenings = floor.openings.filter(o => o.wallId === wallId);
      const grossM2  = (wallLength(wall.start, wall.end) * room.ceilingHeight) / 1e6;
      const openM2   = wallOpenings.reduce((s, o) => s + (o.width * o.height) / 1e6, 0);
      const netM2    = Math.max(0, grossM2 - openM2);
      const tr = el('tr', { class: 'row-clickable' },
        el('td', {}, wall.label ?? 'Wand'),
        el('td', { class: 'num' }, `${netM2.toFixed(2)}`),
      );
      if (editor) {
        tr.addEventListener('click',      () => editor.highlightElement(wall.id));
        tr.addEventListener('mouseleave', () => editor.highlightElement());
      }
      tbody.appendChild(tr);

      for (const op of wallOpenings) {
        const opLabel = op.label ?? (op.type === 'window' ? 'Fenster' : op.type === 'door' ? 'Tür' : 'Garagentor');
        const opTr = el('tr', { class: 'row-opening row-clickable' },
          el('td', {}, `↳ ${opLabel}`),
          el('td', { class: 'num' }, `${((op.width * op.height) / 1e6).toFixed(2)}`),
        );
        if (editor) {
          opTr.addEventListener('click',      () => editor.highlightElement(undefined, op.id));
          opTr.addEventListener('mouseleave', () => editor.highlightElement());
        }
        tbody.appendChild(opTr);
      }
    }

    if (room.area != null) {
      tbody.appendChild(el('tr', {}, el('td', {}, 'Boden'), el('td', { class: 'num' }, `${room.area.toFixed(2)}`)));
      tbody.appendChild(el('tr', {}, el('td', {}, 'Decke'), el('td', { class: 'num' }, `${room.area.toFixed(2)}`)));
    }

    table.appendChild(tbody);
    container.appendChild(table);
    container.appendChild(el('div', { class: 'room-no-calc' }, '→ Berechnen für Wärmeverluste'));
    return;
  }

  container.appendChild(table);
}

// ---- Element label with numbering ----

function elementLabel(
  elementId: string,
  elementType: string,
  floor: Floor,
  room: Room,
): { label: string; wallId?: string; openingId?: string } {
  switch (elementType) {
    case 'wall': {
      const wall = floor.walls.find(w => w.id === elementId);
      if (!wall) return { label: 'Wand' };
      return { label: wall.label ?? 'Wand', wallId: wall.id };
    }
    case 'window':
    case 'door':
    case 'garage_door': {
      const op   = floor.openings.find(o => o.id === elementId);
      const base = elementType === 'window' ? 'Fenster' : elementType === 'door' ? 'Tür' : 'Garagentor';
      return { label: op?.label ?? base, openingId: elementId };
    }
    case 'floor': {
      const idx   = parseInt(elementId.split('_floor_')[1] ?? '0', 10);
      const flr   = room.floors?.[idx];
      const label = flr?.label ?? (room.floors?.length > 1 ? `Boden ${idx + 1}` : 'Boden');
      return { label };
    }
    case 'ceiling': {
      const idx   = parseInt(elementId.split('_ceiling_')[1] ?? '0', 10);
      const ceil  = room.ceilings?.[idx];
      const label = ceil?.label ?? (room.ceilings?.length > 1 ? `Decke ${idx + 1}` : 'Decke');
      return { label };
    }
    default:
      return { label: elementType };
  }
}
