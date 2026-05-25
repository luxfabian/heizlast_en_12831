import type {
  Project, Floor, Room, WallSegment, Opening,
  BoundaryCategory, ElementHeatLoss, RoomHeizlastResult, HeizlastResult, HullSummaryEntry,
} from '../model/types.js';
import { getDesignTemperature } from '../climate/index.js';
import { wallLength } from '../editor/geometry.js';

const DEFAULT_MIN_AIR_CHANGES = 0.5;
const DEFAULT_U_FLOOR         = 0.25; // W/m²K
const DEFAULT_U_CEILING       = 0.20; // W/m²K

/** Temperature correction factor per DIN EN 12831 §6.3.1.2 */
export function computeFij(params: {
  tInt: number;
  tAdj: number;
  tE: number;
  category: BoundaryCategory;
  unheatedSpaceTemp?: number;
}): number {
  const { tInt, tAdj, tE, category, unheatedSpaceTemp } = params;
  const denom = tInt - tE;
  if (Math.abs(denom) < 0.001) return 0;
  switch (category) {
    case 'exterior': return 1.0;
    case 'adj_heated':
    case 'adj_reduced': return Math.max(0, (tInt - tAdj) / denom);
    case 'ground':      return 0.45;
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
): RoomHeizlastResult {
  const tInt = room.designTemperature;
  const breakdown: ElementHeatLoss[] = [];

  for (const wallId of room.wallIds) {
    const wall = floor.walls.find(w => w.id === wallId);
    if (!wall) continue;

    const category = wall.boundaryCategory;
    const tAdj     = getAdjacentRoomTemp(wall, room.id, allRooms) ?? tE;
    const fij      = computeFij({ tInt, tAdj, tE, category, unheatedSpaceTemp: wall.unheatedSpaceTemp });
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

  // Floor
  if (room.area && room.area > 0) {
    const floorCat  = room.floorType === 'ground' ? 'ground' : 'exterior' as BoundaryCategory;
    const floorFij  = computeFij({ tInt, tAdj: tE, tE, category: floorCat });
    breakdown.push({
      elementId: `${room.id}_floor`, elementType: 'floor', boundaryCategory: floorCat,
      area: room.area, uValue: DEFAULT_U_FLOOR, fij: floorFij,
      actualDeltaT: floorFij * (tInt - tE),
      heatLoss: room.area * DEFAULT_U_FLOOR * floorFij * (tInt - tE),
    });

    // Ceiling (Phase 1: always exterior top floor)
    const ceilFij = computeFij({ tInt, tAdj: tE, tE, category: 'exterior' });
    breakdown.push({
      elementId: `${room.id}_ceiling`, elementType: 'ceiling', boundaryCategory: 'exterior',
      area: room.area, uValue: DEFAULT_U_CEILING, fij: ceilFij,
      actualDeltaT: ceilFij * (tInt - tE),
      heatLoss: room.area * DEFAULT_U_CEILING * ceilFij * (tInt - tE),
    });
  }

  const transmissionLoss = breakdown.reduce((s, e) => s + e.heatLoss, 0);
  const volumeM3         = (room.area ?? 0) * (room.ceilingHeight / 1000);
  const nMin             = room.minAirChanges ?? DEFAULT_MIN_AIR_CHANGES;
  const ventilationLoss  = 0.34 * volumeM3 * nMin * (tInt - tE);

  return { transmissionLoss, ventilationLoss, totalLoss: transmissionLoss + ventilationLoss, elementBreakdown: breakdown };
}

export function calculateHeizlast(project: Project): HeizlastResult {
  const { temp: tE } = project.designTemperatureOverride !== undefined
    ? { temp: project.designTemperatureOverride }
    : getDesignTemperature(project.plz);

  const floor = project.floors[0];
  const rooms = floor.rooms;

  const roomResults = rooms.map(room => ({
    roomId: room.id,
    result: calculateRoomHeizlast(room, floor, tE, rooms),
  }));

  const buildingTotal    = roomResults.reduce((s, r) => s + r.result.totalLoss, 0);
  const totalArea        = rooms.reduce((s, r) => s + (r.area ?? 0), 0);
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
