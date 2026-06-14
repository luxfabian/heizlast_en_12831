import type { WallSegment, Room, Point2D, RoomCeiling, RoomFloor, BoundaryCategory } from '../model/types.js';
import { DEFAULT_CEILING_PRESET_ID } from '../library/presets.js';
import { polygonAreaM2, polygonSignedAreaMm2, insetPolygon } from './geometry.js';
import { v4 as uuidv4 } from '../utils/uuid.js';

function pointKey(p: Point2D): string {
  return `${Math.round(p.x)},${Math.round(p.y)}`;
}

export interface DetectedRoom {
  wallIds: string[];
  polygon: Point2D[];
  area: number; // m²
}

/**
 * Planar half-edge face traversal.
 *
 * For each directed edge u→v, the next directed edge around the same face is
 * v→w, where w is the neighbor of v immediately before u in v's CCW-sorted
 * neighbor list (i.e. the first neighbor reached by rotating clockwise from
 * the direction v→u).
 *
 * Interior faces in Y-down screen coordinates have positive signed area
 * (CW traversal on screen = positive shoelace sum). Only those are returned.
 */
export function detectRooms(walls: WallSegment[]): DetectedRoom[] {
  if (walls.length < 3) return [];

  const wallById = new Map(walls.map(w => [w.id, w]));

  // Build vertex → sorted-neighbor list and directed-edge → wallId map
  const vertexPoints = new Map<string, Point2D>();
  const adjList      = new Map<string, string[]>();
  const edgeWallMap  = new Map<string, string>();

  for (const wall of walls) {
    const sk = pointKey(wall.start);
    const ek = pointKey(wall.end);
    vertexPoints.set(sk, { ...wall.start });
    vertexPoints.set(ek, { ...wall.end });
    if (!adjList.has(sk)) adjList.set(sk, []);
    if (!adjList.has(ek)) adjList.set(ek, []);
    if (!adjList.get(sk)!.includes(ek)) adjList.get(sk)!.push(ek);
    if (!adjList.get(ek)!.includes(sk)) adjList.get(ek)!.push(sk);
    edgeWallMap.set(`${sk}>${ek}`, wall.id);
    edgeWallMap.set(`${ek}>${sk}`, wall.id);
  }

  // Prune degree-1 (leaf) vertices — spur/peninsula walls whose endpoint connects
  // to nothing else. Face traversal would U-turn through them, producing duplicate
  // wall IDs in the result. Remove iteratively because pruning can create new leaves.
  {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [vKey, neighbors] of adjList) {
        if (neighbors.length !== 1) continue;
        const nKey = neighbors[0];
        adjList.delete(vKey);
        vertexPoints.delete(vKey);
        const nNbs = adjList.get(nKey);
        if (nNbs) { const i = nNbs.indexOf(vKey); if (i >= 0) nNbs.splice(i, 1); }
        edgeWallMap.delete(`${vKey}>${nKey}`);
        edgeWallMap.delete(`${nKey}>${vKey}`);
        changed = true;
      }
    }
  }

  // Sort each vertex's neighbors CCW by polar angle
  for (const [vKey, neighbors] of adjList) {
    const vp = vertexPoints.get(vKey)!;
    neighbors.sort((a, b) => {
      const pa = vertexPoints.get(a)!;
      const pb = vertexPoints.get(b)!;
      return Math.atan2(pa.y - vp.y, pa.x - vp.x) -
             Math.atan2(pb.y - vp.y, pb.x - vp.x);
    });
  }

  // For directed edge u→v, next edge in the same face: v→w where w is the
  // predecessor of u in v's CCW neighbor list (= first CW rotation from v→u)
  const nextEdge = (uKey: string, vKey: string): string => {
    const nb = adjList.get(vKey)!;
    const idx = nb.indexOf(uKey);
    return nb[(idx - 1 + nb.length) % nb.length];
  };

  const visitedEdges = new Set<string>();
  const results: DetectedRoom[] = [];

  for (const [uKey, neighbors] of adjList) {
    for (const vKey of neighbors) {
      const startKey = `${uKey}>${vKey}`;
      if (visitedEdges.has(startKey)) continue;

      const faceKeys: string[] = [];
      let cu = uKey, cv = vKey;
      const limit = walls.length * 3 + 10;

      for (let i = 0; i < limit; i++) {
        const ek = `${cu}>${cv}`;
        if (visitedEdges.has(ek)) break;
        visitedEdges.add(ek);
        faceKeys.push(cu);
        const nw = nextEdge(cu, cv);
        cu = cv;
        cv = nw;
      }

      if (faceKeys.length < 3) continue;

      const polygon = faceKeys.map(k => vertexPoints.get(k)!);

      // Interior faces in Y-down coords have positive signed area
      if (polygonSignedAreaMm2(polygon) <= 0) continue;

      const wallIds: string[] = [];
      for (let i = 0; i < faceKeys.length; i++) {
        const a = faceKeys[i];
        const b = faceKeys[(i + 1) % faceKeys.length];
        const wId = edgeWallMap.get(`${a}>${b}`);
        if (wId) wallIds.push(wId);
      }

      if (wallIds.length < 3) continue;

      const halfOffsets = wallIds.map(id => (wallById.get(id)?.thickness ?? 0) / 2);
      const internalPoly = insetPolygon(polygon, halfOffsets);
      const area = polygonAreaM2(internalPoly);
      if (area > 0) results.push({ wallIds, polygon, area });
    }
  }

  return results;
}

export function mergeDetectedRooms(
  detected: DetectedRoom[],
  existingRooms: Room[],
  defaultCeilingHeight: number,
  floorLevel = 0,
): Room[] {
  const updated: Room[] = [];

  for (const d of detected) {
    const wallSetKey = [...d.wallIds].sort().join('|');
    const existing = existingRooms.find(r => {
      if ([...r.wallIds].sort().join('|') === wallSetKey) return true;
      // Fallback: existing room may have spur walls (duplicate IDs) from old project data.
      // Remove duplicate-ID walls to get the pruned set and compare against detected.
      const counts = new Map<string, number>();
      for (const id of r.wallIds) counts.set(id, (counts.get(id) ?? 0) + 1);
      const pruned = [...new Set(r.wallIds.filter(id => counts.get(id) === 1))].sort().join('|');
      return pruned === wallSetKey;
    });

    if (existing) {
      const ceilings: RoomCeiling[] = existing.ceilings?.length > 0
        ? existing.ceilings
        : [defaultCeiling()];
      const floors: RoomFloor[] = existing.floors?.length > 0
        ? existing.floors
        : [migrateFloor(existing)];
      // Always use the detected (pruned) wallIds so old spur data is cleaned up.
      updated.push({ ...existing, wallIds: d.wallIds, ceilings, floors, area: d.area });
    } else {
      // No exact match. Check whether this detected region was carved out of an
      // existing room by a new bisecting wall. If so, inherit its temperature and
      // settings so that the bisecting wall sits between two same-temperature spaces
      // and contributes zero net heat loss (fij = 0), rather than producing
      // spurious heat loss via the default-temperature fallback.
      const parent = existingRooms
        .map(r => ({ r, n: d.wallIds.filter(id => r.wallIds.includes(id)).length }))
        .reduce<{ r: Room | null; n: number }>((best, x) => x.n > best.n ? x : best, { r: null, n: 0 });

      if (parent.n > 0 && parent.r) {
        const ceilings: RoomCeiling[] = parent.r.ceilings?.length > 0
          ? parent.r.ceilings
          : [defaultCeiling()];
        const floors: RoomFloor[] = parent.r.floors?.length > 0
          ? parent.r.floors
          : [migrateFloor(parent.r)];
        updated.push({ ...parent.r, id: uuidv4(), wallIds: d.wallIds, ceilings, floors, area: d.area });
      } else {
        updated.push({
          id: uuidv4(),
          label: `Raum ${updated.length + 1}`,
          wallIds: d.wallIds,
          designTemperature: 20,
          ceilingHeight: defaultCeilingHeight,
          floors: [floorLevel > 0 ? defaultUpperFloor() : defaultFloor()],
          ceilings: [defaultCeiling()],
          area: d.area,
        });
      }
    }
  }

  return updated;
}

function defaultCeiling(): RoomCeiling {
  return { id: uuidv4(), uValue: 0.20, boundaryCategory: 'exterior', typePresetId: DEFAULT_CEILING_PRESET_ID };
}

function defaultFloor(): RoomFloor {
  return { id: uuidv4(), uValue: 0.25, boundaryCategory: 'ground', typePresetId: 'floor_neubau' };
}

function defaultUpperFloor(): RoomFloor {
  return { id: uuidv4(), uValue: 0.25, boundaryCategory: 'exterior', typePresetId: 'floor_ext' };
}

function migrateFloor(room: Room): RoomFloor {
  const cat: BoundaryCategory =
    room.floorType === 'above_room' ? 'adj_heated' :
    room.floorType === 'exterior'   ? 'exterior'   : 'ground';
  const presetId =
    cat === 'adj_heated' ? 'floor_above' :
    cat === 'exterior'   ? 'floor_ext'   : 'floor_neubau';
  return { id: uuidv4(), uValue: room.floorUValue ?? 0.25, boundaryCategory: cat, typePresetId: presetId };
}

/** Find all wall endpoint coordinates for snap targets */
export function getAllEndpoints(walls: WallSegment[]): Point2D[] {
  const seen = new Set<string>();
  const pts: Point2D[] = [];
  for (const w of walls) {
    for (const p of [w.start, w.end]) {
      const k = pointKey(p);
      if (!seen.has(k)) { seen.add(k); pts.push(p); }
    }
  }
  return pts;
}

/** Snap a new point to an existing endpoint if within threshold mm.
 *  Pass `exclude` to skip the vertex currently being dragged (avoids self-snap). */
export function snapToExistingEndpoint(
  p: Point2D,
  walls: WallSegment[],
  thresholdMm: number,
  exclude?: Point2D,
): Point2D {
  const eps = getAllEndpoints(walls);
  for (const ep of eps) {
    if (exclude && Math.abs(ep.x - exclude.x) < 1 && Math.abs(ep.y - exclude.y) < 1) continue;
    const dx = p.x - ep.x, dy = p.y - ep.y;
    if (Math.sqrt(dx * dx + dy * dy) <= thresholdMm) return ep;
  }
  return p;
}
