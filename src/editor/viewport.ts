import type { Point2D } from '../model/types.js';

export interface Viewport {
  offsetX: number; // canvas px
  offsetY: number; // canvas px
  scale: number;   // px per mm
}

export function createViewport(): Viewport {
  return { offsetX: 0, offsetY: 0, scale: 0.1 }; // default 1px = 10mm
}

export function worldToCanvas(world: Point2D, vp: Viewport): Point2D {
  return {
    x: world.x * vp.scale + vp.offsetX,
    y: world.y * vp.scale + vp.offsetY,
  };
}

export function canvasToWorld(canvas: Point2D, vp: Viewport): Point2D {
  return {
    x: (canvas.x - vp.offsetX) / vp.scale,
    y: (canvas.y - vp.offsetY) / vp.scale,
  };
}

export function applyZoom(vp: Viewport, delta: number, pivot: Point2D): Viewport {
  const factor = delta < 0 ? 1.1 : 0.9;
  const newScale = Math.max(0.01, Math.min(2.0, vp.scale * factor));
  const scaleRatio = newScale / vp.scale;
  return {
    scale: newScale,
    offsetX: pivot.x - (pivot.x - vp.offsetX) * scaleRatio,
    offsetY: pivot.y - (pivot.y - vp.offsetY) * scaleRatio,
  };
}

export function panViewport(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, offsetX: vp.offsetX + dx, offsetY: vp.offsetY + dy };
}
