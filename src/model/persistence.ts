import type { Project } from './types.js';
import { createDefaultProject, DEFAULT_HULL_GROUPS } from './defaults.js';
import { v4 as uuidv4 } from '../utils/uuid.js';

const STORAGE_KEY = 'heizlast_project';

export function saveProject(project: Project): void {
  project.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

export function clearProject(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function loadProject(): Project {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return createDefaultProject();
  try {
    return migrateProject(JSON.parse(raw));
  } catch {
    return createDefaultProject();
  }
}

/** Ensure any project loaded from storage (possibly old format) has all required fields */
export function migrateProject(p: unknown): Project {
  if (!p || typeof p !== 'object') return createDefaultProject();
  const proj = p as Record<string, unknown>;

  if (!Array.isArray(proj.floors) || (proj.floors as unknown[]).length === 0) return createDefaultProject();

  for (let fi = 0; fi < (proj.floors as Record<string, unknown>[]).length; fi++) {
    const f = (proj.floors as Record<string, unknown>[])[fi];
    if (!f.id)                      f.id       = uuidv4();
    if (f.level === undefined)      f.level    = fi;
    if (!f.label)                   f.label    = fi === 0 ? 'EG' : `${fi}. OG`;
    if (!Array.isArray(f.walls))    f.walls    = [];
    if (!Array.isArray(f.openings)) f.openings = [];
    if (!Array.isArray(f.rooms))    f.rooms    = [];
    if (!f.defaultCeilingHeight)    f.defaultCeilingHeight = 2500;

    for (const w of f.walls as Record<string, unknown>[]) {
      if (!Array.isArray(w.constraints)) w.constraints = [];
      if (typeof w.uValue     !== 'number') w.uValue     = 0.20;
      if (typeof w.thickness  !== 'number') w.thickness  = 300;
      if (!w.boundaryCategory) w.boundaryCategory = 'exterior';
      if (!w.start || typeof (w.start as Record<string, unknown>).x !== 'number') w.start = { x: 0, y: 0 };
      if (!w.end   || typeof (w.end   as Record<string, unknown>).x !== 'number') w.end   = { x: 0, y: 0 };
    }

    for (const op of f.openings as Record<string, unknown>[]) {
      if (typeof op.uValue             !== 'number') op.uValue             = 1.1;
      if (typeof op.positionAlongWall  !== 'number') op.positionAlongWall  = 0;
      if (typeof op.width              !== 'number') op.width              = 1200;
      if (typeof op.height             !== 'number') op.height             = 1200;
      if (!op.type) op.type = 'window';
    }

    for (const r of f.rooms as Record<string, unknown>[]) {
      if (!Array.isArray(r.wallIds))              r.wallIds           = [];
      if (typeof r.designTemperature !== 'number') r.designTemperature = 20;
      if (typeof r.ceilingHeight     !== 'number') r.ceilingHeight     = 2500;
      if (!r.floorType) r.floorType = 'ground';
      if (!Array.isArray(r.floors))   r.floors   = [];
      if (!Array.isArray(r.ceilings)) r.ceilings = [];
    }
  }

  // Backfill labels for elements created before auto-labelling was introduced
  {
    type RawFloor = { walls: Record<string, unknown>[]; openings: Record<string, unknown>[] };
    const floors = proj.floors as RawFloor[];

    // Pass 1: find highest existing number per type
    let wallMax = 0, winMax = 0, doorMax = 0, gdMax = 0;
    for (const f of floors) {
      for (const w of f.walls) {
        const m = typeof w.label === 'string' ? w.label.match(/(\d+)$/) : null;
        if (m) wallMax = Math.max(wallMax, parseInt(m[1], 10));
      }
      for (const o of f.openings) {
        const m = typeof o.label === 'string' ? o.label.match(/(\d+)$/) : null;
        if (m) {
          if (o.type === 'window')           winMax  = Math.max(winMax,  parseInt(m[1], 10));
          else if (o.type === 'door')        doorMax = Math.max(doorMax, parseInt(m[1], 10));
          else if (o.type === 'garage_door') gdMax   = Math.max(gdMax,   parseInt(m[1], 10));
        }
      }
    }

    // Pass 2: assign labels to unlabelled elements
    for (const f of floors) {
      for (const w of f.walls) {
        if (!w.label) w.label = `Wandsegment ${++wallMax}`;
      }
      for (const o of f.openings) {
        if (!o.label) {
          if (o.type === 'window')           o.label = `Fenster ${++winMax}`;
          else if (o.type === 'door')        o.label = `Tür ${++doorMax}`;
          else if (o.type === 'garage_door') o.label = `Garagentor ${++gdMax}`;
        }
      }
    }
  }

  if (!Array.isArray(proj.hullGroups)) {
    proj.hullGroups = DEFAULT_HULL_GROUPS.map(g => ({ ...g, id: uuidv4() }));
  } else {
    // Rename outdated default hull group names to current convention
    const RENAMES: Record<string, string> = {
      'Außenhülle (netto)':      'Außenhülle',
      'Außenhülle netto':        'Außenhülle',
      'Außenhülle + Erdreich':   'Äußere Gesamthülle',
      'Außenhülle mit Erdreich': 'Äußere Gesamthülle',
      'Gesamthülle (thermisch)': 'Thermische Gesamthülle',
      'Innenwände (beheizt)':    'Beheizte Innenflächen',
      'Innenwände beheizt':      'Beheizte Innenflächen',
      'Beheizte Innenwände':     'Beheizte Innenflächen',
    };
    for (const hg of proj.hullGroups as Record<string, unknown>[]) {
      if (typeof hg.name === 'string' && RENAMES[hg.name]) hg.name = RENAMES[hg.name];
    }
  }

  if (!proj.id)        proj.id        = uuidv4();
  if (!proj.name)      proj.name      = 'Projekt';
  if (!proj.plz)       proj.plz       = '';
  if (!proj.createdAt) proj.createdAt = new Date().toISOString();
  if (!proj.updatedAt) proj.updatedAt = new Date().toISOString();

  return proj as unknown as Project;
}

export function exportProjectJSON(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/\s+/g, '_')}.heizlast.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importProjectJSON(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        resolve(migrateProject(JSON.parse(e.target!.result as string)));
      } catch {
        reject(new Error('Ungültige Projektdatei'));
      }
    };
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    reader.readAsText(file);
  });
}
