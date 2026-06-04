import type { WallTypePreset, OpeningTypePreset, CeilingTypePreset } from './presets.js';

const KEY = 'heizlast_custom_presets';

export interface CustomPresets {
  walls:       WallTypePreset[];
  windows:     OpeningTypePreset[];
  doors:       OpeningTypePreset[];
  garageDoors: OpeningTypePreset[];
  floors:      CeilingTypePreset[];
}

function empty(): CustomPresets {
  return { walls: [], windows: [], doors: [], garageDoors: [], floors: [] };
}

export function loadCustomPresets(): CustomPresets {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<CustomPresets>;
    return {
      walls:       Array.isArray(parsed.walls)       ? parsed.walls       : [],
      windows:     Array.isArray(parsed.windows)     ? parsed.windows     : [],
      doors:       Array.isArray(parsed.doors)       ? parsed.doors       : [],
      garageDoors: Array.isArray(parsed.garageDoors) ? parsed.garageDoors : [],
      floors:      Array.isArray(parsed.floors)      ? parsed.floors      : [],
    };
  } catch {
    return empty();
  }
}

export function saveCustomPresets(presets: CustomPresets): void {
  localStorage.setItem(KEY, JSON.stringify(presets));
}

export function addCustomWallPreset(preset: WallTypePreset): void {
  const cp = loadCustomPresets();
  cp.walls = cp.walls.filter(p => p.id !== preset.id);
  cp.walls.push(preset);
  saveCustomPresets(cp);
}

export function addCustomOpeningPreset(preset: OpeningTypePreset): void {
  const cp = loadCustomPresets();
  const key = preset.type === 'window' ? 'windows' : preset.type === 'door' ? 'doors' : 'garageDoors';
  cp[key] = (cp[key] as OpeningTypePreset[]).filter(p => p.id !== preset.id);
  (cp[key] as OpeningTypePreset[]).push(preset);
  saveCustomPresets(cp);
}

export function addCustomFloorPreset(preset: CeilingTypePreset): void {
  const cp = loadCustomPresets();
  cp.floors = cp.floors.filter(p => p.id !== preset.id);
  cp.floors.push(preset);
  saveCustomPresets(cp);
}

export function removeCustomPreset(id: string): void {
  const cp = loadCustomPresets();
  cp.walls       = cp.walls.filter(p => p.id !== id);
  cp.windows     = cp.windows.filter(p => p.id !== id);
  cp.doors       = cp.doors.filter(p => p.id !== id);
  cp.garageDoors = cp.garageDoors.filter(p => p.id !== id);
  cp.floors      = cp.floors.filter(p => p.id !== id);
  saveCustomPresets(cp);
}

export function mergeCustomPresets(incoming: Partial<CustomPresets>): void {
  const cp = loadCustomPresets();
  if (Array.isArray(incoming.walls))       for (const p of incoming.walls)       { cp.walls       = cp.walls.filter(x => x.id !== p.id);       cp.walls.push(p); }
  if (Array.isArray(incoming.windows))     for (const p of incoming.windows)     { cp.windows     = cp.windows.filter(x => x.id !== p.id);     cp.windows.push(p); }
  if (Array.isArray(incoming.doors))       for (const p of incoming.doors)       { cp.doors       = cp.doors.filter(x => x.id !== p.id);       cp.doors.push(p); }
  if (Array.isArray(incoming.garageDoors)) for (const p of incoming.garageDoors) { cp.garageDoors = cp.garageDoors.filter(x => x.id !== p.id); cp.garageDoors.push(p); }
  if (Array.isArray(incoming.floors))      for (const p of incoming.floors)      { cp.floors      = cp.floors.filter(x => x.id !== p.id);      cp.floors.push(p); }
  saveCustomPresets(cp);
}
