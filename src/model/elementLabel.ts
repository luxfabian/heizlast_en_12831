import type { Project } from './types.js';

const FALLBACK: Record<string, string> = {
  wall: 'Wand', window: 'Fenster', door: 'Tür',
  garage_door: 'Garagentor', floor: 'Boden', ceiling: 'Decke',
};

/**
 * Returns the human-readable label for a thermal element identified by its ID.
 * Falls back to the generic German type name when no label has been assigned.
 */
export function getElementName(project: Project, elementId: string, elementType: string): string {
  for (const floor of project.floors) {
    switch (elementType) {
      case 'wall': {
        const w = floor.walls.find(w => w.id === elementId);
        if (w) return w.label ?? FALLBACK.wall;
        break;
      }
      case 'window':
      case 'door':
      case 'garage_door': {
        const o = floor.openings.find(o => o.id === elementId);
        if (o) return o.label ?? (FALLBACK[elementType] ?? elementType);
        break;
      }
      case 'floor': {
        for (const room of floor.rooms) {
          const s = room.floors?.find(s => s.id === elementId);
          if (s) return s.label ?? FALLBACK.floor;
        }
        break;
      }
      case 'ceiling': {
        for (const room of floor.rooms) {
          const s = room.ceilings?.find(s => s.id === elementId);
          if (s) return s.label ?? FALLBACK.ceiling;
        }
        break;
      }
    }
  }
  return FALLBACK[elementType] ?? elementType;
}
