import type {
  Project, Floor, Room, WallSegment, Opening, Point2D, ThermalSurface,
  BoundaryCategory, ElementHeatLoss, RoomHeizlastResult, HeizlastResult, HullSummaryEntry,
} from '../model/types.js';
import { getDesignTemperature } from '../climate/index.js';
import { wallLength, polygonAreaM2 } from '../editor/geometry.js';
import { buildActiveWallIds } from '../editor/adjacency.js';

const DEFAULT_MIN_AIR_CHANGES = 0.5;
const DEFAULT_U_FLOOR         = 0.25; // W/m²K
const DEFAULT_U_CEILING       = 0.20; // W/m²K — fallback for rooms without ceilings array

/** Canonical room type, migrating legacy isHeated boolean */
function effectiveRoomType(room: Room): 'heated' | 'reduced' | 'unheated' {
  if (room.roomType) return room.roomType;
  if ((room as any).isHeated === false) return 'reduced';
  return 'heated';
}

/** Temperature on the other side of a wall for a non-modelled-room boundary */
function adjTempFromWall(wall: WallSegment, tE: number, tGround: number): number {
  switch (wall.boundaryCategory) {
    case 'exterior':     return tE;
    case 'ground':       return tGround;
    case 'unheated':     return wall.unheatedSpaceTemp ?? tE;
    case 'adj_neighbor': return wall.unheatedSpaceTemp ?? 15;
    case 'adj_heated':
    case 'adj_reduced':  return tE; // fallback — adjacentRoomId lookup done separately
    case 'freestanding': return tE; // no boundary — zero heat loss handled by active-wall filter
  }
}

/** Temperature on the other side of a floor/ceiling surface */
function adjTempFromSurface(
  s: ThermalSurface, temps: Map<string, number>, tE: number, tGround: number,
): number {
  switch (s.boundaryCategory) {
    case 'adj_heated':
    case 'adj_reduced':  return s.adjacentRoomId ? (temps.get(s.adjacentRoomId) ?? tE) : tE;
    case 'exterior':     return tE;
    case 'ground':       return tGround;
    case 'unheated':     return s.unheatedSpaceTemp ?? tE;
    case 'adj_neighbor': return s.unheatedSpaceTemp ?? 15;
    case 'freestanding': return tE;
  }
}

/**
 * Iterative (Gauss-Seidel) solver for the equilibrium temperatures of unheated rooms.
 * Solves θ_eq = Σ(Ui·Ai·θi) / Σ(Ui·Ai) for each unheated room simultaneously.
 */
function solveEquilibriumTemps(
  unheatedRooms: { room: Room; floor: Floor }[],
  augmentedCeilings: Map<string, ThermalSurface[]>,
  augmentedFloors: Map<string, ThermalSurface[]>,
  allRooms: Room[],
  tE: number,
  tGround: number,
): Map<string, number> {
  // Pre-build per-floor active-wall sets (iteratively prunes dangling chains).
  const floorActiveWalls = new Map<string, Set<string>>();
  for (const { floor } of unheatedRooms) {
    if (!floorActiveWalls.has(floor.id))
      floorActiveWalls.set(floor.id, buildActiveWallIds(floor));
  }

  // Start: all rooms at design temp; unheated at tE as initial guess
  const temps = new Map<string, number>(allRooms.map(r => [r.id, r.designTemperature]));
  for (const { room } of unheatedRooms) temps.set(room.id, tE);

  for (let iter = 0; iter < 50; iter++) {
    let maxChange = 0;
    for (const { room, floor } of unheatedRooms) {
      let uaSum  = 0;
      let uaTSum = 0;
      const activeWalls = floorActiveWalls.get(floor.id)!;

      // Walls and openings — skip dangling spur chains
      for (const wallId of room.wallIds) {
        const wall = floor.walls.find(w => w.id === wallId);
        if (!wall) continue;
        if (!activeWalls.has(wall.id)) continue;
        const adjRoom = floor.rooms.find(r => r.id !== room.id && r.wallIds.includes(wall.id));
        const tAdj = adjRoom ? (temps.get(adjRoom.id) ?? tE) : adjTempFromWall(wall, tE, tGround);
        const netArea = wallNetAreaM2(wall, room.ceilingHeight, floor.openings, floor);
        uaSum  += wall.uValue * netArea;
        uaTSum += wall.uValue * netArea * tAdj;
        for (const op of getWallOpenings(wall.id, floor.openings)) {
          const area = openingAreaM2(op);
          uaSum  += op.uValue * area;
          uaTSum += op.uValue * area * tAdj;
        }
      }

      // Floor surfaces
      const floorSurfs = augmentedFloors.get(room.id) ?? (room.floors?.length > 0 ? room.floors : [
        { id: 'fb', uValue: DEFAULT_U_FLOOR, boundaryCategory: 'ground' as BoundaryCategory },
      ]);
      for (const flr of floorSurfs) {
        const area = flr.areaOverride ?? (room.area ?? 0);
        if (area <= 0) continue;
        const tAdj = adjTempFromSurface(flr, temps, tE, tGround);
        uaSum  += flr.uValue * area;
        uaTSum += flr.uValue * area * tAdj;
      }

      // Ceiling surfaces
      const ceilSurfs = augmentedCeilings.get(room.id) ?? (room.ceilings?.length > 0 ? room.ceilings : [
        { id: 'cb', uValue: DEFAULT_U_CEILING, boundaryCategory: 'exterior' as BoundaryCategory },
      ]);
      for (const ceil of ceilSurfs) {
        const area = ceil.areaOverride ?? (room.area ?? 0);
        if (area <= 0) continue;
        const tAdj = adjTempFromSurface(ceil, temps, tE, tGround);
        uaSum  += ceil.uValue * area;
        uaTSum += ceil.uValue * area * tAdj;
      }

      // Infiltration / ventilation — always connected to exterior
      const vol = room.volumeOverride ?? ((room.area ?? 0) * room.ceilingHeight / 1000);
      const uaVent = 0.34 * vol * (room.minAirChanges ?? DEFAULT_MIN_AIR_CHANGES);
      uaSum  += uaVent;
      uaTSum += uaVent * tE;

      const newTemp  = uaSum > 0 ? uaTSum / uaSum : tE;
      const change   = Math.abs(newTemp - (temps.get(room.id) ?? tE));
      maxChange      = Math.max(maxChange, change);
      temps.set(room.id, newTemp);
    }
    if (maxChange < 0.01) break;
  }

  return temps;
}

/** Temperature correction factor per DIN EN 12831 §6.3.1.2 */
export function computeFij(params: {
  tInt: number;
  tAdj: number;
  tE: number;
  category: BoundaryCategory;
  unheatedSpaceTemp?: number;
  tGround?: number;
  allowHeatGains?: boolean;
}): number {
  const { tInt, tAdj, tE, category, unheatedSpaceTemp, tGround = 10, allowHeatGains = false } = params;
  const denom = tInt - tE;
  if (Math.abs(denom) < 0.001) return 0;
  switch (category) {
    case 'exterior': return 1.0;
    case 'adj_heated':
    case 'adj_reduced': {
      const raw = (tInt - tAdj) / denom;
      return allowHeatGains ? raw : Math.max(0, raw);
    }
    case 'ground':      return (tInt - tGround) / denom;
    case 'unheated': {
      const tU = unheatedSpaceTemp ?? (tE + 0.5 * (tInt - tE));
      return (tInt - tU) / denom;
    }
    case 'adj_neighbor': {
      const tN = unheatedSpaceTemp ?? 15;
      return (tInt - tN) / denom;
    }
    case 'freestanding': return 0;
  }
}

function getWallOpenings(wallId: string, openings: Opening[]): Opening[] {
  return openings.filter(o => o.wallId === wallId);
}


function openingAreaM2(o: Opening): number {
  return (o.width * o.height) / 1_000_000;
}

/** Internal wall face length: centerline length minus half-thickness of connecting walls at each end. */
function wallInternalLengthMm(wall: WallSegment, floor: Floor): number {
  const vk = (p: { x: number; y: number }) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const sk = vk(wall.start);
  const ek = vk(wall.end);
  let sCorr = 0, eCorr = 0;
  for (const w of floor.walls) {
    if (w.id === wall.id) continue;
    const wsK = vk(w.start), weK = vk(w.end);
    if (wsK === sk || weK === sk) sCorr = Math.max(sCorr, w.thickness / 2);
    if (wsK === ek || weK === ek) eCorr = Math.max(eCorr, w.thickness / 2);
  }
  return Math.max(1, wallLength(wall.start, wall.end) - sCorr - eCorr);
}

function wallGrossAreaM2(wall: WallSegment, ceilingHeightMm: number, floor: Floor): number {
  return (wallInternalLengthMm(wall, floor) * ceilingHeightMm) / 1_000_000;
}

function wallNetAreaM2(wall: WallSegment, ceilingHeightMm: number, openings: Opening[], floor: Floor): number {
  const gross    = wallGrossAreaM2(wall, ceilingHeightMm, floor);
  const openArea = getWallOpenings(wall.id, openings).reduce((s, o) => s + openingAreaM2(o), 0);
  return Math.max(0, gross - openArea);
}

// Wall adjacency must be restricted to the same floor — adjacentRoomId stored on walls can
// be stale (e.g. from older project data) and might point to rooms on a different floor,
// which would create physically impossible cross-floor wall connections.
function getAdjacentRoomTemp(wall: WallSegment, currentRoomId: string, sameFloorRooms: Room[]): number | undefined {
  const bySharing = sameFloorRooms.find(r => r.id !== currentRoomId && r.wallIds.includes(wall.id));
  if (bySharing) return bySharing.designTemperature;
  if (!wall.adjacentRoomId || wall.adjacentRoomId === currentRoomId) return undefined;
  return sameFloorRooms.find(r => r.id === wall.adjacentRoomId)?.designTemperature;
}

function getAdjacentRoomId(wall: WallSegment, currentRoomId: string, sameFloorRooms: Room[]): string | undefined {
  const bySharing = sameFloorRooms.find(r => r.id !== currentRoomId && r.wallIds.includes(wall.id));
  if (bySharing) return bySharing.id;
  if (!wall.adjacentRoomId || wall.adjacentRoomId === currentRoomId) return undefined;
  return sameFloorRooms.find(r => r.id === wall.adjacentRoomId) ? wall.adjacentRoomId : undefined;
}

export function calculateRoomHeizlast(
  room: Room,
  floor: Floor,
  tE: number,
  allRooms: Room[],
  tGround = 10,
  allowHeatGains = false,
): RoomHeizlastResult {
  const tInt = room.designTemperature;
  const breakdown: ElementHeatLoss[] = [];

  const activeWallIds = buildActiveWallIds(floor);

  for (const wallId of room.wallIds) {
    const wall = floor.walls.find(w => w.id === wallId);
    if (!wall) continue;
    if (!activeWallIds.has(wall.id)) continue;

    const category = wall.boundaryCategory;
    const tAdj     = getAdjacentRoomTemp(wall, room.id, floor.rooms) ?? tE;
    const fij      = computeFij({ tInt, tAdj, tE, category, unheatedSpaceTemp: wall.unheatedSpaceTemp, tGround, allowHeatGains });
    const actualDeltaT = fij * (tInt - tE);

    const netArea  = wallNetAreaM2(wall, room.ceilingHeight, floor.openings, floor);
    const heatLoss = netArea * wall.uValue * fij * (tInt - tE);
    const adjRoomId = (category === 'adj_heated' || category === 'adj_reduced')
      ? getAdjacentRoomId(wall, room.id, floor.rooms) : undefined;
    breakdown.push({ elementId: wall.id, elementType: 'wall', boundaryCategory: category, area: netArea, uValue: wall.uValue, fij, actualDeltaT, heatLoss, adjacentRoomId: adjRoomId });

    for (const op of getWallOpenings(wall.id, floor.openings)) {
      const area     = openingAreaM2(op);
      const heatLoss = area * op.uValue * fij * (tInt - tE);
      breakdown.push({ elementId: op.id, elementType: op.type, boundaryCategory: category, area, uValue: op.uValue, fij, actualDeltaT, heatLoss, adjacentRoomId: adjRoomId });
    }
  }

  // Floors
  if (room.area && room.area > 0) {
    const floorSurfaces = room.floors?.length > 0
      ? room.floors
      : [{
          id: `${room.id}_floor_fallback`,
          uValue: room.floorUValue ?? DEFAULT_U_FLOOR,
          boundaryCategory: (room.floorType === 'above_room' ? 'adj_heated'
            : room.floorType === 'exterior' ? 'exterior' : 'ground') as BoundaryCategory,
        }];

    for (let fi = 0; fi < floorSurfaces.length; fi++) {
      const flr  = floorSurfaces[fi];
      const area = flr.areaOverride ?? room.area;
      if (area <= 0) continue;
      const tAdj = (flr.boundaryCategory === 'adj_heated' || flr.boundaryCategory === 'adj_reduced')
        ? (flr.adjacentRoomId ? (allRooms.find(r => r.id === flr.adjacentRoomId)?.designTemperature ?? tE) : tE)
        : tE;
      const floorFij = computeFij({ tInt, tAdj, tE, category: flr.boundaryCategory, unheatedSpaceTemp: flr.unheatedSpaceTemp, tGround, allowHeatGains });
      breakdown.push({
        elementId: `${room.id}_floor_${fi}`, elementType: 'floor', boundaryCategory: flr.boundaryCategory,
        area, uValue: flr.uValue, fij: floorFij,
        actualDeltaT: floorFij * (tInt - tE),
        heatLoss: area * flr.uValue * floorFij * (tInt - tE),
        adjacentRoomId: (flr.boundaryCategory === 'adj_heated' || flr.boundaryCategory === 'adj_reduced')
          ? flr.adjacentRoomId : undefined,
      });
    }

    // Ceilings — iterate all ceiling elements
    const ceilings = room.ceilings?.length > 0
      ? room.ceilings
      : [{ id: `${room.id}_ceil_fallback`, uValue: DEFAULT_U_CEILING, boundaryCategory: 'exterior' as BoundaryCategory }];

    for (let ci = 0; ci < ceilings.length; ci++) {
      const ceil = ceilings[ci];
      const area = ceil.areaOverride ?? room.area;
      if (area <= 0) continue;

      const tAdj = (ceil.boundaryCategory === 'adj_heated' || ceil.boundaryCategory === 'adj_reduced')
        ? (ceil.adjacentRoomId ? (allRooms.find(r => r.id === ceil.adjacentRoomId)?.designTemperature ?? tE) : tE)
        : tE;
      const fij         = computeFij({ tInt, tAdj, tE, category: ceil.boundaryCategory, unheatedSpaceTemp: ceil.unheatedSpaceTemp, tGround, allowHeatGains });
      const actualDeltaT = fij * (tInt - tE);
      breakdown.push({
        elementId: `${room.id}_ceiling_${ci}`, elementType: 'ceiling',
        boundaryCategory: ceil.boundaryCategory,
        area, uValue: ceil.uValue, fij, actualDeltaT,
        heatLoss: area * ceil.uValue * fij * (tInt - tE),
        adjacentRoomId: (ceil.boundaryCategory === 'adj_heated' || ceil.boundaryCategory === 'adj_reduced')
          ? ceil.adjacentRoomId : undefined,
      });
    }
  }

  const transmissionLoss = breakdown.reduce((s, e) => s + e.heatLoss, 0);
  const volumeM3         = room.volumeOverride ?? ((room.area ?? 0) * (room.ceilingHeight / 1000));
  const nMin             = room.minAirChanges ?? DEFAULT_MIN_AIR_CHANGES;
  const ventilationLoss  = 0.34 * volumeM3 * nMin * (tInt - tE);

  return { transmissionLoss, ventilationLoss, totalLoss: transmissionLoss + ventilationLoss, volume: volumeM3, nMin, effectiveTemperature: tInt, elementBreakdown: breakdown };
}

// ---- Room polygon extraction (exported for UI use) ----

export function getRoomPolygon(room: Room, floor: Floor): Point2D[] | null {
  const wm = new Map(floor.walls.map(w => [w.id, w]));
  // Walls appearing more than once are peninsula/spur walls (same room on both sides).
  // Remove all their occurrences — they are interior features, not boundary segments.
  const counts = new Map<string, number>();
  for (const id of room.wallIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const walls = room.wallIds
    .filter(id => counts.get(id) === 1)
    .map(id => wm.get(id))
    .filter(Boolean) as WallSegment[];
  if (walls.length < 3) return null;
  const n = walls.length;
  const pts: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const prev = walls[(i - 1 + n) % n];
    const curr = walls[i];
    let shared: Point2D | null = null;
    outer: for (const p1 of [prev.start, prev.end]) {
      for (const p2 of [curr.start, curr.end]) {
        if (Math.abs(p1.x - p2.x) < 2 && Math.abs(p1.y - p2.y) < 2) { shared = p1; break outer; }
      }
    }
    if (!shared) return null;
    pts.push(shared);
  }
  return pts;
}

// ---- Polygon intersection (Sutherland-Hodgman) ----

function edgeSide(p: Point2D, a: Point2D, b: Point2D): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function lineIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): Point2D | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 0.001) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

function sutherlandHodgman(subject: Point2D[], clip: Point2D[]): Point2D[] {
  let output = [...subject];
  const n = clip.length;
  for (let i = 0; i < n && output.length > 0; i++) {
    const input = output;
    output = [];
    const a = clip[i], b = clip[(i + 1) % n];
    for (let j = 0; j < input.length; j++) {
      const curr = input[j];
      const prev = input[(j - 1 + input.length) % input.length];
      const currSide = edgeSide(curr, a, b);
      const prevSide = edgeSide(prev, a, b);
      const currIn = currSide >= 0;
      const prevIn = prevSide >= 0;
      if (currIn) {
        if (!prevIn) { const p = lineIntersect(prev, curr, a, b); if (p) output.push(p); }
        output.push(curr);
      } else if (prevIn) {
        // When prev lies exactly on the clip edge (prevSide ≈ 0), prev IS the
        // crossing point.  Calling lineIntersect is degenerate in this case
        // (both lines share prev) and returns a spurious far-away point.
        if (Math.abs(prevSide) < 1e-9) {
          output.push({ x: prev.x, y: prev.y });
        } else {
          const p = lineIntersect(prev, curr, a, b);
          if (p) output.push(p);
        }
      }
    }
  }
  return output;
}

function shoelaceArea(pts: Point2D[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area / 2;
}

/** Ear-clip triangulation of a simple polygon. Returns CCW triangles. */
function triangulate(poly: Point2D[]): [Point2D, Point2D, Point2D][] {
  const n = poly.length;
  if (n < 3) return [];
  // Normalise to CCW (shoelaceArea > 0 = CCW in standard maths coords)
  const pts = shoelaceArea(poly) >= 0 ? [...poly] : [...poly].reverse();
  const result: [Point2D, Point2D, Point2D][] = [];
  const rem = [...pts];
  while (rem.length > 3) {
    let clipped = false;
    for (let i = 0; i < rem.length && !clipped; i++) {
      const a = rem[(i - 1 + rem.length) % rem.length];
      const b = rem[i];
      const c = rem[(i + 1) % rem.length];
      // b is reflex if the local triangle is CW or degenerate
      if (edgeSide(c, a, b) <= 0) continue;
      // No other vertex strictly inside triangle (a, b, c)
      const ai = (i - 1 + rem.length) % rem.length;
      const ci = (i + 1) % rem.length;
      let ear = true;
      for (let j = 0; j < rem.length && ear; j++) {
        if (j === ai || j === i || j === ci) continue;
        const p = rem[j];
        if (edgeSide(p, a, b) > 0 && edgeSide(p, b, c) > 0 && edgeSide(p, c, a) > 0) ear = false;
      }
      if (ear) { result.push([a, b, c]); rem.splice(i, 1); clipped = true; }
    }
    if (!clipped) break; // degenerate polygon
  }
  if (rem.length >= 3) result.push([rem[0], rem[1], rem[2]]);
  return result;
}

/**
 * Area of intersection of two simple polygons (mm² when inputs are in mm).
 * Uses ear-clip triangulation so neither polygon needs to be convex.
 */
export function polygonIntersectionArea(a: Point2D[], b: Point2D[]): number {
  const trisA = triangulate(a);
  const trisB = triangulate(b);
  let total = 0;
  for (const ta of trisA) {
    if (Math.abs(shoelaceArea(ta)) < 1) continue; // skip degenerate (zero-area) triangles
    for (const tb of trisB) {
      if (Math.abs(shoelaceArea(tb)) < 1) continue; // degenerate clip ⇒ S-H clips nothing
      const inter = sutherlandHodgman(ta, tb); // triangles are always convex
      if (inter.length >= 3) total += Math.abs(shoelaceArea(inter));
    }
  }
  return total;
}

export function calculateHeizlast(project: Project): HeizlastResult {
  const { temp: tE } = project.designTemperatureOverride !== undefined
    ? { temp: project.designTemperatureOverride }
    : getDesignTemperature(project.plz);
  const tGround       = project.groundTemperature ?? 10;
  const allowHeatGains = project.allowHeatGains ?? false;

  const sortedFloors = [...project.floors].sort((a, b) => a.level - b.level);
  const allRooms: Room[] = sortedFloors.flatMap(f => f.rooms);

  // Build inter-floor adjacency via polygon intersection
  const augmentedCeilings = new Map<string, ThermalSurface[]>();
  const augmentedFloors   = new Map<string, ThermalSurface[]>();

  for (let fi = 0; fi < sortedFloors.length - 1; fi++) {
    const lowerFloor = sortedFloors[fi];
    const upperFloor = sortedFloors[fi + 1];

    for (const lowerRoom of lowerFloor.rooms) {
      if (!lowerRoom.area || lowerRoom.area <= 0) continue;
      const lowerPoly = getRoomPolygon(lowerRoom, lowerFloor);
      if (!lowerPoly) continue;

      const ceilLinks: { roomId: string; area: number; temp: number; flrU: number; roomType: 'heated' | 'reduced' | 'unheated' }[] = [];

      for (const upperRoom of upperFloor.rooms) {
        const upperPoly = getRoomPolygon(upperRoom, upperFloor);
        if (!upperPoly) continue;
        const intersectionMm2 = polygonIntersectionArea(lowerPoly, upperPoly);
        const intersectionM2  = intersectionMm2 / 1_000_000;
        if (intersectionM2 < 0.01) continue;

        // The upper room owns the slab — its floor U-value is the single source of truth.
        const flrU = upperRoom.floors?.[0]?.uValue ?? DEFAULT_U_FLOOR;
        ceilLinks.push({ roomId: upperRoom.id, area: intersectionM2, temp: upperRoom.designTemperature, flrU, roomType: effectiveRoomType(upperRoom) });

        // Upper room: auto floor element toward lower room.
        if (!augmentedFloors.has(upperRoom.id)) augmentedFloors.set(upperRoom.id, []);
        const flrCat: BoundaryCategory = effectiveRoomType(lowerRoom) === 'heated' ? 'adj_heated' : 'adj_reduced';
        augmentedFloors.get(upperRoom.id)!.push({
          id: `${upperRoom.id}_autofloor_${lowerRoom.id}`,
          uValue: flrU,
          boundaryCategory: flrCat,
          adjacentRoomId: lowerRoom.id,
          areaOverride: intersectionM2,
        });
      }

      if (ceilLinks.length > 0) {
        // Each ceiling slice inherits the U-value from the upper room's floor (same slab, one U-value).
        const ceilEntries: ThermalSurface[] = ceilLinks.map(link => {
          const cat: BoundaryCategory = link.roomType === 'heated' ? 'adj_heated' : 'adj_reduced';
          return { id: `${lowerRoom.id}_autoceil_${link.roomId}`, uValue: link.flrU, boundaryCategory: cat, adjacentRoomId: link.roomId, areaOverride: link.area };
        });
        // Residual ceiling area (not covered by any room above) → use user config or exterior.
        // Use the centerline polygon footprint, not room.area (which is the inset/internal-face area),
        // so the residual is consistent with the centerline-based intersection areas.
        const totalIntersection = ceilLinks.reduce((s, l) => s + l.area, 0);
        const ceilingFootprint  = polygonAreaM2(lowerPoly);
        const residual = ceilingFootprint - totalIntersection;
        if (residual > 0.01) {
          const fallback = lowerRoom.ceilings?.[0];
          ceilEntries.push({
            id: `${lowerRoom.id}_autoceil_residual`,
            uValue:           fallback?.uValue           ?? DEFAULT_U_CEILING,
            boundaryCategory: fallback?.boundaryCategory ?? 'exterior',
            unheatedSpaceTemp: fallback?.unheatedSpaceTemp,
            areaOverride: residual,
          });
        }
        augmentedCeilings.set(lowerRoom.id, ceilEntries);
      }
    }
  }

  // Rooms on level > 0 with no intersection partner still carry the 'ground' default
  // from when they were created. That's physically impossible — correct to 'exterior'.
  for (const upperFloor of sortedFloors) {
    if (upperFloor.level <= 0) continue;
    for (const upperRoom of upperFloor.rooms) {
      if (augmentedFloors.has(upperRoom.id)) continue;
      const floors = upperRoom.floors ?? [];
      if (floors.length > 0 && floors.every(f => f.boundaryCategory === 'ground')) {
        augmentedFloors.set(upperRoom.id, floors.map(f => ({ ...f, boundaryCategory: 'exterior' as BoundaryCategory })));
      }
    }
  }

  // Solve equilibrium temperatures for unheated rooms before the main calculation
  const unheatedRoomsWithFloor = sortedFloors.flatMap(fl =>
    fl.rooms.filter(r => effectiveRoomType(r) === 'unheated').map(r => ({ room: r, floor: fl })),
  );
  const equilibriumTemps = unheatedRoomsWithFloor.length > 0
    ? solveEquilibriumTemps(unheatedRoomsWithFloor, augmentedCeilings, augmentedFloors, allRooms, tE, tGround)
    : null;

  // Augment unheated rooms with their computed equilibrium temperature so that
  // calculateRoomHeizlast and same-floor adjacency lookups use the correct value.
  function augmentTemp(r: Room): Room {
    if (!equilibriumTemps) return r;
    const eq = equilibriumTemps.get(r.id);
    return effectiveRoomType(r) === 'unheated' && eq !== undefined ? { ...r, designTemperature: eq } : r;
  }
  const augmentedAllRooms = allRooms.map(augmentTemp);
  const augmentedSortedFloors = sortedFloors.map(fl => ({
    ...fl, rooms: fl.rooms.map(augmentTemp),
  }));

  const roomResults = augmentedSortedFloors.flatMap(floor =>
    floor.rooms.map(room => {
      const augRoom: Room = {
        ...room,
        ceilings: augmentedCeilings.get(room.id) ?? room.ceilings,
        floors:   augmentedFloors.get(room.id)   ?? room.floors,
      };
      return { roomId: room.id, result: calculateRoomHeizlast(augRoom, floor, tE, augmentedAllRooms, tGround, allowHeatGains) };
    }),
  );

  const buildingTotal    = roomResults.reduce((s, r) => s + r.result.totalLoss, 0);
  const totalArea        = allRooms.reduce((s, r) => s + (r.area ?? 0), 0);
  const specificHeatLoad = totalArea > 0 ? buildingTotal / totalArea : 0;

  const lossByCategory = { exterior: 0, ground: 0, adjNeighbor: 0, ventilation: 0 };
  for (const rr of roomResults) {
    for (const el of rr.result.elementBreakdown) {
      if (el.boundaryCategory === 'exterior' || el.boundaryCategory === 'unheated')
        lossByCategory.exterior += el.heatLoss;
      else if (el.boundaryCategory === 'ground')
        lossByCategory.ground += el.heatLoss;
      else if (el.boundaryCategory === 'adj_neighbor')
        lossByCategory.adjNeighbor += el.heatLoss;
    }
    lossByCategory.ventilation += rr.result.ventilationLoss;
  }
  const designHeatLoad = lossByCategory.exterior + lossByCategory.ground + lossByCategory.adjNeighbor + lossByCategory.ventilation;
  const designSpecificHeatLoad = totalArea > 0 ? designHeatLoad / totalArea : 0;

  const hullSummary: HullSummaryEntry[] = project.hullGroups.map(hull => {
    let total = 0;
    let area  = 0;
    for (const rr of roomResults)
      for (const el of rr.result.elementBreakdown)
        if (hull.categories.includes(el.boundaryCategory)) { total += el.heatLoss; area += el.area; }
    return { hullId: hull.id, hullName: hull.name, totalTransmissionLoss: total, totalArea: area, shareOfBuildingTotal: buildingTotal > 0 ? total / buildingTotal : 0 };
  });

  // ── Gaussian error propagation (systematic / correlated model) ───────────
  let sigmaW: number | undefined;
  {
    const { uRelPct = 5, aRelPct = 5, nRelPct = 5 } = project.uncertainty ?? {};
    const eU = uRelPct / 100;
    const eA = aRelPct / 100;
    const eN = nRelPct / 100;
    const combT = Math.sqrt(eU * eU + eA * eA); // combined relative σ for transmission
    const combV = Math.sqrt(eN * eN + eA * eA); // combined relative σ for ventilation

    for (const rr of roomResults) {
      const { transmissionLoss, ventilationLoss } = rr.result;
      rr.result.sigmaW = Math.abs(transmissionLoss) * combT
                       + Math.abs(ventilationLoss)  * combV;
    }

    // Building level: only count losses to the outside (interior walls cancel)
    const phiTExt = lossByCategory.exterior + lossByCategory.ground + lossByCategory.adjNeighbor;
    sigmaW = Math.abs(phiTExt) * combT + Math.abs(lossByCategory.ventilation) * combV;
  }

  return {
    rooms: roomResults, buildingTotal, specificHeatLoad,
    designHeatLoad, designSpecificHeatLoad, lossByCategory,
    designTemperature: tE, plz: project.plz, hullSummary, sigmaW,
  };
}
