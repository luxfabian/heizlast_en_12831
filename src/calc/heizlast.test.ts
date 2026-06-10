import { describe, it, expect } from 'vitest';
import { computeFij, calculateRoomHeizlast, calculateHeizlast, polygonIntersectionArea } from './heizlast.js';
import type { Room, Floor, WallSegment, Project, HullGroup, Opening } from '../model/types.js';
import { v4 as uuidv4 } from '../utils/uuid.js';

function makeWall(id: string, overrides: Partial<WallSegment> = {}): WallSegment {
  return {
    id,
    start: { x: 0, y: 0 },
    end:   { x: 5000, y: 0 }, // 5m
    thickness: 300,
    uValue: 0.20,
    boundaryCategory: 'exterior',
    ...overrides,
  };
}

function makeRoom(id: string, wallIds: string[], overrides: Partial<Room> = {}): Room {
  return {
    id,
    label: 'Testraum',
    wallIds,
    floors:   [{ id: `${id}_floor`, uValue: 0.25, boundaryCategory: 'ground' }],
    ceilings: [{ id: `${id}_ceil`,  uValue: 0.20, boundaryCategory: 'exterior' }],
    designTemperature: 20,
    ceilingHeight: 2500,
    floorType: 'ground',
    area: 20,
    ...overrides,
  };
}

function makeFloor(walls: WallSegment[], rooms: Room[], openings: Opening[] = []): Floor {
  return {
    id: uuidv4(),
    level: 0,
    label: 'EG',
    defaultCeilingHeight: 2500,
    walls,
    openings,
    rooms,
  };
}

// ------- fij tests -------

describe('computeFij', () => {
  it('exterior wall returns 1.0', () => {
    expect(computeFij({ tInt: 20, tAdj: -12, tE: -12, category: 'exterior' })).toBe(1.0);
  });

  it('adj_heated same temperature returns 0', () => {
    expect(computeFij({ tInt: 20, tAdj: 20, tE: -12, category: 'adj_heated' })).toBe(0);
  });

  it('adj_reduced different temperatures returns correct ratio', () => {
    const fij = computeFij({ tInt: 20, tAdj: 10, tE: -12, category: 'adj_reduced' });
    expect(fij).toBeCloseTo((20 - 10) / (20 - (-12)), 5);
  });

  it('ground uses (tInt − tGround) / (tInt − tE)', () => {
    const fij = computeFij({ tInt: 20, tAdj: 0, tE: -12, category: 'ground', tGround: 10 });
    expect(fij).toBeCloseTo((20 - 10) / (20 - (-12)), 5);
  });

  it('unheated with explicit space temp returns correct fij', () => {
    const fij = computeFij({ tInt: 20, tAdj: -12, tE: -12, category: 'unheated', unheatedSpaceTemp: 4 });
    expect(fij).toBeCloseTo((20 - 4) / (20 - (-12)), 5);
  });

  it('unheated without explicit temp defaults to midpoint', () => {
    const fij = computeFij({ tInt: 20, tAdj: -12, tE: -12, category: 'unheated' });
    expect(fij).toBeCloseTo(0.5, 5);
  });
});

// ------- Single room, single exterior wall -------

describe('calculateRoomHeizlast', () => {
  it('single exterior wall fij=1.0, formula verification', () => {
    const wall  = makeWall('w1', { end: { x: 4000, y: 0 }, uValue: 0.20, boundaryCategory: 'exterior' });
    const room  = makeRoom('r1', ['w1'], { designTemperature: 20, ceilingHeight: 2500, area: 16 });
    const floor = makeFloor([wall], [room]);
    const result = calculateRoomHeizlast(room, floor, -12, [room]);

    const wallEl = result.elementBreakdown.find(e => e.elementId === 'w1');
    expect(wallEl).toBeDefined();
    expect(wallEl!.fij).toBeCloseTo(1.0, 5);
    expect(wallEl!.area).toBeCloseTo(10, 2);          // 4m × 2.5m = 10m²
    expect(wallEl!.heatLoss).toBeCloseTo(10 * 0.20 * 1.0 * 32, 1); // 64W
  });

  it('net wall area subtracts opening', () => {
    const wall    = makeWall('w1', { end: { x: 4000, y: 0 }, uValue: 0.20, boundaryCategory: 'exterior' });
    const room    = makeRoom('r1', ['w1'], { area: 16 });
    const opening: Opening = { id: 'op1', type: 'window', wallId: 'w1', positionAlongWall: 1000, width: 1200, height: 1400, uValue: 1.1 };
    const floor   = makeFloor([wall], [room], [opening]);
    const result  = calculateRoomHeizlast(room, floor, -12, [room]);

    const wallEl = result.elementBreakdown.find(e => e.elementId === 'w1');
    const winEl  = result.elementBreakdown.find(e => e.elementId === 'op1');
    expect(wallEl!.area).toBeCloseTo(10 - 1.2 * 1.4, 3);
    expect(winEl!.area).toBeCloseTo(1.2 * 1.4, 3);
  });

  it('two adjacent rooms with same temperature have zero inter-room loss', () => {
    const sharedWall = makeWall('shared', { boundaryCategory: 'adj_heated', adjacentRoomId: 'r2' });
    const room1 = makeRoom('r1', ['shared'], { designTemperature: 20, area: 20 });
    const room2 = makeRoom('r2', ['shared'], { designTemperature: 20, area: 20 });
    const floor = makeFloor([sharedWall], [room1, room2]);
    const result = calculateRoomHeizlast(room1, floor, -12, [room1, room2]);
    const sharedEl = result.elementBreakdown.find(e => e.elementId === 'shared');
    expect(sharedEl!.fij).toBeCloseTo(0, 5);
    expect(sharedEl!.heatLoss).toBeCloseTo(0, 3);
  });

  it('mirror-symmetric rooms have equal total heat loads (adjacentRoomId bug regression)', () => {
    // Two 5 m × 5 m rooms side by side, sharing one central wall.
    // adjacentRoomId on the shared wall points to r1 — the bug caused r1 to use exterior
    // temperature for that wall instead of r2's temperature, inflating r1's heat load.
    const wallL  = makeWall('wL',  { start: {x:    0,y:    0}, end: {x:    0,y:5000} });
    const wallTL = makeWall('wTL', { start: {x:    0,y:    0}, end: {x: 5000,y:    0} });
    const wallBL = makeWall('wBL', { start: {x:    0,y:5000}, end: {x: 5000,y:5000} });
    const wallM  = makeWall('wM',  { start: {x: 5000,y:    0}, end: {x: 5000,y:5000},
                                     boundaryCategory: 'adj_heated', adjacentRoomId: 'r1' });
    const wallTR = makeWall('wTR', { start: {x: 5000,y:    0}, end: {x:10000,y:    0} });
    const wallBR = makeWall('wBR', { start: {x: 5000,y:5000}, end: {x:10000,y:5000} });
    const wallR  = makeWall('wR',  { start: {x:10000,y:    0}, end: {x:10000,y:5000} });
    const room1  = makeRoom('r1', ['wL','wTL','wM','wBL'], { designTemperature: 20, area: 25 });
    const room2  = makeRoom('r2', ['wR','wTR','wM','wBR'], { designTemperature: 20, area: 25 });
    const floor  = makeFloor([wallL,wallTL,wallBL,wallM,wallTR,wallBR,wallR], [room1,room2]);
    const res1 = calculateRoomHeizlast(room1, floor, -12, [room1, room2]);
    const res2 = calculateRoomHeizlast(room2, floor, -12, [room1, room2]);
    expect(res1.totalLoss).toBeCloseTo(res2.totalLoss, 1);
    const m1 = res1.elementBreakdown.find(e => e.elementId === 'wM');
    const m2 = res2.elementBreakdown.find(e => e.elementId === 'wM');
    expect(m1!.heatLoss).toBeCloseTo(0, 1);
    expect(m2!.heatLoss).toBeCloseTo(0, 1);
  });

  it('two adjacent rooms with different temperatures have correct fij', () => {
    const sharedWall = makeWall('shared', { boundaryCategory: 'adj_reduced', adjacentRoomId: 'r2' });
    const room1 = makeRoom('r1', ['shared'], { designTemperature: 20, area: 20 });
    const room2 = makeRoom('r2', ['shared'], { designTemperature: 15, area: 20 });
    const floor = makeFloor([sharedWall], [room1, room2]);
    const result = calculateRoomHeizlast(room1, floor, -12, [room1, room2]);
    const sharedEl = result.elementBreakdown.find(e => e.elementId === 'shared');
    expect(sharedEl!.fij).toBeCloseTo((20 - 15) / (20 - (-12)), 5);
  });

  it('ground floor slab fij = (tInt − tGround) / (tInt − tE)', () => {
    const room   = makeRoom('r1', [], { floorType: 'ground', area: 20 });
    const floor  = makeFloor([], [room]);
    const result = calculateRoomHeizlast(room, floor, -12, [room], 10);
    const floorEl = result.elementBreakdown.find(e => e.elementType === 'floor');
    expect(floorEl!.fij).toBeCloseTo((20 - 10) / (20 - (-12)), 5);  // 10/32 ≈ 0.3125
  });

  it('unheated buffer uses correct fij', () => {
    const wall   = makeWall('w1', { boundaryCategory: 'unheated', unheatedSpaceTemp: 4 });
    const room   = makeRoom('r1', ['w1'], { area: 20 });
    const floor  = makeFloor([wall], [room]);
    const result = calculateRoomHeizlast(room, floor, -12, [room]);
    const wallEl = result.elementBreakdown.find(e => e.elementId === 'w1');
    expect(wallEl!.fij).toBeCloseTo((20 - 4) / (20 - (-12)), 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHYSICS VERIFICATION — hand-computed reference values
//
// Formula recap:
//   Q_T = Σ  U · A · fij · (Ti − Te)
//   Q_V = 0.34 · V_m³ · n_h⁻¹ · (Ti − Te)
//   Q_HL = Q_T + Q_V
// ═══════════════════════════════════════════════════════════════════════════

describe('physics: complete box room', () => {
  // 4 m × 3 m plan, 2.5 m height, all walls thickness 200 mm.
  // wallInternalLengthMm deducts half-thickness (100 mm) at each connected vertex:
  //   Top / Bottom walls : (4000 − 100 − 100) mm = 3800 mm → 9.5 m²  each
  //   Left / Right walls : (3000 − 100 − 100) mm = 2800 mm → 7.0 m²  each
  //   Total wall area = 2×9.5 + 2×7.0 = 33.0 m²
  //
  // Te = −12 °C, Ti = 20 °C → ΔT = 32 K
  //   Q_T_walls = 33.0 × 0.25 × 1.0 × 32                         = 264.0 W
  //   Q_T_floor = 12.0 × 0.25 × (10/32) × 32  (ground, Tg=10°C) =  30.0 W
  //   Q_T_ceil  = 12.0 × 0.20 × 1.0 × 32      (exterior)         =  76.8 W
  //   Q_T = 370.8 W
  //   Q_V = 0.34 × (12 × 2.5) × 0.5 × 32                         = 163.2 W
  //   Q_HL = 534.0 W

  it('Q_T = 370.8 W, Q_V = 163.2 W, Q_HL = 534.0 W', () => {
    const T = 200; // wall thickness mm
    const walls: WallSegment[] = [
      makeWall('wT', { start: {x:    0, y:    0}, end: {x: 4000, y:    0}, thickness: T, uValue: 0.25, boundaryCategory: 'exterior' }),
      makeWall('wR', { start: {x: 4000, y:    0}, end: {x: 4000, y: 3000}, thickness: T, uValue: 0.25, boundaryCategory: 'exterior' }),
      makeWall('wB', { start: {x: 4000, y: 3000}, end: {x:    0, y: 3000}, thickness: T, uValue: 0.25, boundaryCategory: 'exterior' }),
      makeWall('wL', { start: {x:    0, y: 3000}, end: {x:    0, y:    0}, thickness: T, uValue: 0.25, boundaryCategory: 'exterior' }),
    ];
    const room = makeRoom('r1', ['wT', 'wR', 'wB', 'wL'], {
      designTemperature: 20,
      ceilingHeight: 2500,
      area: 12,
      floors:   [{ id: 'f1', uValue: 0.25, boundaryCategory: 'ground' }],
      ceilings: [{ id: 'c1', uValue: 0.20, boundaryCategory: 'exterior' }],
      minAirChanges: 0.5,
    });
    const floor = makeFloor(walls, [room]);
    const result = calculateRoomHeizlast(room, floor, -12, [room], 10);

    expect(result.transmissionLoss).toBeCloseTo(370.8, 1);
    expect(result.ventilationLoss).toBeCloseTo(163.2, 1);
    expect(result.totalLoss).toBeCloseTo(534.0, 1);
  });
});

describe('physics: pure ventilation loss', () => {
  // No walls, area = 0 → floor/ceiling calculations skipped.
  // volumeOverride = 60 m³, n = 1.0 h⁻¹, Te = −10 °C, Ti = 20 °C → ΔT = 30 K
  //   Q_V = 0.34 × 60 × 1.0 × 30 = 612 W
  //   Q_T = 0

  it('Q_V = 0.34 × V × n × ΔT = 612 W, Q_T = 0', () => {
    const room = makeRoom('r1', [], {
      designTemperature: 20,
      area: 0,
      volumeOverride: 60,
      minAirChanges: 1.0,
    });
    const floor = makeFloor([], [room]);
    const result = calculateRoomHeizlast(room, floor, -10, [room]);

    expect(result.transmissionLoss).toBeCloseTo(0, 3);
    expect(result.ventilationLoss).toBeCloseTo(612, 1);
    expect(result.totalLoss).toBeCloseTo(612, 1);
  });
});

describe('physics: window in exterior wall', () => {
  // Wall: start=(0,0) → end=(5000,0), no adjacent walls → no corner deduction.
  //   Gross area = 5.0 m × 2.5 m = 12.5 m²
  //   Window: 1.0 m × 1.5 m = 1.5 m², U_win = 1.2 W/m²K
  //   Net wall area = 12.5 − 1.5 = 11.0 m², U_wall = 0.3 W/m²K
  //
  // Te = −12 °C, Ti = 20 °C → ΔT = 32 K, fij = 1.0
  //   Q_T_wall   = 11.0 × 0.3 × 32 = 105.6 W
  //   Q_T_window =  1.5 × 1.2 × 32 =  57.6 W
  //   Q_T = 163.2 W   (area = 0 and volumeOverride = 0 → no floor/ceil/ventilation)

  it('net wall area subtracted; Q_T = 163.2 W', () => {
    const wall = makeWall('w1', { end: {x: 5000, y: 0}, uValue: 0.3, boundaryCategory: 'exterior' });
    const room = makeRoom('r1', ['w1'], {
      designTemperature: 20, ceilingHeight: 2500,
      area: 0, volumeOverride: 0,
    });
    const opening: Opening = {
      id: 'win1', type: 'window', wallId: 'w1',
      positionAlongWall: 1000, width: 1000, height: 1500, uValue: 1.2,
    };
    const floor = makeFloor([wall], [room], [opening]);
    const result = calculateRoomHeizlast(room, floor, -12, [room]);

    expect(result.transmissionLoss).toBeCloseTo(163.2, 1);
    expect(result.ventilationLoss).toBeCloseTo(0, 3);
  });
});

describe('physics: unheated buffer zone', () => {
  // Wall: start=(0,0) → end=(6000,0), no connections → 6.0 m × 2.5 m = 15.0 m²
  // T_buffer = 4 °C, Te = −12 °C, Ti = 20 °C
  //   fij = (20 − 4) / (20 − (−12)) = 16/32 = 0.5
  //   Q_T = 15 × 0.8 × 0.5 × 32 = 192 W
  //       ≡ U × A × (Ti − T_buf) = 15 × 0.8 × 16 = 192 W  ✓

  it('fij = 0.5 for T_buf = 4 °C; Q_T = 192 W', () => {
    const wall = makeWall('w1', { end: {x: 6000, y: 0}, uValue: 0.8, boundaryCategory: 'unheated', unheatedSpaceTemp: 4 });
    const room = makeRoom('r1', ['w1'], {
      designTemperature: 20, ceilingHeight: 2500,
      area: 0, volumeOverride: 0,
    });
    const floor = makeFloor([wall], [room]);
    const result = calculateRoomHeizlast(room, floor, -12, [room]);

    const el = result.elementBreakdown.find(e => e.elementId === 'w1')!;
    expect(el.fij).toBeCloseTo(0.5, 5);
    expect(result.transmissionLoss).toBeCloseTo(192, 1);
  });
});

describe('physics: adjacent neighbour building', () => {
  // Default neighbour temperature = 15 °C (hardcoded in computeFij for adj_neighbor).
  // Wall: start=(0,0) → end=(4000,0), no connections → 4.0 m × 2.5 m = 10.0 m²
  // Te = −12 °C, Ti = 20 °C
  //   fij = (20 − 15) / (20 − (−12)) = 5/32 ≈ 0.15625
  //   Q_T = 10 × 0.5 × (5/32) × 32 = 10 × 0.5 × 5 = 25 W

  it('adj_neighbor default T_n = 15 °C; Q_T = 25 W', () => {
    const wall = makeWall('w1', { end: {x: 4000, y: 0}, uValue: 0.5, boundaryCategory: 'adj_neighbor' });
    const room = makeRoom('r1', ['w1'], {
      designTemperature: 20, ceilingHeight: 2500,
      area: 0, volumeOverride: 0,
    });
    const floor = makeFloor([wall], [room]);
    const result = calculateRoomHeizlast(room, floor, -12, [room]);

    const el = result.elementBreakdown.find(e => e.elementId === 'w1')!;
    expect(el.fij).toBeCloseTo(5 / 32, 5);
    expect(result.transmissionLoss).toBeCloseTo(25, 1);
  });
});

describe('physics: two-room building total via calculateHeizlast', () => {
  // Room A (20 m²) and Room B (15 m²) share a wall (adj_heated, same Ti = 20 °C → fij = 0).
  // Each has one isolated exterior wall (no vertex sharing → no corner correction):
  //   extA: 5 m × 2.5 m = 12.5 m², U = 0.25 W/m²K
  //   extB: 5 m × 2.5 m = 12.5 m², U = 0.25 W/m²K
  //
  // Te = −12 °C, Ti = 20 °C → ΔT = 32 K, nMin = 0.5 h⁻¹
  //
  // Tg = 10°C (project default), fij_ground = (20-10)/32 = 10/32
  // Room A:
  //   Q_T = 12.5×0.25×32 + 20×0.25×(10/32)×32 + 20×0.20×32 = 100 + 50 + 128 = 278 W
  //   Q_V = 0.34 × (20 × 2.5) × 0.5 × 32 = 272 W  →  Q_A = 550 W
  //
  // Room B:
  //   Q_T = 12.5×0.25×32 + 15×0.25×(10/32)×32 + 15×0.20×32 = 100 + 37.5 + 96 = 233.5 W
  //   Q_V = 0.34 × (15 × 2.5) × 0.5 × 32 = 204 W  →  Q_B = 437.5 W
  //
  // Building total = 550 + 437.5 = 987.5 W

  it('building total Q_HL = 987.5 W', () => {
    const extA    = makeWall('wA', { start: {x:     0, y:     0}, end: {x: 5000, y:     0}, uValue: 0.25, boundaryCategory: 'exterior' });
    const extB    = makeWall('wB', { start: {x:     0, y: 10000}, end: {x: 5000, y: 10000}, uValue: 0.25, boundaryCategory: 'exterior' });
    const shared  = makeWall('wS', { start: {x:     0, y:  5000}, end: {x: 5000, y:  5000}, uValue: 0.50, boundaryCategory: 'adj_heated' });

    const roomA = makeRoom('rA', ['wA', 'wS'], {
      designTemperature: 20, ceilingHeight: 2500, area: 20,
      floors:   [{ id: 'fA', uValue: 0.25, boundaryCategory: 'ground' }],
      ceilings: [{ id: 'cA', uValue: 0.20, boundaryCategory: 'exterior' }],
      minAirChanges: 0.5,
    });
    const roomB = makeRoom('rB', ['wB', 'wS'], {
      designTemperature: 20, ceilingHeight: 2500, area: 15,
      floors:   [{ id: 'fB', uValue: 0.25, boundaryCategory: 'ground' }],
      ceilings: [{ id: 'cB', uValue: 0.20, boundaryCategory: 'exterior' }],
      minAirChanges: 0.5,
    });

    const floor = makeFloor([extA, extB, shared], [roomA, roomB]);
    const project: Project = {
      id: 'pF', name: 'Test F', plz: '80000',
      designTemperatureOverride: -12,
      floors: [floor], hullGroups: [],
      createdAt: '', updatedAt: '',
    };

    const result = calculateHeizlast(project);
    expect(result.buildingTotal).toBeCloseTo(987.5, 1);
    expect(result.designHeatLoad).toBeCloseTo(987.5, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INTER-FLOOR: ceiling U-value must come from the upper room's floor preset
//
// Setup: two identical 5m×5m rooms, EG (level 0) directly below OG (level 1).
// The polygon intersection is exactly 25 m².
//
// Assertion 1: auto-ceiling entry for EG uses OG.floors[0].uValue (not EG.ceilings[0].uValue).
// Assertion 2: changing OG.floors[0].uValue updates the ceiling heat-loss of EG accordingly.
// ═══════════════════════════════════════════════════════════════════════════

function makeBoxFloor(
  level: number,
  label: string,
  rooms: Room[],
): Floor {
  const T = 200;
  const walls: WallSegment[] = [
    makeWall(`${label}_wT`, { start: {x:    0,y:    0}, end: {x: 5000,y:    0}, thickness: T, boundaryCategory: 'exterior' }),
    makeWall(`${label}_wR`, { start: {x: 5000,y:    0}, end: {x: 5000,y: 5000}, thickness: T, boundaryCategory: 'exterior' }),
    makeWall(`${label}_wB`, { start: {x: 5000,y: 5000}, end: {x:    0,y: 5000}, thickness: T, boundaryCategory: 'exterior' }),
    makeWall(`${label}_wL`, { start: {x:    0,y: 5000}, end: {x:    0,y:    0}, thickness: T, boundaryCategory: 'exterior' }),
  ];
  const wallIds = [`${label}_wT`, `${label}_wR`, `${label}_wB`, `${label}_wL`];
  rooms.forEach(r => { r.wallIds = wallIds; });
  return { id: `floor_${label}`, level, label, defaultCeilingHeight: 2500, walls, openings: [], rooms };
}

describe('inter-floor ceiling U-value inheritance', () => {
  // EG at 20 °C, OG at 16 °C → both share a 25 m² ceiling/floor.
  // fij (EG ceiling) = (20 − 16) / (20 − (−12)) = 4/32 = 0.125
  // heatLoss (EG ceiling) = 25 × U_og_floor × 0.125 × 32  = 100 × U_og_floor

  function makeProject(ogFloorU: number): Project {
    const egRoom = makeRoom('eg', [], {
      designTemperature: 20, ceilingHeight: 2500, area: 25, minAirChanges: 0,
      floors:   [{ id: 'eg_f', uValue: 0.30, boundaryCategory: 'ground' }],
      ceilings: [{ id: 'eg_c', uValue: 0.99, boundaryCategory: 'exterior' }], // deliberately wrong U
    });
    const ogRoom = makeRoom('og', [], {
      designTemperature: 16, ceilingHeight: 2500, area: 25, minAirChanges: 0,
      floors:   [{ id: 'og_f', uValue: ogFloorU, boundaryCategory: 'adj_heated' }],
      ceilings: [{ id: 'og_c', uValue: 0.20,     boundaryCategory: 'exterior' }],
    });
    const egFloor = makeBoxFloor(0, 'EG', [egRoom]);
    const ogFloor = makeBoxFloor(1, 'OG', [ogRoom]);
    return {
      id: 'p', name: 'Test', plz: '80000',
      designTemperatureOverride: -12,
      floors: [egFloor, ogFloor],
      hullGroups: [],
      createdAt: '', updatedAt: '',
    };
  }

  // NOTE: calculateRoomHeizlast generates elementId as `${room.id}_ceiling_${ci}` (array index),
  // so the auto-ceiling entries for EG appear as 'eg_ceiling_0', 'eg_ceiling_1', etc.
  // We find the relevant entry by uValue/area rather than by the surface's own .id field.

  it('auto-ceiling of lower room uses upper room floor U-value, not lower ceiling U-value', () => {
    const result = calculateHeizlast(makeProject(0.25));
    const egResult = result.rooms.find(r => r.roomId === 'eg')!.result;

    // EG ceiling preset has uValue=0.99 (deliberately wrong).
    // The auto-ceiling for the 25m² overlap must use OG floor U=0.25, not 0.99.
    const ceilEl = egResult.elementBreakdown.find(e => e.elementType === 'ceiling' && e.area > 1);
    expect(ceilEl).toBeDefined();
    expect(ceilEl!.uValue).toBeCloseTo(0.25, 5);   // from OG.floors[0], NOT eg_c
    expect(ceilEl!.area).toBeCloseTo(25, 1);
  });

  it('changing OG floor type updates EG ceiling heat loss', () => {
    const resultA = calculateHeizlast(makeProject(0.25));
    const resultB = calculateHeizlast(makeProject(0.15));

    const egCeilA = resultA.rooms.find(r => r.roomId === 'eg')!.result
      .elementBreakdown.find(e => e.elementType === 'ceiling' && e.area > 1)!;
    const egCeilB = resultB.rooms.find(r => r.roomId === 'eg')!.result
      .elementBreakdown.find(e => e.elementType === 'ceiling' && e.area > 1)!;

    // fij = (20-16)/(20-(-12)) = 4/32 = 0.125
    // heatLoss = 25 × U × 0.125 × 32 = 100 × U
    expect(egCeilA.uValue).toBeCloseTo(0.25, 5);
    expect(egCeilA.heatLoss).toBeCloseTo(100 * 0.25, 1);   // 25 W

    expect(egCeilB.uValue).toBeCloseTo(0.15, 5);
    expect(egCeilB.heatLoss).toBeCloseTo(100 * 0.15, 1);   // 15 W

    // The auto-floor of OG must use the same U-value (same physical slab)
    const ogFloorA = resultA.rooms.find(r => r.roomId === 'og')!.result
      .elementBreakdown.find(e => e.elementType === 'floor' && e.area > 1)!;
    const ogFloorB = resultB.rooms.find(r => r.roomId === 'og')!.result
      .elementBreakdown.find(e => e.elementType === 'floor' && e.area > 1)!;

    expect(ogFloorA.uValue).toBeCloseTo(0.25, 5);
    expect(ogFloorB.uValue).toBeCloseTo(0.15, 5);
    // OG (16°C) is cooler than EG (20°C) → fij = max(0, (16-20)/(16+12)) = 0 → no heat loss upward
    expect(ogFloorA.heatLoss).toBeCloseTo(0, 1);
    expect(ogFloorB.heatLoss).toBeCloseTo(0, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RESIDUAL AREA — Option A: use centerline footprint, not stored room.area
//
// room.area is the INSET (internal-face) area; polygon intersections are based on
// CENTERLINE polygons.  The residual must use the same basis as the intersections
// so that: Σ auto-ceilings + residual = centerline footprint.
//
// Setup: 5m×5m EG room whose stored area is deliberately set to 23 m² (simulating
// the inset area for 200 mm walls). One OG room covers only the right half (x=2500–5000).
//   centerline footprint(EG)  = 25 m²
//   intersection(EG, OG)      = 12.5 m²  (right half)
//   correct residual (opt-A)  = 25 − 12.5 = 12.5 m²
//   wrong residual  (old code) = 23 − 12.5 = 10.5 m²   ← would fail the assertion below
// ═══════════════════════════════════════════════════════════════════════════

describe('residual ceiling uses centerline footprint (Option A)', () => {
  function makePartialProject(storedEGArea: number): Project {
    const T = 200;

    // EG: full 5m×5m box, but we override room.area to simulate inset area
    const egRoom = makeRoom('eg', [], {
      designTemperature: 20, ceilingHeight: 2500, area: storedEGArea, minAirChanges: 0,
      floors:   [{ id: 'eg_f', uValue: 0.30, boundaryCategory: 'ground' }],
      ceilings: [{ id: 'eg_c', uValue: 0.50, boundaryCategory: 'exterior' }],
    });
    const egWalls: WallSegment[] = [
      makeWall('eg_wT', { start:{x:    0,y:    0}, end:{x:5000,y:    0}, thickness:T }),
      makeWall('eg_wR', { start:{x:5000,y:    0}, end:{x:5000,y:5000}, thickness:T }),
      makeWall('eg_wB', { start:{x:5000,y:5000}, end:{x:    0,y:5000}, thickness:T }),
      makeWall('eg_wL', { start:{x:    0,y:5000}, end:{x:    0,y:    0}, thickness:T }),
    ];
    egRoom.wallIds = ['eg_wT','eg_wR','eg_wB','eg_wL'];
    const egFloor: Floor = { id:'fEG', level:0, label:'EG', defaultCeilingHeight:2500, walls:egWalls, openings:[], rooms:[egRoom] };

    // OG: covers only right half (x = 2500–5000), centerline area = 12.5 m²
    const ogRoom = makeRoom('og', [], {
      designTemperature: 20, ceilingHeight: 2500, area: 12.5, minAirChanges: 0,
      floors:   [{ id: 'og_f', uValue: 0.25, boundaryCategory: 'adj_heated' }],
      ceilings: [{ id: 'og_c', uValue: 0.20, boundaryCategory: 'exterior' }],
    });
    const ogWalls: WallSegment[] = [
      makeWall('og_wT', { start:{x:2500,y:    0}, end:{x:5000,y:    0}, thickness:T }),
      makeWall('og_wR', { start:{x:5000,y:    0}, end:{x:5000,y:5000}, thickness:T }),
      makeWall('og_wB', { start:{x:5000,y:5000}, end:{x:2500,y:5000}, thickness:T }),
      makeWall('og_wL', { start:{x:2500,y:5000}, end:{x:2500,y:    0}, thickness:T }),
    ];
    ogRoom.wallIds = ['og_wT','og_wR','og_wB','og_wL'];
    const ogFloor: Floor = { id:'fOG', level:1, label:'OG', defaultCeilingHeight:2500, walls:ogWalls, openings:[], rooms:[ogRoom] };

    return { id:'p', name:'Test', plz:'80000', designTemperatureOverride:-12,
             floors:[egFloor, ogFloor], hullGroups:[], createdAt:'', updatedAt:'' };
  }

  it('residual = centerline footprint − intersection, independent of stored room.area', () => {
    // Run with two different stored areas; residual must be the same both times.
    const resultA = calculateHeizlast(makePartialProject(25));   // stored = centerline (ideal)
    const resultB = calculateHeizlast(makePartialProject(23));   // stored = inset (real-world)

    const egA = resultA.rooms.find(r => r.roomId === 'eg')!.result;
    const egB = resultB.rooms.find(r => r.roomId === 'eg')!.result;

    // The auto-ceiling for the OG overlap must be 12.5 m² in both cases
    const autoCeilA = egA.elementBreakdown.find(e => e.elementType === 'ceiling' && e.area > 1 && e.boundaryCategory !== 'exterior')!;
    const autoCeilB = egB.elementBreakdown.find(e => e.elementType === 'ceiling' && e.area > 1 && e.boundaryCategory !== 'exterior')!;
    expect(autoCeilA.area).toBeCloseTo(12.5, 1);
    expect(autoCeilB.area).toBeCloseTo(12.5, 1);

    // The residual (exterior ceiling = left half not covered by OG) must be
    // 25 − 12.5 = 12.5 m² regardless of the stored room.area.
    // Old code: storedArea − intersection = 23 − 12.5 = 10.5 (wrong for case B).
    const residualA = egA.elementBreakdown.find(e => e.elementType === 'ceiling' && e.boundaryCategory === 'exterior')!;
    const residualB = egB.elementBreakdown.find(e => e.elementType === 'ceiling' && e.boundaryCategory === 'exterior')!;
    expect(residualA.area).toBeCloseTo(12.5, 1);
    expect(residualB.area).toBeCloseTo(12.5, 1);  // would be 10.5 with old code → test would fail

    // The residual is attributed to the correct U-value (from EG ceiling preset)
    expect(residualA.uValue).toBeCloseTo(0.50, 5);
    expect(residualB.uValue).toBeCloseTo(0.50, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUTHERLAND-HODGMAN DEGENERACY — shared vertex on clip edge
//
// When a subject-polygon vertex lies exactly on a clip edge (edgeSide = 0),
// the algorithm must NOT call lineIntersect (which produces a spurious
// far-away crossing when both lines share that vertex).  For a diagonal split
// the square EG corners coincide with triangle OG corners, triggering this.
//
// Invariant: polygonIntersectionArea(square, triA) + polygonIntersectionArea(square, triB)
//            == squareArea   for a diagonal bisection.
// ═══════════════════════════════════════════════════════════════════════════

describe('Sutherland-Hodgman: diagonal split symmetry', () => {
  const N = 5000; // mm, 5 m × 5 m square

  // Square corners (CW in screen/y-down coords)
  const square: import('../model/types.js').Point2D[] = [
    {x:0,y:0}, {x:N,y:0}, {x:N,y:N}, {x:0,y:N},
  ];

  // Diagonal from (N,0) to (0,N):
  // Triangle A — upper-left  (shares corner (0,0), (N,0), (0,N) with square)
  const triA: import('../model/types.js').Point2D[] = [
    {x:0,y:0}, {x:N,y:0}, {x:0,y:N},
  ];
  // Triangle B — lower-right (shares corner (N,0), (N,N), (0,N) with square)
  const triB: import('../model/types.js').Point2D[] = [
    {x:N,y:0}, {x:N,y:N}, {x:0,y:N},
  ];

  const expectedEach = (N * N) / 2 / 1_000_000; // m²

  it('intersection of square with upper-left triangle equals half area', () => {
    const area = polygonIntersectionArea(square, triA) / 1_000_000;
    expect(area).toBeCloseTo(expectedEach, 4);
  });

  it('intersection of square with lower-right triangle equals half area', () => {
    const area = polygonIntersectionArea(square, triB) / 1_000_000;
    expect(area).toBeCloseTo(expectedEach, 4);
  });

  it('two triangle intersections sum to full square area', () => {
    const aA = polygonIntersectionArea(square, triA) / 1_000_000;
    const aB = polygonIntersectionArea(square, triB) / 1_000_000;
    expect(aA + aB).toBeCloseTo(N * N / 1_000_000, 4);
  });

  it('diagonal split: two equal OG rooms give equal ceiling areas on EG', () => {
    const T = 200;
    const egRoom = makeRoom('eg', [], {
      designTemperature: 20, ceilingHeight: 2500, area: 25, minAirChanges: 0,
      floors:   [{ id: 'eg_f', uValue: 0.30, boundaryCategory: 'ground' }],
      ceilings: [{ id: 'eg_c', uValue: 0.20, boundaryCategory: 'exterior' }],
    });
    const ogA = makeRoom('ogA', [], {
      designTemperature: 20, ceilingHeight: 2500, area: 12.5, minAirChanges: 0,
      floors:   [{ id: 'ogA_f', uValue: 0.25, boundaryCategory: 'adj_heated' }],
      ceilings: [{ id: 'ogA_c', uValue: 0.20, boundaryCategory: 'exterior' }],
    });
    const ogB = makeRoom('ogB', [], {
      designTemperature: 20, ceilingHeight: 2500, area: 12.5, minAirChanges: 0,
      floors:   [{ id: 'ogB_f', uValue: 0.25, boundaryCategory: 'adj_heated' }],
      ceilings: [{ id: 'ogB_c', uValue: 0.20, boundaryCategory: 'exterior' }],
    });

    const egWalls: WallSegment[] = [
      makeWall('eg_wT', { start:{x:0,y:0}, end:{x:N,y:0}, thickness:T }),
      makeWall('eg_wR', { start:{x:N,y:0}, end:{x:N,y:N}, thickness:T }),
      makeWall('eg_wB', { start:{x:N,y:N}, end:{x:0,y:N}, thickness:T }),
      makeWall('eg_wL', { start:{x:0,y:N}, end:{x:0,y:0}, thickness:T }),
    ];
    egRoom.wallIds = ['eg_wT','eg_wR','eg_wB','eg_wL'];

    const diagWall = makeWall('diag', { start:{x:N,y:0}, end:{x:0,y:N}, thickness:T });
    const ogWalls: WallSegment[] = [
      makeWall('og_wT', { start:{x:0,y:0}, end:{x:N,y:0}, thickness:T }),
      makeWall('og_wR', { start:{x:N,y:0}, end:{x:N,y:N}, thickness:T }),
      makeWall('og_wB', { start:{x:N,y:N}, end:{x:0,y:N}, thickness:T }),
      makeWall('og_wL', { start:{x:0,y:N}, end:{x:0,y:0}, thickness:T }),
      diagWall,
    ];
    ogA.wallIds = ['og_wT', 'diag', 'og_wL'];
    ogB.wallIds = ['diag', 'og_wR', 'og_wB'];

    const egFloor: Floor = { id:'fEG', level:0, label:'EG', defaultCeilingHeight:2500, walls:egWalls, openings:[], rooms:[egRoom] };
    const ogFloor: Floor = { id:'fOG', level:1, label:'OG', defaultCeilingHeight:2500, walls:ogWalls, openings:[], rooms:[ogA, ogB] };

    const project: Project = { id:'p', name:'Test', plz:'80000', designTemperatureOverride:-12,
      floors:[egFloor, ogFloor], hullGroups:[], createdAt:'', updatedAt:'' };

    const result = calculateHeizlast(project);
    const egBreakdown = result.rooms.find(r => r.roomId === 'eg')!.result.elementBreakdown;
    const ceilEls = egBreakdown.filter(e => e.elementType === 'ceiling');

    // Expect two ceiling entries (one per OG room), each ≈ 12.5 m²
    expect(ceilEls).toHaveLength(2);
    expect(ceilEls[0].area).toBeCloseTo(12.5, 1);
    expect(ceilEls[1].area).toBeCloseTo(12.5, 1);
    // Must be equal (symmetric split)
    expect(Math.abs(ceilEls[0].area - ceilEls[1].area)).toBeLessThan(0.01);
  });
});

// ------- Hull group summation -------

describe('hull group summation', () => {
  it('only includes elements with matching boundary categories', () => {
    const extWall = makeWall('ext', { boundaryCategory: 'exterior',   end: { x: 4000, y: 0 } });
    const adjWall = makeWall('adj', { start: { x: 0, y: 4000 }, end: { x: 4000, y: 4000 }, boundaryCategory: 'adj_heated', adjacentRoomId: 'r2' });
    const room1   = makeRoom('r1', ['ext', 'adj'], { area: 16 });
    const room2   = makeRoom('r2', ['adj'], { designTemperature: 20, area: 16 });
    const floor   = makeFloor([extWall, adjWall], [room1, room2]);

    const hullExterior: HullGroup = { id: 'h1', name: 'Außenhülle', categories: ['exterior'], isDefault: true };
    const project: Project = { id: 'p1', name: 'Test', plz: '80000', floors: [floor], hullGroups: [hullExterior], createdAt: '', updatedAt: '' };

    const result    = calculateHeizlast(project);
    const hullEntry = result.hullSummary[0];

    let expected = 0;
    for (const rr of result.rooms)
      for (const el of rr.result.elementBreakdown)
        if (el.boundaryCategory === 'exterior') expected += el.heatLoss;

    expect(hullEntry.totalTransmissionLoss).toBeCloseTo(expected, 1);
  });
});
