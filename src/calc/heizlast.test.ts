import { describe, it, expect } from 'vitest';
import { computeFij, calculateRoomHeizlast, calculateHeizlast } from './heizlast.js';
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

  it('ground returns 0.45 simplified', () => {
    expect(computeFij({ tInt: 20, tAdj: 0, tE: -12, category: 'ground' })).toBe(0.45);
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

  it('ground floor slab uses fij=0.45', () => {
    const room   = makeRoom('r1', [], { floorType: 'ground', area: 20 });
    const floor  = makeFloor([], [room]);
    const result = calculateRoomHeizlast(room, floor, -12, [room]);
    const floorEl = result.elementBreakdown.find(e => e.elementType === 'floor');
    expect(floorEl!.fij).toBeCloseTo(0.45, 5);
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
  //   Q_T_walls = 33.0 × 0.25 × 1.0 × 32           =  264.0 W
  //   Q_T_floor = 12.0 × 0.25 × 0.45 × 32  (ground) =   43.2 W
  //   Q_T_ceil  = 12.0 × 0.20 × 1.0 × 32  (exterior)=   76.8 W
  //   Q_T = 384.0 W
  //   Q_V = 0.34 × (12 × 2.5) × 0.5 × 32            =  163.2 W
  //   Q_HL = 547.2 W

  it('Q_T = 384 W, Q_V = 163.2 W, Q_HL = 547.2 W', () => {
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
    const result = calculateRoomHeizlast(room, floor, -12, [room]);

    expect(result.transmissionLoss).toBeCloseTo(384.0, 1);
    expect(result.ventilationLoss).toBeCloseTo(163.2, 1);
    expect(result.totalLoss).toBeCloseTo(547.2, 1);
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
  // Room A:
  //   Q_T = 12.5×0.25×32 + 20×0.25×0.45×32 + 20×0.20×32 = 100 + 72 + 128 = 300 W
  //   Q_V = 0.34 × (20 × 2.5) × 0.5 × 32 = 272 W  →  Q_A = 572 W
  //
  // Room B:
  //   Q_T = 12.5×0.25×32 + 15×0.25×0.45×32 + 15×0.20×32 = 100 + 54 + 96 = 250 W
  //   Q_V = 0.34 × (15 × 2.5) × 0.5 × 32 = 204 W  →  Q_B = 454 W
  //
  // Building total = 572 + 454 = 1026 W

  it('building total Q_HL = 1026 W', () => {
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
    expect(result.buildingTotal).toBeCloseTo(1026, 1);
    expect(result.designHeatLoad).toBeCloseTo(1026, 1);
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
