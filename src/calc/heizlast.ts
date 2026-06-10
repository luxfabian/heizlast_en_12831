import type {
  Project, Floor, Room, WallSegment, Opening, Point2D, ThermalSurface,
  BoundaryCategory, ElementHeatLoss, RoomHeizlastResult, HeizlastResult, HullSummaryEntry,
} from '../model/types.js';
import { getDesignTemperature } from '../climate/index.js';
import { wallLength, polygonAreaM2 } from '../editor/geometry.js';

const DEFAULT_MIN_AIR_CHANGES = 0.5;
const DEFAULT_U_FLOOR         = 0.25; // W/m²K
const DEFAULT_U_CEILING       = 0.20; // W/m²K — fallback for rooms without ceilings array

/** Temperature correction factor per DIN EN 12831 §6.3.1.2 */
export function computeFij(params: {
  tInt: number;
  tAdj: number;
  tE: number;
  category: BoundaryCategory;
  unheatedSpaceTemp?: number;
  tGround?: number;
}): number {
  const { tInt, tAdj, tE, category, unheatedSpaceTemp, tGround = 10 } = params;
  const denom = tInt - tE;
  if (Math.abs(denom) < 0.001) return 0;
  switch (category) {
    case 'exterior': return 1.0;
    case 'adj_heated':
    case 'adj_reduced': return Math.max(0, (tInt - tAdj) / denom);
    case 'ground':      return (tInt - tGround) / denom;
    case 'unheated': {
      const tU = unheatedSpaceTemp ?? (tE + 0.5 * (tInt - tE));
      return (tInt - tU) / denom;
    }
    case 'adj_neighbor': {
      const tN = unheatedSpaceTemp ?? 15;
      return (tInt - tN) / denom;
    }
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

function getAdjacentRoomTemp(wall: WallSegment, currentRoomId: string, rooms: Room[]): number | undefined {
  // Primary: find a room OTHER than current that shares this wall in its boundary.
  // This is robust regardless of what adjacentRoomId was stored.
  const bySharing = rooms.find(r => r.id !== currentRoomId && r.wallIds.includes(wall.id));
  if (bySharing) return bySharing.designTemperature;
  // Fallback: explicit adjacentRoomId (for manually-set adjacency)
  if (!wall.adjacentRoomId || wall.adjacentRoomId === currentRoomId) return undefined;
  return rooms.find(r => r.id === wall.adjacentRoomId)?.designTemperature;
}

export function calculateRoomHeizlast(
  room: Room,
  floor: Floor,
  tE: number,
  allRooms: Room[],
  tGround = 10,
): RoomHeizlastResult {
  const tInt = room.designTemperature;
  const breakdown: ElementHeatLoss[] = [];

  for (const wallId of room.wallIds) {
    const wall = floor.walls.find(w => w.id === wallId);
    if (!wall) continue;

    const category = wall.boundaryCategory;
    const tAdj     = getAdjacentRoomTemp(wall, room.id, allRooms) ?? tE;
    const fij      = computeFij({ tInt, tAdj, tE, category, unheatedSpaceTemp: wall.unheatedSpaceTemp, tGround });
    const actualDeltaT = fij * (tInt - tE);

    const netArea  = wallNetAreaM2(wall, room.ceilingHeight, floor.openings, floor);
    const heatLoss = netArea * wall.uValue * fij * (tInt - tE);
    breakdown.push({ elementId: wall.id, elementType: 'wall', boundaryCategory: category, area: netArea, uValue: wall.uValue, fij, actualDeltaT, heatLoss });

    for (const op of getWallOpenings(wall.id, floor.openings)) {
      const area     = openingAreaM2(op);
      const heatLoss = area * op.uValue * fij * (tInt - tE);
      breakdown.push({ elementId: op.id, elementType: op.type, boundaryCategory: category, area, uValue: op.uValue, fij, actualDeltaT, heatLoss });
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
      const floorFij = computeFij({ tInt, tAdj, tE, category: flr.boundaryCategory, unheatedSpaceTemp: flr.unheatedSpaceTemp, tGround });
      breakdown.push({
        elementId: `${room.id}_floor_${fi}`, elementType: 'floor', boundaryCategory: flr.boundaryCategory,
        area, uValue: flr.uValue, fij: floorFij,
        actualDeltaT: floorFij * (tInt - tE),
        heatLoss: area * flr.uValue * floorFij * (tInt - tE),
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
      const fij         = computeFij({ tInt, tAdj, tE, category: ceil.boundaryCategory, unheatedSpaceTemp: ceil.unheatedSpaceTemp, tGround });
      const actualDeltaT = fij * (tInt - tE);
      breakdown.push({
        elementId: `${room.id}_ceiling_${ci}`, elementType: 'ceiling',
        boundaryCategory: ceil.boundaryCategory,
        area, uValue: ceil.uValue, fij, actualDeltaT,
        heatLoss: area * ceil.uValue * fij * (tInt - tE),
      });
    }
  }

  const transmissionLoss = breakdown.reduce((s, e) => s + e.heatLoss, 0);
  const volumeM3         = room.volumeOverride ?? ((room.area ?? 0) * (room.ceilingHeight / 1000));
  const nMin             = room.minAirChanges ?? DEFAULT_MIN_AIR_CHANGES;
  const ventilationLoss  = 0.34 * volumeM3 * nMin * (tInt - tE);

  return { transmissionLoss, ventilationLoss, totalLoss: transmissionLoss + ventilationLoss, elementBreakdown: breakdown };
}

// ---- Room polygon extraction (exported for UI use) ----

export function getRoomPolygon(room: Room, floor: Floor): Point2D[] | null {
  const wm = new Map(floor.walls.map(w => [w.id, w]));
  const walls = room.wallIds.map(id => wm.get(id)).filter(Boolean) as WallSegment[];
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

export function polygonIntersectionArea(subject: Point2D[], clip: Point2D[]): number {
  const result = sutherlandHodgman(subject, clip);
  if (result.length < 3) return 0;
  return Math.abs(shoelaceArea(result));
}

export function calculateHeizlast(project: Project): HeizlastResult {
  const { temp: tE } = project.designTemperatureOverride !== undefined
    ? { temp: project.designTemperatureOverride }
    : getDesignTemperature(project.plz);
  const tGround = project.groundTemperature ?? 10;

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

      const ceilLinks: { roomId: string; area: number; temp: number; flrU: number }[] = [];

      for (const upperRoom of upperFloor.rooms) {
        const upperPoly = getRoomPolygon(upperRoom, upperFloor);
        if (!upperPoly) continue;
        const intersectionMm2 = polygonIntersectionArea(lowerPoly, upperPoly);
        const intersectionM2  = intersectionMm2 / 1_000_000;
        if (intersectionM2 < 0.01) continue;

        // The upper room owns the slab — its floor U-value is the single source of truth.
        const flrU = upperRoom.floors?.[0]?.uValue ?? DEFAULT_U_FLOOR;
        ceilLinks.push({ roomId: upperRoom.id, area: intersectionM2, temp: upperRoom.designTemperature, flrU });

        // Upper room: auto floor element toward lower room
        if (!augmentedFloors.has(upperRoom.id)) augmentedFloors.set(upperRoom.id, []);
        const flrCat: BoundaryCategory = Math.abs(upperRoom.designTemperature - lowerRoom.designTemperature) <= 4 ? 'adj_heated' : 'adj_reduced';
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
          const cat: BoundaryCategory = Math.abs(lowerRoom.designTemperature - link.temp) <= 4 ? 'adj_heated' : 'adj_reduced';
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

  const roomResults = sortedFloors.flatMap(floor =>
    floor.rooms.map(room => {
      const augRoom: Room = {
        ...room,
        ceilings: augmentedCeilings.get(room.id) ?? room.ceilings,
        floors:   augmentedFloors.get(room.id)   ?? room.floors,
      };
      return { roomId: room.id, result: calculateRoomHeizlast(augRoom, floor, tE, allRooms, tGround) };
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
    for (const rr of roomResults)
      for (const el of rr.result.elementBreakdown)
        if (hull.categories.includes(el.boundaryCategory)) total += el.heatLoss;
    return { hullId: hull.id, hullName: hull.name, totalTransmissionLoss: total, shareOfBuildingTotal: buildingTotal > 0 ? total / buildingTotal : 0 };
  });

  return {
    rooms: roomResults, buildingTotal, specificHeatLoad,
    designHeatLoad, designSpecificHeatLoad, lossByCategory,
    designTemperature: tE, plz: project.plz, hullSummary,
  };
}
