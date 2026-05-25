import type { Point2D } from '../model/types.js';

export function dist(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function pointsEqual(a: Point2D, b: Point2D): boolean {
  return a.x === b.x && a.y === b.y;
}

export function snapToGrid(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

export function snapPoint(p: Point2D, grid: number): Point2D {
  return { x: snapToGrid(p.x, grid), y: snapToGrid(p.y, grid) };
}

export function snapToEndpoint(p: Point2D, points: Point2D[], threshold: number): Point2D | null {
  for (const ep of points) {
    if (dist(p, ep) <= threshold) return ep;
  }
  return null;
}

/** Outward normal of segment (start→end), perpendicular and pointing "outward" (right-hand side) */
export function wallNormal(start: Point2D, end: Point2D): Point2D {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { x: 0, y: 0 };
  return { x: dy / len, y: -dx / len };
}

/** Shoelace formula — returns signed area in mm² (positive if CCW) */
export function polygonSignedAreaMm2(poly: Point2D[]): number {
  let area = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return area / 2;
}

/** Returns area in m² (always positive) */
export function polygonAreaM2(poly: Point2D[]): number {
  return Math.abs(polygonSignedAreaMm2(poly)) / 1_000_000;
}

export function polygonCentroid(poly: Point2D[]): Point2D {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  return { x: cx / n, y: cy / n };
}

export function pointInPolygon(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y))
      && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Distance from point to segment, returns { dist, t } where t ∈ [0,1] along segment */
export function distPointToSegment(p: Point2D, a: Point2D, b: Point2D): { dist: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { dist: dist(p, a), t: 0 };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return { dist: dist(p, proj), t };
}

export function wallLength(start: Point2D, end: Point2D): number {
  return dist(start, end);
}

/** World-space start and end points of an opening on a wall */
export function openingEndpoints(
  positionAlongWall: number,
  width: number,
  wallStart: Point2D,
  wallEnd: Point2D,
): { opStart: Point2D; opEnd: Point2D } {
  const dx = wallEnd.x - wallStart.x;
  const dy = wallEnd.y - wallStart.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { opStart: wallStart, opEnd: wallStart };
  const ux = dx / len, uy = dy / len;
  const opStart: Point2D = {
    x: wallStart.x + ux * positionAlongWall,
    y: wallStart.y + uy * positionAlongWall,
  };
  return {
    opStart,
    opEnd: { x: opStart.x + ux * width, y: opStart.y + uy * width },
  };
}

/** Returns the four corners of a wall rectangle (inner-start, inner-end, outer-end, outer-start) */
export function wallRect(start: Point2D, end: Point2D, thickness: number): [Point2D, Point2D, Point2D, Point2D] {
  const n = wallNormal(start, end);
  const ox = n.x * thickness;
  const oy = n.y * thickness;
  return [
    start,
    end,
    { x: end.x + ox, y: end.y + oy },
    { x: start.x + ox, y: start.y + oy },
  ];
}

/** Segment length in mm */
export function segmentLength(start: Point2D, end: Point2D): number {
  return dist(start, end);
}

/** Returns the orientation label (N/S/E/W) based on the wall direction */
export function wallOrientation(start: Point2D, end: Point2D): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle >= -45 && angle < 45) return 'O';
  if (angle >= 45 && angle < 135) return 'S';
  if (angle >= -135 && angle < -45) return 'N';
  return 'W';
}

/**
 * Inset a CCW polygon (y-down screen coordinates) by per-edge half-offsets.
 * Each edge i is shifted inward by halfOffsets[i]; new vertices are the
 * intersections of adjacent inset edges.  Used to compute internal room area.
 */
export function insetPolygon(polygon: Point2D[], halfOffsets: number[]): Point2D[] {
  const n = polygon.length;
  if (n < 3) return [...polygon];

  // Build inset lines: shift each edge inward by its offset.
  // Inward normal for CCW polygon in y-down coords = (-dy, dx) / len.
  const lines: { p1: Point2D; p2: Point2D }[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const off = halfOffsets[i] ?? 0;
    if (len < 0.001 || off === 0) {
      lines.push({ p1: { ...p1 }, p2: { ...p2 } });
    } else {
      const nx = (-dy / len) * off;
      const ny = (dx / len) * off;
      lines.push({
        p1: { x: p1.x + nx, y: p1.y + ny },
        p2: { x: p2.x + nx, y: p2.y + ny },
      });
    }
  }

  // New vertex i = intersection of inset edge (i-1) and inset edge i.
  const result: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const pt = lineIntersection(l1.p1, l1.p2, l2.p1, l2.p2);
    result.push(pt ?? l2.p1);
  }
  return result;
}

/** Intersection of two infinite lines; returns null if parallel */
export function lineIntersection(
  p1: Point2D, p2: Point2D,
  p3: Point2D, p4: Point2D
): Point2D | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}
