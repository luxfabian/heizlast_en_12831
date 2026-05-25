import { v4 as uuidv4 } from '../utils/uuid.js';
import type { Project, HullGroup, Floor } from './types.js';
import { getWallPreset, DEFAULT_WALL_PRESET_ID } from '../library/presets.js';

export const DEFAULT_HULL_GROUPS: Omit<HullGroup, 'id'>[] = [
  { name: 'Außenhülle (netto)',      categories: ['exterior'],                               isDefault: true },
  { name: 'Außenhülle + Erdreich',   categories: ['exterior', 'ground'],                     isDefault: true },
  { name: 'Gesamthülle (thermisch)', categories: ['exterior', 'ground', 'unheated', 'adj_reduced'], isDefault: true },
  { name: 'Innenwände (beheizt)',    categories: ['adj_heated'],                              isDefault: true },
];

export function createDefaultFloor(): Floor {
  return {
    id: uuidv4(),
    level: 0,
    label: 'Erdgeschoss',
    defaultCeilingHeight: 2500,
    walls: [],
    openings: [],
    rooms: [],
  };
}

export function createDefaultProject(name = 'Neues Projekt'): Project {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    name,
    plz: '',
    floors: [createDefaultFloor()],
    hullGroups: DEFAULT_HULL_GROUPS.map(g => ({ ...g, id: uuidv4() })),
    createdAt: now,
    updatedAt: now,
  };
}

/** Default U-value and thickness from the active wall preset */
export function defaultWallUValue(): number {
  return getWallPreset(DEFAULT_WALL_PRESET_ID)?.uValue ?? 0.20;
}
export function defaultWallThickness(): number {
  return getWallPreset(DEFAULT_WALL_PRESET_ID)?.thickness ?? 300;
}
