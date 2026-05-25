import type { WallSegment, Room, Point2D } from '../model/types.js';
import { polygonAreaM2, polygonSignedAreaMm2, insetPolygon } from './geometry.js';
import { v4 as uuidv4 } from '../utils/uuid.js';

interface GraphNode {
  key: string;
  point: Point2D;
  neighbors: Map<string, string>; // neighborKey -> wallId
}

function pointKey(p: Point2D): string {
  return `${Math.round(p.x)},${Math.round(p.y)}`;
}

function buildGraph(walls: WallSegment[]): Map<string, GraphNode> {
  const graph = new Map<string, GraphNode>();

  const getOrCreate = (p: Point2D): GraphNode => {
    const k = pointKey(p);
    if (!graph.has(k)) {
      graph.set(k, { key: k, point: { ...p }, neighbors: new Map() });
    }
    return graph.get(k)!;
  };

  for (const wall of walls) {
    const sNode = getOrCreate(wall.start);
    const eNode = getOrCreate(wall.end);
    sNode.neighbors.set(eNode.key, wall.id);
    eNode.neighbors.set(sNode.key, wall.id);
  }

  return graph;
}

/** Find all minimal simple cycles using DFS. Returns arrays of point keys forming cycles. */
function findCycles(graph: Map<string, GraphNode>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();

  const dfs = (
    current: string,
    parent: string | null,
    start: string,
    path: string[]
  ): void => {
    path.push(current);
    const node = graph.get(current)!;

    for (const [neighbor] of node.neighbors) {
      if (neighbor === parent) continue;
      if (neighbor === start && path.length >= 3) {
        cycles.push([...path]);
        continue;
      }
      if (!visited.has(neighbor) && !path.includes(neighbor)) {
        dfs(neighbor, current, start, path);
      }
    }
    path.pop();
  };

  for (const [key] of graph) {
    if (!visited.has(key)) {
      dfs(key, null, key, []);
      visited.add(key);
    }
  }

  return cycles;
}

/** Remove duplicate cycles (same set of vertices) */
function deduplicateCycles(cycles: string[][]): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const cycle of cycles) {
    const sorted = [...cycle].sort().join('|');
    if (!seen.has(sorted)) {
      seen.add(sorted);
      result.push(cycle);
    }
  }
  return result;
}

/** Filter to only minimal cycles (not a superset of any smaller cycle) */
function filterMinimalCycles(cycles: string[][]): string[][] {
  const deduped = deduplicateCycles(cycles);
  const sets = deduped.map(c => new Set(c));
  return deduped.filter((_, i) => {
    for (let j = 0; j < deduped.length; j++) {
      if (i === j) continue;
      if (sets[j].size < sets[i].size) {
        let isSubset = true;
        for (const v of sets[j]) {
          if (!sets[i].has(v)) { isSubset = false; break; }
        }
        if (isSubset) return false;
      }
    }
    return true;
  });
}

function cycleToPolygon(cycle: string[], graph: Map<string, GraphNode>): Point2D[] {
  return cycle.map(key => graph.get(key)!.point);
}

/** Ensure polygon is CCW (positive signed area) */
function ensureCCW(poly: Point2D[]): Point2D[] {
  if (polygonSignedAreaMm2(poly) < 0) return [...poly].reverse();
  return poly;
}

/** Derive wall IDs in polygon edge order from the final (CCW-normalised) polygon.
 *  Graph edges are bidirectional so this works regardless of original cycle direction. */
function polygonPointsToWallIds(polygon: Point2D[], graph: Map<string, GraphNode>): string[] {
  const ids: string[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const aKey = pointKey(polygon[i]);
    const bKey = pointKey(polygon[(i + 1) % polygon.length]);
    const wallId = graph.get(aKey)?.neighbors.get(bKey);
    if (wallId) ids.push(wallId);
  }
  return ids;
}

export interface DetectedRoom {
  wallIds: string[];
  polygon: Point2D[];
  area: number; // m²
}

export function detectRooms(walls: WallSegment[]): DetectedRoom[] {
  if (walls.length < 3) return [];

  const wallById = new Map(walls.map(w => [w.id, w]));
  const graph = buildGraph(walls);
  const allCycles = findCycles(graph);
  const minimal = filterMinimalCycles(allCycles);

  return minimal
    .map(cycle => {
      const polygon = ensureCCW(cycleToPolygon(cycle, graph));
      // Derive wall IDs from the CCW polygon so edge-index correspondence is exact.
      const wallIds = polygonPointsToWallIds(polygon, graph);
      // Compute internal area by insetting each edge by half the corresponding wall thickness.
      const halfOffsets = wallIds.map(id => (wallById.get(id)?.thickness ?? 0) / 2);
      const internalPoly = insetPolygon(polygon, halfOffsets);
      const area = polygonAreaM2(internalPoly);
      return { wallIds, polygon, area };
    })
    .filter(r => r.area > 0); // discard degenerate (walls so thick room collapses)
}

export function mergeDetectedRooms(
  detected: DetectedRoom[],
  existingRooms: Room[],
  defaultCeilingHeight: number
): Room[] {
  const updated: Room[] = [];

  for (const d of detected) {
    const wallSetKey = [...d.wallIds].sort().join('|');
    const existing = existingRooms.find(r => {
      return [...r.wallIds].sort().join('|') === wallSetKey;
    });

    if (existing) {
      updated.push({ ...existing, area: d.area });
    } else {
      updated.push({
        id: uuidv4(),
        label: `Raum ${updated.length + 1}`,
        wallIds: d.wallIds,
        designTemperature: 20,
        ceilingHeight: defaultCeilingHeight,
        floorType: 'ground',
        area: d.area,
      });
    }
  }

  return updated;
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

/** Snap a new point to an existing endpoint if within threshold mm */
export function snapToExistingEndpoint(
  p: Point2D,
  walls: WallSegment[],
  thresholdMm: number
): Point2D {
  const eps = getAllEndpoints(walls);
  for (const ep of eps) {
    const dx = p.x - ep.x, dy = p.y - ep.y;
    if (Math.sqrt(dx * dx + dy * dy) <= thresholdMm) return ep;
  }
  return p;
}
