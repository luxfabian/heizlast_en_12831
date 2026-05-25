import type { Project, Floor, WallSegment, Room, Opening, Point2D } from '../model/types.js';
import { createDefaultProject } from '../model/defaults.js';
import type { Viewport } from './viewport.js';
import type { HeizlastResult } from '../model/types.js';
import { createViewport, applyZoom } from './viewport.js';
import { canvasToWorld } from './viewport.js';
import { snapPoint, distPointToSegment, openingEndpoints, dist } from './geometry.js';
import { detectRooms, mergeDetectedRooms, snapToExistingEndpoint } from './roomDetection.js';
import { updateAdjacency } from './adjacency.js';
import { v4 as uuidv4 } from '../utils/uuid.js';
import {
  DEFAULT_WALL_PRESET_ID, DEFAULT_WINDOW_PRESET_ID, DEFAULT_DOOR_PRESET_ID, DEFAULT_GARAGE_PRESET_ID,
  getWallPreset, getOpeningPreset,
} from '../library/presets.js';

export type ToolMode = 'select' | 'wall' | 'window' | 'door' | 'garage_door';

export interface EditorState {
  viewport: Viewport;
  tool: ToolMode;
  gridEnabled: boolean;
  gridSize: number;        // mm
  snapThreshold: number;   // mm

  // Active library presets
  activeWallPresetId: string;
  activeWindowPresetId: string;
  activeDoorPresetId: string;
  activeGaragePresetId: string;

  drawStart?: Point2D;

  // Selection
  hoveredWallId?: string;
  selectedRoomId?: string;
  selectedWallId?: string;
  selectedOpeningId?: string;

  showHeatMap: boolean;
  heizlastResult?: HeizlastResult;
  activeToolCursor?: Point2D;

  // Pan
  isPanning: boolean;
  panStart?: { canvasX: number; canvasY: number; vpOffset: { x: number; y: number } };
  leftDown?: { canvasX: number; canvasY: number };
  spaceDown: boolean;

  // Vertex / opening drag
  draggingVertex?: { wallId: string; end: 'start' | 'end' };
  draggingOpening?: { openingId: string; wallId: string };

  // Pending drag candidates — deferred until mouse moves past threshold
  pendingVertexDrag?: { wallId: string; end: 'start' | 'end'; canvasX: number; canvasY: number };
  pendingOpeningDrag?: { openingId: string; wallId: string; canvasX: number; canvasY: number };
}

export function createEditorState(): EditorState {
  return {
    viewport: createViewport(),
    tool: 'select',
    gridEnabled: true,
    gridSize: 50,
    snapThreshold: 200,
    activeWallPresetId:   DEFAULT_WALL_PRESET_ID,
    activeWindowPresetId: DEFAULT_WINDOW_PRESET_ID,
    activeDoorPresetId:   DEFAULT_DOOR_PRESET_ID,
    activeGaragePresetId: DEFAULT_GARAGE_PRESET_ID,
    showHeatMap: false,
    isPanning: false,
    spaceDown: false,
  };
}

const PAN_DRAG_THRESHOLD_PX = 4;

export class Editor {
  private state: EditorState;
  private project: Project;
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private readonly MAX_UNDO = 50;
  private onChangeCallbacks: Array<() => void> = [];
  private onRenderCallbacks: Array<() => void> = [];

  constructor(project: Project) {
    this.project = project;
    this.state = createEditorState();
    this.state.viewport = { ...this.state.viewport, offsetX: 400, offsetY: 300 };
  }

  onChange(cb: () => void): void { this.onChangeCallbacks.push(cb); }
  onRenderUpdate(cb: () => void): void { this.onRenderCallbacks.push(cb); }
  private notify(): void { for (const cb of this.onChangeCallbacks) cb(); }
  private notifyRender(): void { for (const cb of this.onRenderCallbacks) cb(); }

  getState(): Readonly<EditorState> { return this.state; }
  getProject(): Readonly<Project>   { return this.project; }

  private get floor(): Floor { return this.project.floors[0]; }

  // ---- Snap ----

  /**
   * Auto-ortho: snap to H or V axis when within ~22° of that axis from drawStart.
   * Applied on the raw world point before grid snapping so the grid aligns to the axis.
   */
  private autoOrthoSnap(pt: Point2D, start: Point2D): Point2D {
    const dx = pt.x - start.x, dy = pt.y - start.y;
    if (Math.abs(dx) < this.state.gridSize && Math.abs(dy) < this.state.gridSize) return pt;
    const TAN22 = 0.4142; // tan(22.5°)
    if (Math.abs(dy) < Math.abs(dx) * TAN22) return { x: pt.x, y: start.y }; // snap H
    if (Math.abs(dx) < Math.abs(dy) * TAN22) return { x: start.x, y: pt.y }; // snap V
    return pt;
  }

  private snap(worldPt: Point2D, drawStart?: Point2D): Point2D {
    // Auto-ortho first (raw coords), then grid, then endpoint
    const ortho = drawStart ? this.autoOrthoSnap(worldPt, drawStart) : worldPt;
    const gridPt = this.state.gridEnabled ? snapPoint(ortho, this.state.gridSize) : ortho;
    return snapToExistingEndpoint(gridPt, this.floor.walls, this.state.snapThreshold);
  }

  // ---- Undo/Redo ----

  private pushUndo(): void {
    this.undoStack.push(JSON.parse(JSON.stringify(this.project)));
    if (this.undoStack.length > this.MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.parse(JSON.stringify(this.project)));
    this.project = prev;
    this.notify();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.parse(JSON.stringify(this.project)));
    this.project = next;
    this.notify();
  }

  private rebuildRooms(): void {
    const detected = detectRooms(this.floor.walls);
    const rooms = mergeDetectedRooms(detected, this.floor.rooms, this.floor.defaultCeilingHeight);
    this.project = { ...this.project, floors: [updateAdjacency({ ...this.floor, rooms })] };
  }

  // ---- Pan ----

  private startPan(canvasX: number, canvasY: number): void {
    this.state.isPanning = true;
    this.state.panStart = { canvasX, canvasY, vpOffset: { x: this.state.viewport.offsetX, y: this.state.viewport.offsetY } };
  }

  private doPan(canvasX: number, canvasY: number): void {
    if (!this.state.panStart) return;
    const dx = canvasX - this.state.panStart.canvasX;
    const dy = canvasY - this.state.panStart.canvasY;
    this.state.viewport = { ...this.state.viewport, offsetX: this.state.panStart.vpOffset.x + dx, offsetY: this.state.panStart.vpOffset.y + dy };
  }

  private stopPan(): void { this.state.isPanning = false; this.state.panStart = undefined; }

  // ---- Mouse events ----

  handleMouseDown(canvasX: number, canvasY: number, button: number): void {
    if (button === 1 || button === 2) { this.startPan(canvasX, canvasY); this.notify(); return; }
    if (button !== 0) return;
    if (this.state.spaceDown) { this.startPan(canvasX, canvasY); this.notify(); return; }

    const worldPt = canvasToWorld({ x: canvasX, y: canvasY }, this.state.viewport);

    if (this.state.tool === 'select') {
      // Vertex drag check — deferred: only start drag when mouse actually moves
      for (const wall of this.floor.walls) {
        if (!wall.startFixed && dist(worldPt, wall.start) <= this.state.snapThreshold) {
          this.state.pendingVertexDrag = { wallId: wall.id, end: 'start', canvasX, canvasY };
          this.state.leftDown = { canvasX, canvasY };
          this.notify(); return;
        }
        if (!wall.endFixed && dist(worldPt, wall.end) <= this.state.snapThreshold) {
          this.state.pendingVertexDrag = { wallId: wall.id, end: 'end', canvasX, canvasY };
          this.state.leftDown = { canvasX, canvasY };
          this.notify(); return;
        }
      }
      // Opening drag check — deferred
      for (const op of this.floor.openings) {
        const wall = this.floor.walls.find(w => w.id === op.wallId);
        if (!wall) continue;
        const { opStart, opEnd } = openingEndpoints(op.positionAlongWall, op.width, wall.start, wall.end);
        const mid: Point2D = { x: (opStart.x + opEnd.x) / 2, y: (opStart.y + opEnd.y) / 2 };
        if (dist(worldPt, mid) <= this.state.snapThreshold) {
          this.state.pendingOpeningDrag = { openingId: op.id, wallId: op.wallId, canvasX, canvasY };
          this.state.leftDown = { canvasX, canvasY };
          this.notify(); return;
        }
      }
      this.state.leftDown = { canvasX, canvasY };
      return;
    }

    this.state.leftDown = { canvasX, canvasY };
    this.handleToolDown(worldPt);
  }

  private handleToolDown(worldPt: Point2D): void {
    switch (this.state.tool) {
      case 'wall': this.handleWallClick(worldPt); break;
      case 'window':
      case 'door':
      case 'garage_door': this.handleOpeningClick(worldPt, this.state.tool as 'window' | 'door' | 'garage_door'); break;
    }
  }

  private static readonly DRAG_START_PX = 5;

  handleMouseMove(canvasX: number, canvasY: number): void {
    if (this.state.isPanning) { this.doPan(canvasX, canvasY); this.notifyRender(); return; }

    // Promote pending vertex drag once mouse moves far enough
    if (this.state.pendingVertexDrag) {
      const { canvasX: ox, canvasY: oy } = this.state.pendingVertexDrag;
      if (Math.hypot(canvasX - ox, canvasY - oy) > Editor.DRAG_START_PX) {
        const { wallId, end } = this.state.pendingVertexDrag;
        this.pushUndo();
        this.state.draggingVertex = { wallId, end };
        this.state.pendingVertexDrag = undefined;
        this.state.leftDown = undefined;
      } else {
        this.notifyRender(); return;
      }
    }

    // Promote pending opening drag once mouse moves far enough
    if (this.state.pendingOpeningDrag) {
      const { canvasX: ox, canvasY: oy } = this.state.pendingOpeningDrag;
      if (Math.hypot(canvasX - ox, canvasY - oy) > Editor.DRAG_START_PX) {
        const { openingId, wallId } = this.state.pendingOpeningDrag;
        this.pushUndo();
        this.state.draggingOpening = { openingId, wallId };
        this.state.pendingOpeningDrag = undefined;
        this.state.leftDown = undefined;
      } else {
        this.notifyRender(); return;
      }
    }

    // Vertex drag
    if (this.state.draggingVertex) {
      const worldPt = canvasToWorld({ x: canvasX, y: canvasY }, this.state.viewport);
      const rawSnapped = this.snap(worldPt);
      const { wallId, end } = this.state.draggingVertex;
      const wall = this.floor.walls.find(w => w.id === wallId)!;

      // Also snap co-located vertices from other walls (shared endpoints)
      const movingPt = end === 'start' ? wall.start : wall.end;
      const updatedWalls = this.floor.walls.map(w => {
        const patchStart = pointsEqual(w.start, movingPt) ? rawSnapped : undefined;
        const patchEnd   = pointsEqual(w.end,   movingPt) ? rawSnapped : undefined;
        if (!patchStart && !patchEnd) return w;
        return { ...w, ...(patchStart ? { start: patchStart } : {}), ...(patchEnd ? { end: patchEnd } : {}) };
      });
      this.project = { ...this.project, floors: [{ ...this.floor, walls: updatedWalls }] };
      this.rebuildRooms();
      this.notify(); return;
    }

    // Opening drag
    if (this.state.draggingOpening) {
      const worldPt = canvasToWorld({ x: canvasX, y: canvasY }, this.state.viewport);
      const { openingId, wallId } = this.state.draggingOpening;
      const wall = this.floor.walls.find(w => w.id === wallId);
      const op   = this.floor.openings.find(o => o.id === openingId);
      if (wall && op) {
        const wallLen = dist(wall.start, wall.end);
        const { t } = distPointToSegment(worldPt, wall.start, wall.end);
        const newPos = Math.max(0, Math.min(wallLen - op.width, t * wallLen - op.width / 2));
        this.project = { ...this.project, floors: [{ ...this.floor, openings: this.floor.openings.map(o => o.id === openingId ? { ...o, positionAlongWall: newPos } : o) }] };
        this.notify();
      }
      return;
    }

    // Pan from left-drag
    if (this.state.leftDown && this.state.tool === 'select') {
      const dx = canvasX - this.state.leftDown.canvasX;
      const dy = canvasY - this.state.leftDown.canvasY;
      if (Math.sqrt(dx * dx + dy * dy) > PAN_DRAG_THRESHOLD_PX) {
        this.startPan(this.state.leftDown.canvasX, this.state.leftDown.canvasY);
        this.state.leftDown = undefined;
        this.doPan(canvasX, canvasY);
        this.notifyRender(); return;
      }
    }

    const worldPt = canvasToWorld({ x: canvasX, y: canvasY }, this.state.viewport);
    const snapped = this.snap(worldPt,
      this.state.tool === 'wall' ? (this.state.drawStart ?? undefined) : undefined);

    this.state.activeToolCursor = snapped;

    // Hover detection
    let hovered: string | undefined;
    for (const wall of this.floor.walls) {
      const { dist: d } = distPointToSegment(worldPt, wall.start, wall.end);
      if (d < 300) { hovered = wall.id; break; }
    }
    this.state.hoveredWallId = hovered;
    this.notifyRender();
  }

  handleMouseUp(canvasX: number, canvasY: number, button: number): void {
    if (this.state.isPanning) { this.stopPan(); this.notify(); return; }
    if (this.state.draggingVertex) { this.state.draggingVertex = undefined; this.notify(); return; }
    if (this.state.draggingOpening) { this.state.draggingOpening = undefined; this.notify(); return; }

    // Pending drags that never moved — treat as plain clicks
    if (this.state.pendingVertexDrag || this.state.pendingOpeningDrag) {
      this.state.pendingVertexDrag  = undefined;
      this.state.pendingOpeningDrag = undefined;
      this.state.leftDown = undefined;
      if (button === 0) {
        const worldPt = canvasToWorld({ x: canvasX, y: canvasY }, this.state.viewport);
        this.handleSelectClick(worldPt);
      }
      this.notify(); return;
    }

    if (button === 0 && this.state.leftDown && this.state.tool === 'select') {
      const worldPt = canvasToWorld({ x: canvasX, y: canvasY }, this.state.viewport);
      this.handleSelectClick(worldPt);
    }
    this.state.leftDown = undefined;
    this.notify();
  }

  handleWheel(canvasX: number, canvasY: number, delta: number): void {
    this.state.viewport = applyZoom(this.state.viewport, delta, { x: canvasX, y: canvasY });
    this.notify();
  }

  handleKeyDown(key: string, ctrl: boolean): void {
    if (ctrl && key.toLowerCase() === 'z') { this.undo(); return; }
    if (ctrl && key.toLowerCase() === 'y') { this.redo(); return; }
    if (key === 'Escape') {
      this.state.drawStart = undefined;
      this.notify(); return;
    }
    if (key === ' ') this.state.spaceDown = true;
  }

  handleKeyUp(key: string): void {
    if (key === ' ') {
      this.state.spaceDown = false;
      if (this.state.isPanning) this.stopPan();
      this.notify();
    }
  }

  // ---- Click handlers ----

  private handleSelectClick(worldPt: Point2D): void {
    const wallMap = new Map(this.floor.walls.map(w => [w.id, w]));

    // Openings: check first (highest priority)
    for (const op of this.floor.openings) {
      const wall = wallMap.get(op.wallId);
      if (!wall) continue;
      const { opStart, opEnd } = openingEndpoints(op.positionAlongWall, op.width, wall.start, wall.end);
      const { dist: d } = distPointToSegment(worldPt, opStart, opEnd);
      if (d < 300) {
        this.state.selectedOpeningId = op.id;
        this.state.selectedWallId    = undefined;
        this.state.selectedRoomId    = undefined;
        this.notify(); return;
      }
    }

    // Walls: check before rooms so clicking a boundary wall selects the wall
    for (const wall of this.floor.walls) {
      const { dist: d } = distPointToSegment(worldPt, wall.start, wall.end);
      if (d < Math.max(wall.thickness / 2 + 80, 200)) {
        this.state.selectedWallId    = wall.id;
        this.state.selectedRoomId    = undefined;
        this.state.selectedOpeningId = undefined;
        this.notify(); return;
      }
    }

    // Rooms: reconstruct polygon via shared endpoints so the polygon is correct
    for (const room of this.floor.rooms) {
      const pts = roomPolyFromWalls(room.wallIds, wallMap);
      if (pts && pointInPolygon(worldPt, pts)) {
        this.state.selectedRoomId    = room.id;
        this.state.selectedWallId    = undefined;
        this.state.selectedOpeningId = undefined;
        this.notify(); return;
      }
    }

    this.state.selectedRoomId = undefined;
    this.state.selectedWallId = undefined;
    this.state.selectedOpeningId = undefined;
    this.notify();
  }

  private handleWallClick(worldPt: Point2D): void {
    const point = this.snap(worldPt, this.state.drawStart ?? undefined);
    if (!this.state.drawStart) {
      this.state.drawStart = point;
      this.notify(); return;
    }

    const start = this.state.drawStart;
    const end   = point;
    const dx = end.x - start.x, dy = end.y - start.y;
    if (Math.sqrt(dx * dx + dy * dy) < 10) { this.state.drawStart = undefined; this.notify(); return; }

    const preset  = getWallPreset(this.state.activeWallPresetId);

    this.pushUndo();
    const newWall: WallSegment = {
      id: uuidv4(),
      start,
      end,
      thickness: preset?.thickness ?? 300,
      uValue:    preset?.uValue    ?? 0.20,
      typePresetId: this.state.activeWallPresetId,
      boundaryCategory: preset?.defaultCategory ?? 'exterior',
    };
    this.project = { ...this.project, floors: [{ ...this.floor, walls: [...this.floor.walls, newWall] }] };
    this.rebuildRooms();
    this.state.drawStart = end; // chain-draw
    this.notify();
  }

  private handleOpeningClick(worldPt: Point2D, type: 'window' | 'door' | 'garage_door'): void {
    let bestWall: WallSegment | null = null;
    let bestDist = Infinity;
    let bestT = 0;

    for (const wall of this.floor.walls) {
      const { dist: d, t } = distPointToSegment(worldPt, wall.start, wall.end);
      if (d < bestDist && d < 800) { bestDist = d; bestWall = wall; bestT = t; }
    }
    if (!bestWall) return;

    const presetId = type === 'window' ? this.state.activeWindowPresetId
      : type === 'door' ? this.state.activeDoorPresetId
      : this.state.activeGaragePresetId;
    const preset = getOpeningPreset(presetId);
    const defaultWidth  = preset?.width  ?? (type === 'window' ? 1200 : type === 'door' ? 900 : 2400);
    const defaultHeight = preset?.height ?? (type === 'window' ? 1200 : type === 'door' ? 2100 : 2200);
    const defaultU      = preset?.uValue ?? (type === 'window' ? 1.1  : type === 'door' ? 1.8  : 2.5);

    this.pushUndo();
    const wallLen = dist(bestWall.start, bestWall.end);
    const pos = Math.max(0, Math.min(wallLen - defaultWidth, bestT * wallLen - defaultWidth / 2));
    const opening: Opening = {
      id: uuidv4(), type,
      wallId: bestWall.id,
      positionAlongWall: pos,
      width:   defaultWidth,
      height:  defaultHeight,
      uValue:  defaultU,
      typePresetId: presetId,
    };
    this.project = { ...this.project, floors: [{ ...this.floor, openings: [...this.floor.openings, opening] }] };
    this.state.tool = 'select';
    this.notify();
  }

  // ---- Mutations ----

  resetProject(): void {
    this.project  = createDefaultProject();
    this.undoStack = [];
    this.redoStack = [];
    this.state = createEditorState();
    this.notify();
  }

  invalidate(): void { this.notify(); }

  setTool(tool: ToolMode): void { this.state.tool = tool; this.state.drawStart = undefined; this.notify(); }
  setGridEnabled(enabled: boolean): void { this.state.gridEnabled = enabled; this.notify(); }
  setHeizlastResult(result: HeizlastResult | undefined): void { this.state.heizlastResult = result; this.notify(); }
  setShowHeatMap(show: boolean): void { this.state.showHeatMap = show; this.notify(); }

  setActiveWallPreset(id: string): void { this.state.activeWallPresetId = id; this.notify(); }
  setActiveOpeningPreset(type: 'window' | 'door' | 'garage_door', id: string): void {
    if (type === 'window') this.state.activeWindowPresetId = id;
    else if (type === 'door') this.state.activeDoorPresetId = id;
    else this.state.activeGaragePresetId = id;
    this.notify();
  }

  deleteSelectedWall(): void {
    if (!this.state.selectedWallId) return;
    this.pushUndo();
    const wallId = this.state.selectedWallId;
    this.project = { ...this.project, floors: [{ ...this.floor, walls: this.floor.walls.filter(w => w.id !== wallId), openings: this.floor.openings.filter(o => o.wallId !== wallId) }] };
    this.rebuildRooms();
    this.state.selectedWallId = undefined;
    this.notify();
  }

  deleteSelectedOpening(): void {
    if (!this.state.selectedOpeningId) return;
    this.pushUndo();
    const id = this.state.selectedOpeningId;
    this.project = { ...this.project, floors: [{ ...this.floor, openings: this.floor.openings.filter(o => o.id !== id) }] };
    this.state.selectedOpeningId = undefined;
    this.notify();
  }

  updateWall(wallId: string, patch: Partial<WallSegment>): void {
    this.pushUndo();
    this.project = { ...this.project, floors: [{ ...this.floor, walls: this.floor.walls.map(w => w.id === wallId ? { ...w, ...patch } : w) }] };
    this.rebuildRooms();
    this.notify();
  }

  updateOpening(openingId: string, patch: Partial<Opening>): void {
    this.pushUndo();
    this.project = { ...this.project, floors: [{ ...this.floor, openings: this.floor.openings.map(o => o.id === openingId ? { ...o, ...patch } : o) }] };
    this.notify();
  }

  updateRoom(roomId: string, patch: Partial<Room>): void {
    this.pushUndo();
    const updatedFloor = { ...this.floor, rooms: this.floor.rooms.map(r => r.id === roomId ? { ...r, ...patch } : r) };
    this.project = { ...this.project, floors: [updateAdjacency(updatedFloor)] };
    this.notify();
  }

  updateProject(patch: Partial<Project>): void { this.project = { ...this.project, ...patch }; this.notify(); }

  resetViewport(canvasW: number, canvasH: number): void {
    this.state.viewport = { offsetX: canvasW / 2, offsetY: canvasH / 2, scale: 0.1 };
    this.notify();
  }

  getCursor(): string {
    if (this.state.isPanning || this.state.spaceDown || this.state.draggingVertex || this.state.draggingOpening) return 'grabbing';
    switch (this.state.tool) {
      case 'select': return 'default';
      case 'wall':   return 'crosshair';
      default:       return 'cell';
    }
  }

  getRenderState(): import('./canvasRenderer.js').RenderState {
    return {
      hoveredWallId:       this.state.hoveredWallId,
      selectedRoomId:      this.state.selectedRoomId,
      selectedWallId:      this.state.selectedWallId,
      selectedOpeningId:   this.state.selectedOpeningId,
      draggingVertexWallId: this.state.draggingVertex?.wallId,
      draggingOpeningId:   this.state.draggingOpening?.openingId,
      drawStart:           this.state.drawStart,
      previewEnd:          this.state.activeToolCursor,
      showHeatMap:         this.state.showHeatMap,
      gridEnabled:         this.state.gridEnabled,
      heizlastResult:      this.state.heizlastResult,
      tool:                this.state.tool,
    };
  }
}

// ---- Local helpers ----

function pointsEqual(a: Point2D, b: Point2D): boolean {
  return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
}

/** Reconstruct room polygon using shared-endpoint detection between consecutive walls. */
function roomPolyFromWalls(
  wallIds: string[],
  wallMap: Map<string, WallSegment>,
): Point2D[] | null {
  const walls = wallIds.map(id => wallMap.get(id)).filter(Boolean) as WallSegment[];
  if (walls.length < 3) return null;
  const n = walls.length;
  const pts: Point2D[] = [];
  const EPS = 2;
  for (let i = 0; i < n; i++) {
    const prev = walls[(i - 1 + n) % n];
    const curr = walls[i];
    let shared: Point2D | null = null;
    outer: for (const p1 of [prev.start, prev.end]) {
      for (const p2 of [curr.start, curr.end]) {
        if (Math.abs(p1.x - p2.x) < EPS && Math.abs(p1.y - p2.y) < EPS) { shared = p1; break outer; }
      }
    }
    if (!shared) return null;
    pts.push(shared);
  }
  return pts;
}

function pointInPolygon(pt: Point2D, poly: Point2D[]): boolean {
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
