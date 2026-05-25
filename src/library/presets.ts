import type { BoundaryCategory } from '../model/types.js';

export interface WallTypePreset {
  id: string;
  name: string;
  description: string;
  uValue: number;    // W/m²K
  thickness: number; // mm
  defaultCategory: BoundaryCategory;
}

export interface OpeningTypePreset {
  id: string;
  name: string;
  type: 'window' | 'door' | 'garage_door';
  width: number;  // mm
  height: number; // mm
  uValue: number; // W/m²K
}

export const WALL_PRESETS: WallTypePreset[] = [
  { id: 'aw_kfw40',   name: 'AW KfW40',    description: 'Außenwand KfW40',      uValue: 0.15, thickness: 380, defaultCategory: 'exterior' },
  { id: 'aw_kfw55',   name: 'AW KfW55',    description: 'Außenwand KfW55',      uValue: 0.20, thickness: 300, defaultCategory: 'exterior' },
  { id: 'aw_neubau',  name: 'AW Neubau',   description: 'Außenwand GEG2024',    uValue: 0.28, thickness: 240, defaultCategory: 'exterior' },
  { id: 'aw_altbau',  name: 'AW Altbau',   description: 'Außenwand unsaniert',  uValue: 0.80, thickness: 240, defaultCategory: 'exterior' },
  { id: 'iw_massiv',  name: 'IW Massiv',   description: 'Innenwand 17.5 cm',    uValue: 1.20, thickness: 175, defaultCategory: 'adj_heated' },
  { id: 'iw_std',     name: 'IW Standard', description: 'Innenwand 11.5 cm',    uValue: 2.00, thickness: 115, defaultCategory: 'adj_heated' },
  { id: 'iw_leicht',  name: 'IW Leicht',   description: 'Leichtbauwand 8 cm',   uValue: 2.50, thickness: 80,  defaultCategory: 'adj_heated' },
  { id: 'keller',     name: 'KW Keller',   description: 'Kellerwand Erdreich',  uValue: 0.50, thickness: 300, defaultCategory: 'ground' },
];

export const WINDOW_PRESETS: OpeningTypePreset[] = [
  { id: 'win_triple_60x60',    name: '60×60',    type: 'window', width: 600,  height: 600,  uValue: 0.8 },
  { id: 'win_triple_80x120',   name: '80×120',   type: 'window', width: 800,  height: 1200, uValue: 0.8 },
  { id: 'win_triple_100x120',  name: '100×120',  type: 'window', width: 1000, height: 1200, uValue: 0.8 },
  { id: 'win_triple_120x140',  name: '120×140',  type: 'window', width: 1200, height: 1400, uValue: 0.8 },
  { id: 'win_double_80x120',   name: '80×120 2×', type: 'window', width: 800,  height: 1200, uValue: 1.1 },
  { id: 'win_double_100x120',  name: '100×120 2×',type: 'window', width: 1000, height: 1200, uValue: 1.1 },
  { id: 'win_double_120x140',  name: '120×140 2×',type: 'window', width: 1200, height: 1400, uValue: 1.1 },
  { id: 'win_double_150x140',  name: '150×140',  type: 'window', width: 1500, height: 1400, uValue: 1.1 },
  { id: 'win_double_200x140',  name: '200×140',  type: 'window', width: 2000, height: 1400, uValue: 1.1 },
  { id: 'win_old_80x120',      name: '80×120 alt',type: 'window', width: 800,  height: 1200, uValue: 2.7 },
  { id: 'win_old_120x140',     name: '120×140 alt',type: 'window',width: 1200, height: 1400, uValue: 2.7 },
];

export const DOOR_PRESETS: OpeningTypePreset[] = [
  { id: 'door_int_75',    name: '75×200 innen',  type: 'door', width: 750,  height: 2000, uValue: 1.8 },
  { id: 'door_int_87',    name: '87.5×200',      type: 'door', width: 875,  height: 2000, uValue: 1.8 },
  { id: 'door_int_100',   name: '100×200 innen', type: 'door', width: 1000, height: 2000, uValue: 1.8 },
  { id: 'door_ext_100',   name: '100×200 außen', type: 'door', width: 1000, height: 2100, uValue: 1.3 },
  { id: 'door_ext_125',   name: '125×210 außen', type: 'door', width: 1250, height: 2100, uValue: 1.3 },
  { id: 'door_ext_old',   name: '100×200 alt',   type: 'door', width: 1000, height: 2000, uValue: 2.9 },
];

export const GARAGE_PRESETS: OpeningTypePreset[] = [
  { id: 'garage_240x200', name: '240×200',  type: 'garage_door', width: 2400, height: 2000, uValue: 2.5 },
  { id: 'garage_250x225', name: '250×225',  type: 'garage_door', width: 2500, height: 2250, uValue: 2.5 },
  { id: 'garage_300x225', name: '300×225',  type: 'garage_door', width: 3000, height: 2250, uValue: 2.5 },
  { id: 'garage_500x225', name: '500×225',  type: 'garage_door', width: 5000, height: 2250, uValue: 2.5 },
  { id: 'garage_insul',   name: '240×200 iso', type: 'garage_door', width: 2400, height: 2000, uValue: 1.0 },
];

/** All opening presets in one flat list */
export const ALL_OPENING_PRESETS: OpeningTypePreset[] = [
  ...WINDOW_PRESETS,
  ...DOOR_PRESETS,
  ...GARAGE_PRESETS,
];

export function getWallPreset(id: string): WallTypePreset | undefined {
  return WALL_PRESETS.find(p => p.id === id);
}

export function getOpeningPreset(id: string): OpeningTypePreset | undefined {
  return ALL_OPENING_PRESETS.find(p => p.id === id);
}

/** Default active presets for a fresh session */
export const DEFAULT_WALL_PRESET_ID    = 'aw_kfw55';
export const DEFAULT_WINDOW_PRESET_ID  = 'win_triple_120x140';
export const DEFAULT_DOOR_PRESET_ID    = 'door_int_87';
export const DEFAULT_GARAGE_PRESET_ID  = 'garage_240x200';
