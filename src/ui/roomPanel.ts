import type { Floor, Room } from '../model/types.js';
import { getBoundaryCategoryLabel } from '../editor/adjacency.js';
import { wallLength } from '../editor/geometry.js';

// Track which rooms are EXPANDED (default = all collapsed)
const expandedRooms = new Set<string>();

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

export function renderRoomPanel(container: HTMLElement, floor: Floor): void {
  container.innerHTML = '';
  const rooms = floor.rooms;

  if (rooms.length === 0) {
    container.appendChild(el('div', { class: 'room-empty' }, 'Noch keine Räume erkannt'));
    return;
  }

  for (const room of rooms) {
    container.appendChild(makeRoomEntry(room, floor));
  }
}

// ---- Room entry (header + collapsible body) ----

function makeRoomEntry(room: Room, floor: Floor): HTMLDivElement {
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
  buildRoomBody(body, room, floor);
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

function buildRoomBody(container: HTMLElement, room: Room, floor: Floor): void {
  const table = el('table', { class: 'room-breakdown-table' });
  const thead = el('thead');

  if (room.heizlastResult) {
    thead.appendChild(el('tr', {},
      el('th', {}, 'Element'),
      el('th', { class: 'num' }, 'Fläche'),
      el('th', { class: 'num' }, 'Verlust'),
    ));
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const row of room.heizlastResult.elementBreakdown) {
      const label = elementLabel(row.elementId, row.elementType, floor);
      const lossW = Math.round(row.heatLoss);
      const tr = el('tr', { class: row.heatLoss < 0.5 ? 'row-zero' : '' },
        el('td', {}, label),
        el('td', { class: 'num' }, `${row.area.toFixed(2)}`),
        el('td', { class: 'num loss-val' }, `${lossW}`),
      );
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    // Totals footer
    const tfoot = el('tfoot');
    const { transmissionLoss, ventilationLoss, totalLoss } = room.heizlastResult;
    tfoot.appendChild(el('tr', { class: 'foot-transmission' },
      el('td', {}, 'Σ Transmission'),
      el('td', { class: 'num' }, ''),
      el('td', { class: 'num loss-val' }, `${Math.round(transmissionLoss)}`),
    ));
    tfoot.appendChild(el('tr', { class: 'foot-ventilation' },
      el('td', {}, 'Σ Lüftung'),
      el('td', { class: 'num' }, ''),
      el('td', { class: 'num loss-val' }, `${Math.round(ventilationLoss)}`),
    ));
    tfoot.appendChild(el('tr', { class: 'foot-total' },
      el('td', {}, 'Gesamt'),
      el('td', { class: 'num' }, ''),
      el('td', { class: 'num loss-val' }, `${Math.round(totalLoss)} W`),
    ));
    table.appendChild(tfoot);

  } else {
    // Geometry-only: show areas without heat loss
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
      const grossM2 = (wallLength(wall.start, wall.end) * room.ceilingHeight) / 1e6;
      const openM2  = wallOpenings.reduce((s, o) => s + (o.width * o.height) / 1e6, 0);
      const netM2   = Math.max(0, grossM2 - openM2);

      tbody.appendChild(el('tr', {},
        el('td', {}, getBoundaryCategoryLabel(wall.boundaryCategory)),
        el('td', { class: 'num' }, `${netM2.toFixed(2)}`),
      ));

      for (const op of wallOpenings) {
        const opLabel = op.type === 'window' ? '↳ Fenster' : op.type === 'door' ? '↳ Tür' : '↳ Garagentor';
        tbody.appendChild(el('tr', { class: 'row-opening' },
          el('td', {}, opLabel),
          el('td', { class: 'num' }, `${((op.width * op.height) / 1e6).toFixed(2)}`),
        ));
      }
    }

    if (room.area != null) {
      tbody.appendChild(el('tr', {},
        el('td', {}, 'Boden'),
        el('td', { class: 'num' }, `${room.area.toFixed(2)}`),
      ));
      tbody.appendChild(el('tr', {},
        el('td', {}, 'Decke'),
        el('td', { class: 'num' }, `${room.area.toFixed(2)}`),
      ));
    }

    table.appendChild(tbody);
    container.appendChild(table);
    container.appendChild(el('div', { class: 'room-no-calc' }, '→ Berechnen für Wärmeverluste'));
    return;
  }

  container.appendChild(table);
}

// ---- Element label ----

function elementLabel(elementId: string, elementType: string, floor: Floor): string {
  switch (elementType) {
    case 'floor':       return 'Boden';
    case 'ceiling':     return 'Decke';
    case 'window':      return 'Fenster';
    case 'door':        return 'Tür';
    case 'garage_door': return 'Garagentor';
    case 'wall': {
      const wall = floor.walls.find(w => w.id === elementId);
      return wall ? getBoundaryCategoryLabel(wall.boundaryCategory) : 'Wand';
    }
    default: return elementType;
  }
}
