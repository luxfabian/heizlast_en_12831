import type { Project, Floor, WallSegment, Opening, Room, ThermalSurface, BoundaryCategory } from '../model/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function ext(id: string, sx: number, sy: number, ex: number, ey: number): WallSegment {
  return { id, start: { x: sx, y: sy }, end: { x: ex, y: ey },
           thickness: 300, uValue: 0.18, boundaryCategory: 'exterior' };
}
function int(id: string, sx: number, sy: number, ex: number, ey: number): WallSegment {
  return { id, start: { x: sx, y: sy }, end: { x: ex, y: ey },
           thickness: 120, uValue: 0.50, boundaryCategory: 'adj_heated' };
}
function win(id: string, wallId: string, pos: number, w = 1200, h = 1200): Opening {
  return { id, type: 'window', wallId, positionAlongWall: pos, width: w, height: h, uValue: 1.0 };
}
function door(id: string, wallId: string, pos: number, ext = false): Opening {
  return { id, type: 'door', wallId, positionAlongWall: pos, width: 900, height: 2100,
           uValue: ext ? 1.5 : 2.0 };
}
function gd(id: string, wallId: string, pos: number): Opening {
  return { id, type: 'garage_door', wallId, positionAlongWall: pos, width: 2500, height: 2000, uValue: 1.8 };
}
function surf(id: string, u: number, cat: BoundaryCategory): ThermalSurface {
  return { id, uValue: u, boundaryCategory: cat };
}

// ── Building: Einfamilienhaus 10 m × 8 m, 3 Etagen ──────────────────────────
//
// Coordinate system: x → east, y → south, origin at NW corner of building.
// All dimensions in mm.
//
// EG layout  (level 0)            OG layout  (level 1)
// ┌──────────┬────────────┐        ┌────────────────┬──────┐
// │ Garage   │ Küche      │        │                │Schl.2│
// │ 4500×4000│ 5500×4000  │        │ Schlafzimmer 1 ├──────┤
// ├──────────┴────────────┤        │ 6000×8000      │ Bad  │
// │ Wohnzimmer 10000×4000 │        │                │      │
// └───────────────────────┘        └────────────────┴──────┘
//
// DG layout (level 2)
// ┌───────────────────────┐
// │ Büro       10000×5000 │
// ├───────────────────────┤
// │ Abstellraum 10000×3000│
// └───────────────────────┘
//
// Cross-floor overlap highlights:
//  • Wohnzimmer (EG) has Schlafzimmer1 above its west half and Bad above its east half
//  • Schlafzimmer1 (OG) sits above Garage, a strip of Küche, and Wohnzimmer

export function createExampleProject(): Project {
  const ts = new Date().toISOString();

  // ── EG ─────────────────────────────────────────────────────────────────
  const egWalls: WallSegment[] = [
    { ...ext('e1',  0,     0,    4500,  0),      label: 'Wandsegment 1'  },  // N – Garage
    { ...ext('e2',  4500,  0,    10000, 0),      label: 'Wandsegment 2'  },  // N – Küche
    { ...ext('e3',  10000, 0,    10000, 4000),   label: 'Wandsegment 3'  },  // E – Küche
    { ...ext('e4',  10000, 4000, 10000, 8000),   label: 'Wandsegment 4'  },  // E – Wohnzimmer
    { ...ext('e5',  10000, 8000, 0,     8000),   label: 'Wandsegment 5'  },  // S – Wohnzimmer
    { ...ext('e6',  0,     8000, 0,     4000),   label: 'Wandsegment 6'  },  // W – Wohnzimmer
    { ...ext('e7',  0,     4000, 0,     0),      label: 'Wandsegment 7'  },  // W – Garage
    { ...int('e8',  4500,  0,    4500,  4000),   label: 'Wandsegment 8'  },  // Garage | Küche
    { ...int('e9',  0,     4000, 4500,  4000),   label: 'Wandsegment 9'  },  // Garage | Wohnzimmer
    { ...int('e10', 4500,  4000, 10000, 4000),   label: 'Wandsegment 10' },  // Küche  | Wohnzimmer
  ];
  const egOpenings: Opening[] = [
    { ...gd('eo1',   'e1', 750),              label: 'Garagentor 1' },  // Garagentor (N)
    { ...door('eo2', 'e2', 1000, true),       label: 'Tür 1'        },  // Eingangstür (N)
    { ...win('eo3',  'e3', 1000),             label: 'Fenster 1'    },  // Fenster Küche (E)
    { ...win('eo4',  'e4', 1000, 1500, 1200), label: 'Fenster 2'    },  // Fenster Wohnzimmer (E)
    { ...win('eo5',  'e5', 1500, 2000, 1200), label: 'Fenster 3'    },  // Fenster Wohnzimmer (S) 1
    { ...win('eo6',  'e5', 5500, 2000, 1200), label: 'Fenster 4'    },  // Fenster Wohnzimmer (S) 2
    { ...win('eo7',  'e6', 1000, 1500, 1200), label: 'Fenster 5'    },  // Fenster Wohnzimmer (W)
  ];
  const egRooms: Room[] = [
    {
      id: 'eg-garage', label: 'Garage',
      wallIds: ['e7','e1','e8','e9'],
      designTemperature: 5, ceilingHeight: 2500, roomType: 'unheated', area: 18,
      floors:   [surf('eg-garage-f', 0.25, 'ground')],
      ceilings: [surf('eg-garage-c', 0.40, 'adj_heated')],
    },
    {
      id: 'eg-kueche', label: 'Küche',
      wallIds: ['e2','e3','e10','e8'],
      designTemperature: 20, ceilingHeight: 2600, roomType: 'heated', area: 22,
      floors:   [surf('eg-kueche-f', 0.25, 'ground')],
      ceilings: [surf('eg-kueche-c', 0.40, 'adj_heated')],
    },
    {
      id: 'eg-wohn', label: 'Wohnzimmer',
      wallIds: ['e9','e10','e4','e5','e6'],
      designTemperature: 21, ceilingHeight: 2600, roomType: 'heated', area: 40,
      floors:   [surf('eg-wohn-f', 0.25, 'ground')],
      ceilings: [surf('eg-wohn-c', 0.40, 'adj_heated')],
    },
  ];
  const egFloor: Floor = {
    id: 'floor-eg', level: 0, label: 'Erdgeschoss',
    defaultCeilingHeight: 2600, walls: egWalls, openings: egOpenings, rooms: egRooms,
  };

  // ── 1. OG ───────────────────────────────────────────────────────────────
  const ogWalls: WallSegment[] = [
    { ...ext('o1',  0,     0,    6000,  0),      label: 'Wandsegment 11' },  // N – Schlafzimmer 1
    { ...ext('o2',  6000,  0,    10000, 0),      label: 'Wandsegment 12' },  // N – Schlafzimmer 2
    { ...ext('o3',  10000, 0,    10000, 4000),   label: 'Wandsegment 13' },  // E – Schlafzimmer 2
    { ...ext('o4',  10000, 4000, 10000, 8000),   label: 'Wandsegment 14' },  // E – Bad
    { ...ext('o5',  10000, 8000, 6000,  8000),   label: 'Wandsegment 15' },  // S – Bad
    { ...ext('o6',  6000,  8000, 0,     8000),   label: 'Wandsegment 16' },  // S – Schlafzimmer 1
    { ...ext('o7',  0,     8000, 0,     0),      label: 'Wandsegment 17' },  // W – Schlafzimmer 1
    { ...int('o8',  6000,  0,    6000,  4000),   label: 'Wandsegment 18' },  // Schlafzimmer 1 | Schlafzimmer 2
    { ...int('o9',  6000,  4000, 6000,  8000),   label: 'Wandsegment 19' },  // Schlafzimmer 1 | Bad
    { ...int('o10', 6000,  4000, 10000, 4000),   label: 'Wandsegment 20' },  // Schlafzimmer 2 | Bad
  ];
  const ogOpenings: Opening[] = [
    { ...win('oo1',  'o7', 1000, 1500, 1200), label: 'Fenster 6'  },  // Fenster Schl.1 (W) 1
    { ...win('oo2',  'o7', 5000, 1500, 1200), label: 'Fenster 7'  },  // Fenster Schl.1 (W) 2
    { ...win('oo3',  'o1', 1500, 1500, 1200), label: 'Fenster 8'  },  // Fenster Schl.1 (N)
    { ...win('oo4',  'o2',  500, 1500, 1200), label: 'Fenster 9'  },  // Fenster Schl.2 (N)
    { ...win('oo5',  'o4', 1500,  800,  800), label: 'Fenster 10' },  // Fenster Bad (E)
    { ...win('oo6',  'o6', 1000, 1500, 1200), label: 'Fenster 11' },  // Fenster Schl.1 (S)
    { ...door('oo7', 'o8', 1500),             label: 'Tür 2'      },  // Tür Schl.1 ↔ Schl.2
  ];
  const ogRooms: Room[] = [
    {
      id: 'og-schl1', label: 'Schlafzimmer 1',
      wallIds: ['o7','o1','o8','o9','o6'],
      designTemperature: 18, ceilingHeight: 2500, roomType: 'heated', area: 48,
      floors:   [surf('og-schl1-f', 0.40, 'adj_heated')],
      ceilings: [surf('og-schl1-c', 0.40, 'adj_heated')],
    },
    {
      id: 'og-schl2', label: 'Schlafzimmer 2',
      wallIds: ['o2','o3','o10','o8'],
      designTemperature: 18, ceilingHeight: 2500, roomType: 'heated', area: 16,
      floors:   [surf('og-schl2-f', 0.40, 'adj_heated')],
      ceilings: [surf('og-schl2-c', 0.40, 'adj_heated')],
    },
    {
      id: 'og-bad', label: 'Bad',
      wallIds: ['o10','o4','o5','o9'],
      designTemperature: 24, ceilingHeight: 2500, roomType: 'heated', area: 16,
      floors:   [surf('og-bad-f', 0.40, 'adj_heated')],
      ceilings: [surf('og-bad-c', 0.40, 'adj_heated')],
    },
  ];
  const ogFloor: Floor = {
    id: 'floor-og', level: 1, label: '1. Obergeschoss',
    defaultCeilingHeight: 2500, walls: ogWalls, openings: ogOpenings, rooms: ogRooms,
  };

  // ── Dachgeschoss ────────────────────────────────────────────────────────
  const dgWalls: WallSegment[] = [
    { ...ext('d1', 0,     0,    10000, 0),    label: 'Wandsegment 21' },  // N – Büro
    { ...ext('d2', 10000, 0,    10000, 5000), label: 'Wandsegment 22' },  // E – Büro
    { ...int('d3', 10000, 5000, 0,     5000), label: 'Wandsegment 23' },  // Büro | Abstellraum
    { ...ext('d4', 0,     5000, 0,     0),    label: 'Wandsegment 24' },  // W – Büro
    { ...ext('d5', 10000, 5000, 10000, 8000), label: 'Wandsegment 25' },  // E – Abstellraum
    { ...ext('d6', 10000, 8000, 0,     8000), label: 'Wandsegment 26' },  // S/Dach – Abstellraum
    { ...ext('d7', 0,     8000, 0,     5000), label: 'Wandsegment 27' },  // W – Abstellraum
  ];
  const dgOpenings: Opening[] = [
    { ...win('do1',  'd1', 1500, 1500, 1200), label: 'Fenster 12' },  // Fenster Büro (N) 1
    { ...win('do2',  'd1', 6500, 1500, 1200), label: 'Fenster 13' },  // Fenster Büro (N) 2
    { ...win('do3',  'd2', 1000, 1500, 1200), label: 'Fenster 14' },  // Fenster Büro (E)
    { ...win('do4',  'd4', 1000, 1500, 1200), label: 'Fenster 15' },  // Fenster Büro (W)
    { ...door('do5', 'd3', 4500),             label: 'Tür 3'      },  // Tür Büro ↔ Abstellraum
  ];
  const dgRooms: Room[] = [
    {
      id: 'dg-buero', label: 'Büro',
      wallIds: ['d4','d1','d2','d3'],
      designTemperature: 20, ceilingHeight: 2400, roomType: 'heated', area: 50,
      floors:   [surf('dg-buero-f', 0.40, 'adj_heated')],
      ceilings: [surf('dg-buero-c', 0.13, 'exterior')],
    },
    {
      id: 'dg-abstell', label: 'Abstellraum',
      wallIds: ['d3','d5','d6','d7'],
      designTemperature: 10, ceilingHeight: 2400, roomType: 'unheated', area: 30,
      floors:   [surf('dg-abstell-f', 0.40, 'adj_heated')],
      ceilings: [surf('dg-abstell-c', 0.13, 'exterior')],
    },
  ];
  const dgFloor: Floor = {
    id: 'floor-dg', level: 2, label: 'Dachgeschoss',
    defaultCeilingHeight: 2400, walls: dgWalls, openings: dgOpenings, rooms: dgRooms,
  };

  return {
    id: 'example-einfamilienhaus',
    name: 'Beispiel: Einfamilienhaus',
    plz: '80331',
    designTemperatureOverride: -14,
    groundTemperature: 10,
    uncertainty: { uRelPct: 5, aRelPct: 5, nRelPct: 5 },
    floors: [egFloor, ogFloor, dgFloor],
    hullGroups: [
      { id: 'hg-1', name: 'Außenhülle',             categories: ['exterior'],                                               isDefault: true },
      { id: 'hg-2', name: 'Äußere Gesamthülle',     categories: ['exterior', 'ground'],                                    isDefault: true },
      { id: 'hg-3', name: 'Thermische Gesamthülle', categories: ['exterior', 'ground', 'unheated', 'adj_reduced', 'adj_neighbor'], isDefault: true },
      { id: 'hg-4', name: 'Beheizte Innenflächen',  categories: ['adj_heated'],                                            isDefault: true },
    ],
    createdAt: ts,
    updatedAt: ts,
  };
}
