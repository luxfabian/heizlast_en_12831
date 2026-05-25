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
