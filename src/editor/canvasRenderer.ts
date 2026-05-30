import type { Floor, Room, WallSegment, Point2D } from '../model/types.js';
import type { Viewport } from './viewport.js';
import { worldToCanvas, canvasToWorld } from './viewport.js';
import { polygonCentroid } from './geometry.js';
import { getBoundaryCategoryColor, getBoundaryCategoryShort } from './adjacency.js';
import type { HeizlastResult } from '../model/types.js';
import type { ToolMode } from './editorState.js';

// ---- Dark CAD palette ----
const BG             = '#0f1117';
const GRID_MAJOR     = '#1e2535';
const GRID_MINOR     = '#161c28';
const GRID_ORIGIN    = '#2a3550';
const WALL_FILL      = '#2d4a6a';
const WALL_FILL_SEL  = '#2a5a8a';
const WALL_FILL_HOV  = '#3a5a7a';
const ENDPOINT_DOT   = '#4a9eff';
const ENDPOINT_SNAP  = '#00e5ff';
const DRAW_START_DOT = '#00e5ff';
const PREVIEW_LINE   = '#3b82f6';
const PREVIEW_GHOST  = 'rgba(59,130,246,0.20)';
const ROOM_DEFAULT   = 'rgba(30,58,138,0.14)';
const ROOM_SELECTED  = 'rgba(6,182,212,0.20)';
const ROOM_LABEL     = '#93c5fd';
const ROOM_LABEL_SEL = '#e0f2fe';
const HEAT_VALUE     = '#94a3b8';
const CURSOR_CROSS   = '#00e5ff';
const DIM_TEXT       = '#4a9eff';
const DIM_LINE       = '#2a4a7a';

export interface RenderState {
  hoveredWallId?: string;
  selectedRoomId?: string;
  selectedWallId?: string;
  selectedOpeningId?: string;
  draggingVertexWallId?: string;
  draggingOpeningId?: string;
  drawStart?: Point2D;
  previewEnd?: Point2D;
  heizlastResult?: HeizlastResult;
  showHeatMap: boolean;
  gridEnabled: boolean;
  tool: ToolMode;
}

/** t = 0..1 (normalized by max room loss) */
export function heatLoadColor(t: number): string {
  const r = Math.round(10 + t * 200);
  const g = Math.round(60 - t * 40);
  const b = Math.round(160 - t * 140);
  return `rgba(${r},${g},${b},0.45)`;
}

export function renderFloor(
  ctx: CanvasRenderingContext2D,
  floor: Floor,
  vp: Viewport,
  state: RenderState,
  w: number,
  h: number,
  ghostFloors?: Floor[],
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  if (state.gridEnabled) drawGrid(ctx, vp, w, h);

  if (ghostFloors?.length) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    for (const gf of ghostFloors) drawWallsSimple(ctx, gf, vp);
    ctx.restore();
  }

  drawRooms(ctx, floor, vp, state);
  drawWallsAndOpenings(ctx, floor, vp, state);
  drawPreview(ctx, vp, state);
  drawRoomLabels(ctx, floor, vp, state);
  drawCursorCross(ctx, vp, state);
}

// ---- Ghost floor overlay ----

function drawWallsSimple(ctx: CanvasRenderingContext2D, floor: Floor, vp: Viewport): void {
  for (const wall of floor.walls) {
    const cs = worldToCanvas(wall.start, vp);
    const ce = worldToCanvas(wall.end,   vp);
    const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    if (len < 1) continue;
    const halfT = wall.thickness / 2 * vp.scale;
    const lenPx = len * vp.scale;
    const ang   = Math.atan2(ce.y - cs.y, ce.x - cs.x);
    ctx.save();
    ctx.translate(cs.x, cs.y);
    ctx.rotate(ang);
    ctx.fillStyle = WALL_FILL;
    ctx.beginPath();
    ctx.moveTo(0, -halfT); ctx.lineTo(lenPx, -halfT);
    ctx.lineTo(lenPx, halfT); ctx.lineTo(0, halfT);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// ---- Grid ----

function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, w: number, h: number): void {
  const majorMm = 1000, minorMm = 100;
  const tl = canvasToWorld({ x: 0, y: 0 }, vp);
  const br = canvasToWorld({ x: w, y: h }, vp);
  const x0 = Math.floor(tl.x / minorMm) * minorMm;
  const y0 = Math.floor(tl.y / minorMm) * minorMm;

  for (let x = x0; x <= br.x; x += minorMm) {
    const cx = worldToCanvas({ x, y: 0 }, vp).x;
    const isMajor = x % majorMm === 0;
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.strokeStyle = x === 0 ? GRID_ORIGIN : isMajor ? GRID_MAJOR : GRID_MINOR;
    ctx.lineWidth   = x === 0 ? 1.5 : isMajor ? 0.8 : 0.4;
    ctx.stroke();
  }
  for (let y = y0; y <= br.y; y += minorMm) {
    const cy = worldToCanvas({ x: 0, y }, vp).y;
    const isMajor = y % majorMm === 0;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.strokeStyle = y === 0 ? GRID_ORIGIN : isMajor ? GRID_MAJOR : GRID_MINOR;
    ctx.lineWidth   = y === 0 ? 1.5 : isMajor ? 0.8 : 0.4;
    ctx.stroke();
  }
}

// ---- Rooms ----

/** Shared endpoint between two adjacent walls (within 2 mm tolerance). */
function sharedEndpoint(w1: WallSegment, w2: WallSegment): Point2D | null {
  const EPS = 2;
  for (const p1 of [w1.start, w1.end]) {
    for (const p2 of [w2.start, w2.end]) {
      if (Math.abs(p1.x - p2.x) < EPS && Math.abs(p1.y - p2.y) < EPS) return p1;
    }
  }
  return null;
}

/**
 * Reconstruct the room polygon by finding the shared corner between each pair
 * of consecutive boundary walls.  This is correct regardless of individual
 * wall start/end orientation.
 */
function getRoomPoly(room: Room, floor: Floor): Point2D[] | null {
  const wm = new Map(floor.walls.map(w => [w.id, w]));
  const walls = room.wallIds.map(id => wm.get(id)).filter(Boolean) as WallSegment[];
  if (walls.length < 3) return null;
  const n = walls.length;
  const pts: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const p = sharedEndpoint(walls[(i - 1 + n) % n], walls[i]);
    if (!p) return null;
    pts.push(p);
  }
  return pts;
}

function drawRooms(ctx: CanvasRenderingContext2D, floor: Floor, vp: Viewport, state: RenderState): void {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const maxLoss = state.showHeatMap && state.heizlastResult
    ? Math.max(...state.heizlastResult.rooms.map(r => r.result.totalLoss), 1)
    : 1;
  for (const room of floor.rooms) {
    const poly = getRoomPoly(room, floor);
    if (!poly) continue;
    const pts = poly.map(p => worldToCanvas(p, vp));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (state.showHeatMap && state.heizlastResult) {
      const rr = state.heizlastResult.rooms.find(r => r.roomId === room.id);
      ctx.fillStyle = rr ? heatLoadColor(rr.result.totalLoss / maxLoss) : ROOM_DEFAULT;
    } else {
      ctx.fillStyle = room.id === state.selectedRoomId ? ROOM_SELECTED : ROOM_DEFAULT;
    }
    ctx.fill();
  }
  ctx.restore();

  for (const room of floor.rooms) {
    if (room.id !== state.selectedRoomId) continue;
    const poly = getRoomPoly(room, floor);
    if (!poly) continue;
    const pts = poly.map(p => worldToCanvas(p, vp));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ---- Wall joint helpers ----

function vKey(p: Point2D): string { return `${Math.round(p.x)},${Math.round(p.y)}`; }

/** Build vertex → walls map for miter and end-cap decisions. */
function buildVtxWalls(walls: WallSegment[]): Map<string, WallSegment[]> {
  const map = new Map<string, WallSegment[]>();
  for (const w of walls) {
    for (const p of [w.start, w.end]) {
      const k = vKey(p);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(w);
    }
  }
  return map;
}

/**
 * Compute per-face miter deltas for one endpoint of a wall.
 *
 * Returns { top, bot } where:
 *   START: xTopStart = -top,          xBotStart = +bot
 *   END:   xTopEnd   = wallLenPx+top, xBotEnd   = wallLenPx-bot
 *
 * For an L-corner (single neighbour) both faces share one delta (diagonal miter).
 * For a T-junction (neighbours on both sides of W1) each face is clipped independently.
 *
 * sinA < 0 → neighbour is on the TOP side of W1 (y < 0 in wall-local space)
 * sinA > 0 → neighbour is on the BOTTOM side of W1 (y > 0)
 */
function miterDeltas(
  vertex: Point2D,
  d1x: number, d1y: number,
  T1: number,
  wallId: string,
  vtx: Map<string, WallSegment[]>,
  scale: number,
  isEnd: boolean,
): { top: number; bot: number } {
  const neighbors = (vtx.get(vKey(vertex)) ?? []).filter(w => w.id !== wallId);
  if (neighbors.length === 0) return { top: 0, bot: 0 };

  const eq = (a: Point2D, b: Point2D) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;

  const topDeltas: number[] = [];  // sinA < 0 (top-side neighbours)
  const botDeltas: number[] = [];  // sinA > 0 (bottom-side neighbours)

  for (const w2 of neighbors) {
    const other = eq(w2.start, vertex) ? w2.end : w2.start;
    const dx2 = other.x - vertex.x, dy2 = other.y - vertex.y;
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    if (len2 < 0.001) continue;

    const d2x = dx2 / len2, d2y = dy2 / len2;
    const cosA = d1x * d2x + d1y * d2y;
    const sinA = d1x * d2y - d1y * d2x;
    const T2   = w2.thickness / 2 * scale;

    if (Math.abs(sinA) < 0.1) {
      // Nearly parallel: extend both faces by T2
      topDeltas.push(T2); botDeltas.push(T2);
      continue;
    }

    const raw = isEnd
      ? (T2 - T1 * cosA) / sinA
      : (T2 + T1 * cosA) / sinA;
    const cap   = 4 * Math.max(T1, T2);
    const delta = Math.abs(raw) > cap ? T2 : raw;

    if (sinA < 0) topDeltas.push(delta);
    else           botDeltas.push(delta);
  }

  if (topDeltas.length === 0 && botDeltas.length === 0) return { top: 0, bot: 0 };

  if (topDeltas.length > 0 && botDeltas.length > 0) {
    // T-junction: clip each face with its own most-restrictive neighbour
    const topD = topDeltas.reduce((a, b) => a < b ? a : b);   // most negative
    const botD = botDeltas.reduce((a, b) => a > b ? a : b);   // most positive
    return { top: topD, bot: botD };
  }

  // L-corner (one side only): same delta drives the diagonal on both corners
  if (topDeltas.length > 0) {
    const d = topDeltas.reduce((a, b) => a < b ? a : b);
    return { top: d, bot: d };
  }
  const d = botDeltas.reduce((a, b) => a > b ? a : b);
  return { top: d, bot: d };
}

// ---- Convex hull (Andrew's monotone chain) ----

function convexHull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 3) return pts;
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x:number;y:number }, a: { x:number;y:number }, b: { x:number;y:number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const h: { x: number; y: number }[] = [];
  for (const p of s) {
    while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
    h.push(p);
  }
  const lo = h.length + 1;
  for (let i = s.length - 1; i >= 0; i--) {
    while (h.length >= lo && cross(h[h.length - 2], h[h.length - 1], s[i]) <= 0) h.pop();
    h.push(s[i]);
  }
  h.pop();
  return h;
}

// ---- Walls and Openings ----

function drawWallsAndOpenings(ctx: CanvasRenderingContext2D, floor: Floor, vp: Viewport, state: RenderState): void {
  const wallOpenings = new Map<string, typeof floor.openings>();
  for (const op of floor.openings) {
    const arr = wallOpenings.get(op.wallId) ?? [];
    arr.push(op);
    wallOpenings.set(op.wallId, arr);
  }

  const vtx = buildVtxWalls(floor.walls);

  // ---- Pre-pass: collect miter-diagonal canvas endpoints per vertex for gap fill ----
  const vertexFillPts = new Map<string, { x: number; y: number }[]>();
  for (const wall of floor.walls) {
    const cs2 = worldToCanvas(wall.start, vp);
    const ce2 = worldToCanvas(wall.end,   vp);
    const wLen = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const wLenPx = wLen * vp.scale;
    if (wLenPx < 1) continue;
    const hT = wall.thickness / 2 * vp.scale;
    const ang = Math.atan2(ce2.y - cs2.y, ce2.x - cs2.x);
    const d1x2 = (wall.end.x - wall.start.x) / wLen;
    const d1y2 = (wall.end.y - wall.start.y) / wLen;
    const { top: dsT, bot: dsB } = miterDeltas(wall.start, d1x2, d1y2, hT, wall.id, vtx, vp.scale, false);
    const { top: deT, bot: deB } = miterDeltas(wall.end,   d1x2, d1y2, hT, wall.id, vtx, vp.scale, true);
    const lc = (lx: number, ly: number) => ({
      x: cs2.x + lx * Math.cos(ang) - ly * Math.sin(ang),
      y: cs2.y + lx * Math.sin(ang) + ly * Math.cos(ang),
    });
    const addP = (k: string, p: { x: number; y: number }) => {
      if (!vertexFillPts.has(k)) vertexFillPts.set(k, []);
      vertexFillPts.get(k)!.push(p);
    };
    addP(vKey(wall.start), lc(-dsT,          -hT));
    addP(vKey(wall.start), lc( dsB,           hT));
    addP(vKey(wall.end),   lc(wLenPx + deT,  -hT));
    addP(vKey(wall.end),   lc(wLenPx - deB,   hT));
  }

  // ---- Fill vertex gaps (T-junctions and multi-wall junctions) ----
  ctx.fillStyle = WALL_FILL;
  for (const [k, pts] of vertexFillPts) {
    if ((vtx.get(k)?.length ?? 0) < 2) continue;
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    let area2 = 0;
    for (let i = 0; i < hull.length; i++) {
      const j = (i + 1) % hull.length;
      area2 += hull[i].x * hull[j].y - hull[j].x * hull[i].y;
    }
    if (Math.abs(area2) < 2) continue; // near-zero area → L-corner, skip
    ctx.beginPath();
    ctx.moveTo(hull[0].x, hull[0].y);
    for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y);
    ctx.closePath();
    ctx.fill();
  }

  for (const wall of floor.walls) {
    const isSelected = wall.id === state.selectedWallId;
    const isHovered  = wall.id === state.hoveredWallId;
    const isDragging = wall.id === state.draggingVertexWallId;
    const openings   = [...(wallOpenings.get(wall.id) ?? [])].sort((a, b) => a.positionAlongWall - b.positionAlongWall);

    const cs = worldToCanvas(wall.start, vp);
    const ce = worldToCanvas(wall.end,   vp);
    const wallLenW  = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const wallLenPx = wallLenW * vp.scale;
    const thickPx   = wall.thickness * vp.scale;
    const halfT     = thickPx / 2;

    if (wallLenPx < 1) continue;

    const dx = ce.x - cs.x, dy = ce.y - cs.y;
    const angle = Math.atan2(dy, dx);

    // Unit direction of wall in world space (angles are preserved by scale-only viewport)
    const d1x = (wall.end.x - wall.start.x) / wallLenW;
    const d1y = (wall.end.y - wall.start.y) / wallLenW;

    // Per-face miter deltas (handles L-corners and T-junctions)
    const { top: dsTop, bot: dsBot } = miterDeltas(wall.start, d1x, d1y, halfT, wall.id, vtx, vp.scale, false);
    const { top: deTop, bot: deBot } = miterDeltas(wall.end,   d1x, d1y, halfT, wall.id, vtx, vp.scale, true);

    const xTopStart = -dsTop;
    const xBotStart =  dsBot;
    const xTopEnd   = wallLenPx + deTop;
    const xBotEnd   = wallLenPx - deBot;

    // Gap intervals in wall-local x [0, wallLenPx]
    const gaps = wallLenW > 0 ? openings.map(op => ({
      x0: Math.max(0, Math.min(wallLenPx, (op.positionAlongWall / wallLenW) * wallLenPx)),
      x1: Math.max(0, Math.min(wallLenPx, ((op.positionAlongWall + op.width) / wallLenW) * wallLenPx)),
      op,
    })) : [];

    // ---- Draw thick wall polygon with miter joints ----
    ctx.save();
    ctx.translate(cs.x, cs.y);
    ctx.rotate(angle);

    const fill = isSelected ? WALL_FILL_SEL : isHovered ? WALL_FILL_HOV : WALL_FILL;
    ctx.fillStyle = fill;

    // Build solid-segment list
    const solids: { x0top: number; x0bot: number; x1top: number; x1bot: number }[] = [];
    let prevX = 0;
    for (const g of gaps) {
      if (prevX < g.x0) {
        solids.push({
          x0top: prevX === 0 ? xTopStart : prevX,
          x0bot: prevX === 0 ? xBotStart : prevX,
          x1top: g.x0,
          x1bot: g.x0,
        });
      }
      prevX = g.x1;
    }
    if (prevX < wallLenPx) {
      solids.push({
        x0top: prevX === 0 ? xTopStart : prevX,
        x0bot: prevX === 0 ? xBotStart : prevX,
        x1top: xTopEnd,
        x1bot: xBotEnd,
      });
    }

    for (const s of solids) {
      ctx.beginPath();
      ctx.moveTo(s.x0top, -halfT);
      ctx.lineTo(s.x1top, -halfT);
      ctx.lineTo(s.x1bot,  halfT);
      ctx.lineTo(s.x0bot,  halfT);
      ctx.closePath();
      ctx.fill();
    }

    // End caps at free (non-shared) endpoints only
    const startShared = (vtx.get(vKey(wall.start)) ?? []).some(w => w.id !== wall.id);
    const endShared   = (vtx.get(vKey(wall.end))   ?? []).some(w => w.id !== wall.id);
    ctx.strokeStyle = isSelected ? '#00e5ff' : 'rgba(74,158,255,0.5)';
    ctx.lineWidth   = isSelected ? 1.5 : 0.8;
    if (!startShared) {
      ctx.beginPath(); ctx.moveTo(0, -halfT); ctx.lineTo(0, halfT); ctx.stroke();
    }
    if (!endShared) {
      ctx.beginPath(); ctx.moveTo(wallLenPx, -halfT); ctx.lineTo(wallLenPx, halfT); ctx.stroke();
    }

    // Opening symbols (in wall-local space)
    for (const g of gaps) {
      const isSel = g.op.id === state.selectedOpeningId || g.op.id === state.draggingOpeningId;
      drawOpeningInWallSpace(ctx, g.op.type, g.x0, g.x1, thickPx, isSel);
    }

    ctx.restore();

    // Both labels drawn in canvas space so text is always horizontal and
    // the two labels are always on opposite sides of the wall.
    if (isSelected || isDragging) {
      const midX = (cs.x + ce.x) / 2;
      const midY = (cs.y + ce.y) / 2;
      // Adjacency badge: above the wall midpoint in screen space
      if (!isDragging) {
        drawAdjacencyBadge(ctx, midX, midY - halfT - 14, wall.boundaryCategory);
      }
      // Dimension label: below the wall midpoint in screen space
      const lenM = (wallLenW / 1000).toFixed(2);
      drawDimLabelLocal(ctx, midX, midY + halfT + 12, `${lenM} m`);
    }

    // Endpoint drag handles
    const dotR = isSelected || isDragging ? 5 : 3.5;
    for (const [p, isFixed] of [[wall.start, wall.startFixed], [wall.end, wall.endFixed]] as [Point2D, boolean | undefined][]) {
      const cp = worldToCanvas(p, vp);
      if (isFixed) {
        ctx.fillStyle   = '#f97316';
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth   = 1.5;
        ctx.strokeRect(cp.x - 4, cp.y - 4, 8, 8);
      } else {
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = isSelected || isDragging ? ENDPOINT_SNAP : ENDPOINT_DOT;
        ctx.fill();
        if (!isSelected && !isDragging) {
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, dotR + 3, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(74,158,255,0.20)';
          ctx.lineWidth   = 1;
          ctx.stroke();
        }
      }
    }
  }
}

/** Draw opening symbol in wall-local coordinate space */
function drawOpeningInWallSpace(
  ctx: CanvasRenderingContext2D,
  type: 'window' | 'door' | 'garage_door',
  x0: number, x1: number,
  thickPx: number,
  isSelected: boolean,
): void {
  const halfT = thickPx / 2;
  ctx.save();
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  if (type === 'window') {
    const color = isSelected ? '#93c5fd' : '#60a5fa';
    ctx.strokeStyle = color;
    ctx.lineWidth   = isSelected ? 2 : 1.5;
    // End caps
    ctx.beginPath(); ctx.moveTo(x0, -halfT); ctx.lineTo(x0, halfT); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, -halfT); ctx.lineTo(x1, halfT); ctx.stroke();
    // Two glazing lines
    const off = halfT * 0.38;
    ctx.strokeStyle = isSelected ? 'rgba(147,197,253,0.9)' : 'rgba(96,165,250,0.8)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x0, -off); ctx.lineTo(x1, -off); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0,  off); ctx.lineTo(x1,  off); ctx.stroke();

  } else if (type === 'door') {
    const color = isSelected ? '#86efac' : '#4ade80';
    ctx.fillStyle   = isSelected ? 'rgba(134,239,172,0.25)' : 'rgba(74,222,128,0.15)';
    ctx.strokeStyle = color;
    ctx.lineWidth   = isSelected ? 2 : 1.5;
    ctx.fillRect(x0, -halfT, x1 - x0, thickPx);
    ctx.strokeRect(x0, -halfT, x1 - x0, thickPx);
    // Centre divider
    const mx = (x0 + x1) / 2;
    ctx.strokeStyle = isSelected ? 'rgba(134,239,172,0.5)' : 'rgba(74,222,128,0.4)';
    ctx.lineWidth   = 0.8;
    ctx.beginPath(); ctx.moveTo(mx, -halfT); ctx.lineTo(mx, halfT); ctx.stroke();

  } else { // garage_door
    const color      = isSelected ? '#fdba74' : '#f97316';
    const panelCount = Math.max(2, Math.round((x1 - x0) / 18));
    ctx.fillStyle   = isSelected ? 'rgba(253,186,116,0.18)' : 'rgba(249,115,22,0.10)';
    ctx.strokeStyle = color;
    ctx.lineWidth   = isSelected ? 2 : 1.5;
    ctx.fillRect(x0, -halfT, x1 - x0, thickPx);
    ctx.strokeRect(x0, -halfT, x1 - x0, thickPx);
    ctx.lineWidth = 0.7;
    for (let i = 1; i < panelCount; i++) {
      const px = x0 + (x1 - x0) * (i / panelCount);
      ctx.beginPath(); ctx.moveTo(px, -halfT); ctx.lineTo(px, halfT); ctx.stroke();
    }
  }

  ctx.restore();
}

function drawAdjacencyBadge(ctx: CanvasRenderingContext2D, x: number, y: number, cat: import('../model/types.js').BoundaryCategory): void {
  const label = getBoundaryCategoryShort(cat);
  const color = getBoundaryCategoryColor(cat);
  ctx.save();
  ctx.font         = 'bold 9px "Inter", system-ui';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(label).width + 8;
  ctx.fillStyle   = 'rgb(15,17,23)';
  ctx.fillRect(x - w / 2, y - 7, w, 14);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.2;
  ctx.strokeRect(x - w / 2, y - 7, w, 14);
  ctx.fillStyle   = color;
  ctx.fillText(label, x, y);
  ctx.restore();
}

// ---- Dim labels in wall-local space ----

function drawDimLabelLocal(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.save();
  ctx.font          = '10px "Courier New", monospace';
  ctx.textAlign     = 'center';
  ctx.textBaseline  = 'middle';
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle   = 'rgb(15,17,23)';
  ctx.fillRect(x - w / 2, y - 8, w, 16);
  ctx.strokeStyle = DIM_LINE;
  ctx.lineWidth   = 0.5;
  ctx.strokeRect(x - w / 2, y - 8, w, 16);
  ctx.fillStyle   = DIM_TEXT;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawDimLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.save();
  ctx.font          = '10px "Courier New", monospace';
  ctx.textAlign     = 'center';
  ctx.textBaseline  = 'middle';
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle   = 'rgba(15,17,23,0.85)';
  ctx.fillRect(x - w / 2, y - 8, w, 16);
  ctx.strokeStyle = DIM_LINE;
  ctx.lineWidth   = 0.5;
  ctx.strokeRect(x - w / 2, y - 8, w, 16);
  ctx.fillStyle   = DIM_TEXT;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ---- Preview wall ----

function drawPreview(ctx: CanvasRenderingContext2D, vp: Viewport, state: RenderState): void {
  if (state.tool !== 'wall') return;
  const cursor = state.previewEnd;
  if (!cursor) return;

  const cp   = worldToCanvas(cursor, vp);
  const size = 12;

  // Crosshair
  ctx.save();
  ctx.strokeStyle = CURSOR_CROSS;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(cp.x - size, cp.y); ctx.lineTo(cp.x + size, cp.y);
  ctx.moveTo(cp.x, cp.y - size); ctx.lineTo(cp.x, cp.y + size);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  if (!state.drawStart) return;
  const sp = worldToCanvas(state.drawStart, vp);

  // Ghost wall thickness
  ctx.save();
  ctx.strokeStyle = PREVIEW_GHOST;
  ctx.lineWidth   = 30 * vp.scale;
  ctx.lineCap     = 'butt';
  ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(cp.x, cp.y); ctx.stroke();
  // Main dashed preview line
  ctx.strokeStyle = PREVIEW_LINE;
  ctx.lineWidth   = 2;
  ctx.setLineDash([10, 5]);
  ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(cp.x, cp.y); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = DRAW_START_DOT;
  ctx.beginPath(); ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = ENDPOINT_SNAP;
  ctx.lineWidth   = 1.5;
  ctx.beginPath(); ctx.arc(cp.x, cp.y, 9, 0, Math.PI * 2); ctx.stroke();

  const lenMm = Math.hypot(cursor.x - state.drawStart.x, cursor.y - state.drawStart.y);
  const mid   = { x: (sp.x + cp.x) / 2, y: (sp.y + cp.y) / 2 };
  drawDimLabel(ctx, mid.x, mid.y - 14, `${(lenMm / 1000).toFixed(2)} m`);
  ctx.restore();
}

// ---- Cursor crosshair for opening tools ----

function drawCursorCross(ctx: CanvasRenderingContext2D, vp: Viewport, state: RenderState): void {
  if (state.tool === 'select' || state.tool === 'wall') return;
  const cursor = state.previewEnd;
  if (!cursor) return;
  const cp   = worldToCanvas(cursor, vp);
  const size = 14;
  ctx.save();
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(cp.x - size, cp.y); ctx.lineTo(cp.x + size, cp.y);
  ctx.moveTo(cp.x, cp.y - size); ctx.lineTo(cp.x, cp.y + size);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
  ctx.strokeStyle = '#fb923c'; ctx.stroke();
  ctx.restore();
}

// ---- Room labels ----

function drawRoomLabels(ctx: CanvasRenderingContext2D, floor: Floor, vp: Viewport, state: RenderState): void {
  for (const room of floor.rooms) {
    const pts = getRoomPoly(room, floor);
    if (!pts || pts.length < 3) continue;
    const centroid   = polygonCentroid(pts);
    const cp         = worldToCanvas(centroid, vp);
    const isSelected = room.id === state.selectedRoomId;

    const rr = state.heizlastResult?.rooms.find(r => r.roomId === room.id);

    type LabelLine = { text: string; font: string; color: string };
    const lines: LabelLine[] = [];

    lines.push({
      text:  room.label,
      font:  `${isSelected ? 'bold ' : ''}12px "Inter", system-ui, sans-serif`,
      color: isSelected ? ROOM_LABEL_SEL : ROOM_LABEL,
    });
    lines.push({
      text:  `${room.designTemperature} °C`,
      font:  '9px "Courier New", monospace',
      color: 'rgba(148,163,184,0.7)',
    });
    if (rr) {
      lines.push({
        text:  `${Math.round(rr.result.totalLoss)} W`,
        font:  '10px "Courier New", monospace',
        color: HEAT_VALUE,
      });
    }
    if (room.area && vp.scale > 0.04) {
      lines.push({
        text:  `${room.area.toFixed(1)} m²`,
        font:  '9px system-ui',
        color: 'rgba(148,163,184,0.6)',
      });
    }

    const LH = 11;
    const totalH = (lines.length - 1) * LH;
    const yStart = cp.y - totalH / 2;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < lines.length; i++) {
      ctx.font      = lines[i].font;
      ctx.fillStyle = lines[i].color;
      ctx.fillText(lines[i].text, cp.x, yStart + i * LH);
    }
  }
}
