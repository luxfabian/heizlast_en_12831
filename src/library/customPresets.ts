import type { WallTypePreset, OpeningTypePreset } from './presets.js';

const KEY = 'heizlast_custom_presets';

export interface CustomPresets {
  walls:       WallTypePreset[];
  windows:     OpeningTypePreset[];
  doors:       OpeningTypePreset[];
  garageDoors: OpeningTypePreset[];
}

function empty(): CustomPresets {
  return { walls: [], windows: [], doors: [], garageDoors: [] };
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

export function removeCustomPreset(id: string): void {
  const cp = loadCustomPresets();
  cp.walls       = cp.walls.filter(p => p.id !== id);
  cp.windows     = cp.windows.filter(p => p.id !== id);
  cp.doors       = cp.doors.filter(p => p.id !== id);
  cp.garageDoors = cp.garageDoors.filter(p => p.id !== id);
  saveCustomPresets(cp);
}
