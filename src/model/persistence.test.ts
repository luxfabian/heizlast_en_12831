import { describe, it, expect } from 'vitest';
import { migrateProject } from './persistence.js';
import { createDefaultProject } from './defaults.js';

// Helpers
function roundTrip(p: unknown): ReturnType<typeof migrateProject> {
  return migrateProject(JSON.parse(JSON.stringify(p)));
}

// ---- Round-trip: default project ----

describe('JSON round-trip: default project', () => {
  it('preserves id, name, plz, hullGroups count', () => {
    const orig = createDefaultProject('Mein Projekt');
    orig.plz = '80331';
    const restored = roundTrip(orig);
    expect(restored.id).toBe(orig.id);
    expect(restored.name).toBe(orig.name);
    expect(restored.plz).toBe(orig.plz);
    expect(restored.hullGroups.length).toBe(orig.hullGroups.length);
  });

  it('preserves designTemperatureOverride and groundTemperature', () => {
    const orig = createDefaultProject();
    orig.designTemperatureOverride = -14;
    orig.groundTemperature = 8;
    const restored = roundTrip(orig);
    expect(restored.designTemperatureOverride).toBe(-14);
    expect(restored.groundTemperature).toBe(8);
  });
});

// ---- Round-trip: project with rooms and walls ----

describe('JSON round-trip: rooms and walls', () => {
  it('preserves wall geometry and thermal properties', () => {
    const proj = createDefaultProject();
    proj.floors[0].walls = [
      {
        id: 'w1', start: { x: 0, y: 0 }, end: { x: 5000, y: 0 },
        thickness: 240, uValue: 0.18, boundaryCategory: 'exterior',
      },
      {
        id: 'w2', start: { x: 5000, y: 0 }, end: { x: 5000, y: 4000 },
        thickness: 120, uValue: 0.50, boundaryCategory: 'adj_heated',
        adjacentRoomId: 'r2',
      },
    ];
    const restored = roundTrip(proj);
    const walls = restored.floors[0].walls;
    expect(walls.length).toBe(2);
    expect(walls[0].uValue).toBe(0.18);
    expect(walls[0].thickness).toBe(240);
    expect(walls[0].boundaryCategory).toBe('exterior');
    expect(walls[0].start).toEqual({ x: 0, y: 0 });
    expect(walls[0].end).toEqual({ x: 5000, y: 0 });
    expect(walls[1].boundaryCategory).toBe('adj_heated');
    expect(walls[1].adjacentRoomId).toBe('r2');
  });

  it('preserves room label, designTemperature, ceilingHeight, and wallIds', () => {
    const proj = createDefaultProject();
    proj.floors[0].rooms = [
      {
        id: 'r1', label: 'Wohnzimmer', wallIds: ['w1', 'w2', 'w3', 'w4'],
        designTemperature: 22, ceilingHeight: 2800, area: 18.5,
        floors:   [{ id: 'f1', uValue: 0.25, boundaryCategory: 'ground' }],
        ceilings: [{ id: 'c1', uValue: 0.18, boundaryCategory: 'exterior' }],
      },
    ];
    const restored = roundTrip(proj);
    const room = restored.floors[0].rooms[0];
    expect(room.label).toBe('Wohnzimmer');
    expect(room.designTemperature).toBe(22);
    expect(room.ceilingHeight).toBe(2800);
    expect(room.wallIds).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(room.area).toBe(18.5);
  });

  it('preserves openings (windows/doors)', () => {
    const proj = createDefaultProject();
    proj.floors[0].openings = [
      {
        id: 'op1', type: 'window', wallId: 'w1',
        positionAlongWall: 500, width: 1200, height: 1400, uValue: 1.1,
      },
    ];
    const restored = roundTrip(proj);
    const op = restored.floors[0].openings[0];
    expect(op.type).toBe('window');
    expect(op.width).toBe(1200);
    expect(op.height).toBe(1400);
    expect(op.uValue).toBe(1.1);
  });

  it('preserves floor/ceiling ThermalSurface arrays with areaOverride', () => {
    const proj = createDefaultProject();
    proj.floors[0].rooms = [
      {
        id: 'r1', label: 'Bad', wallIds: [],
        designTemperature: 24, ceilingHeight: 2500, area: 8,
        floors: [
          { id: 'f1', uValue: 0.25, boundaryCategory: 'ground', areaOverride: 5 },
          { id: 'f2', uValue: 0.50, boundaryCategory: 'adj_heated', areaOverride: 3 },
        ],
        ceilings: [
          { id: 'c1', uValue: 0.20, boundaryCategory: 'exterior' },
        ],
        volumeOverride: 20,
        minAirChanges: 1.5,
      },
    ];
    const restored = roundTrip(proj);
    const room = restored.floors[0].rooms[0];
    expect(room.floors.length).toBe(2);
    expect(room.floors[0].areaOverride).toBe(5);
    expect(room.floors[1].boundaryCategory).toBe('adj_heated');
    expect(room.volumeOverride).toBe(20);
    expect(room.minAirChanges).toBe(1.5);
  });
});

// ---- Migration: missing / legacy fields ----

describe('migrateProject: legacy and missing fields', () => {
  it('returns a default project for null input', () => {
    const result = migrateProject(null);
    expect(result.name).toBeTruthy();
    expect(result.floors.length).toBeGreaterThan(0);
  });

  it('returns a default project for empty floors array', () => {
    const result = migrateProject({ floors: [] });
    expect(result.floors.length).toBeGreaterThan(0);
  });

  it('fills in missing wall properties with safe defaults', () => {
    const raw = {
      floors: [{
        walls: [{ id: 'w1', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } }],
        openings: [],
        rooms: [],
      }],
    };
    const result = migrateProject(raw);
    const wall = result.floors[0].walls[0];
    expect(typeof wall.uValue).toBe('number');
    expect(typeof wall.thickness).toBe('number');
    expect(wall.boundaryCategory).toBeTruthy();
  });

  it('fills in missing room properties with safe defaults', () => {
    const raw = {
      floors: [{
        walls: [],
        openings: [],
        rooms: [{ id: 'r1', label: 'Test', wallIds: [] }],
      }],
    };
    const result = migrateProject(raw);
    const room = result.floors[0].rooms[0];
    expect(room.designTemperature).toBe(20);
    expect(room.ceilingHeight).toBe(2500);
  });

  it('fills in missing hullGroups', () => {
    const raw = {
      id: 'p1', name: 'Test', plz: '',
      floors: [{ walls: [], openings: [], rooms: [] }],
    };
    const result = migrateProject(raw);
    expect(Array.isArray(result.hullGroups)).toBe(true);
    expect(result.hullGroups.length).toBeGreaterThan(0);
  });
});
