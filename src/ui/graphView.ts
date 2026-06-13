import type { HeizlastResult, Project } from '../model/types.js';

// ── Internal types ────────────────────────────────────────────────────────────

interface GNode {
  id: string;
  label: string;
  heatLoad: number;
  x: number; y: number;
  r: number;
  fixed: boolean;
  kind: 'room' | 'env';
}

interface GEdge {
  fromId: string;
  toId: string;
  flow: number;
  color: string;
}

interface NodeElems {
  mainShape: SVGElement;
  nameText: SVGTextElement;
  fullLabel: string;
  shortLabel: string;
}

const C_NEIGHBOR    = '#7c3aed';
const C_ADJ_HEATED  = '#ea580c';
const C_ADJ_REDUCED = '#dc2626';

let _prevCleanup: (() => void) | null = null;

// ── Public entry point ────────────────────────────────────────────────────────

export function renderGraph(
  container: HTMLElement,
  result: HeizlastResult,
  project: Project,
): void {
  _prevCleanup?.();
  _prevCleanup = null;
  container.innerHTML = '';
  if (result.rooms.length === 0) return;

  const W = 920, H = 580, MARGIN = 75;
  const cx = W / 2, cy = H / 2;

  const allRooms = project.floors.flatMap(f => f.rooms);
  const roomById = new Map(allRooms.map(r => [r.id, r]));
  const { adjNeighbor } = result.lossByCategory;

  // ── Nodes ─────────────────────────────────────────────────────────────────

  const nodes: GNode[] = [];
  const nodeIdx = new Map<string, number>();

  if (adjNeighbor > 0) {
    nodeIdx.set('env:neighbor', nodes.length);
    nodes.push({
      id: 'env:neighbor', label: 'Nachbargeb.', heatLoad: adjNeighbor,
      x: W - 72, y: cy, r: 20, fixed: true, kind: 'env',
    });
  }

  const roomNodes = result.rooms;
  const maxHL = Math.max(...roomNodes.map(rr => Math.abs(rr.result.totalLoss)), 1);
  const MIN_R = 13, MAX_R = 28;

  roomNodes.forEach((rr, i) => {
    const frac  = Math.abs(rr.result.totalLoss) / maxHL;
    const r     = MIN_R + (MAX_R - MIN_R) * Math.sqrt(frac);
    const angle = (2 * Math.PI * i / Math.max(roomNodes.length, 1)) - Math.PI / 2;
    nodeIdx.set(rr.roomId, nodes.length);
    nodes.push({
      id: rr.roomId,
      label: roomById.get(rr.roomId)?.label ?? rr.roomId,
      heatLoad: rr.result.totalLoss,
      x: cx + Math.cos(angle) * 150,
      y: cy + Math.sin(angle) * 130,
      r, fixed: false, kind: 'room',
    });
  });

  // ── Edges ─────────────────────────────────────────────────────────────────

  const edges: GEdge[] = [];

  for (const rr of result.rooms) {
    if (!nodeIdx.has('env:neighbor')) break;
    const nbr = rr.result.elementBreakdown
      .filter(e => e.boundaryCategory === 'adj_neighbor')
      .reduce((s, e) => s + e.heatLoss, 0);
    if (nbr > 1) edges.push({ fromId: rr.roomId, toId: 'env:neighbor', flow: nbr, color: C_NEIGHBOR });
  }

  const adjMap = new Map<string, GEdge>();

  for (const rr of result.rooms) {
    for (const el of rr.result.elementBreakdown) {
      if (el.heatLoss <= 0.5 || !el.adjacentRoomId) continue;
      if (el.boundaryCategory !== 'adj_heated' && el.boundaryCategory !== 'adj_reduced') continue;
      const key = `${rr.roomId}→${el.adjacentRoomId}`;
      const ex  = adjMap.get(key);
      if (ex) { ex.flow += el.heatLoss; }
      else {
        adjMap.set(key, {
          fromId: rr.roomId, toId: el.adjacentRoomId, flow: el.heatLoss,
          color: el.boundaryCategory === 'adj_reduced' ? C_ADJ_REDUCED : C_ADJ_HEATED,
        });
      }
    }
  }


  for (const e of adjMap.values()) {
    if (nodeIdx.has(e.fromId) && nodeIdx.has(e.toId)) edges.push(e);
  }

  // ── Physics ───────────────────────────────────────────────────────────────

  const REPULSION      = 32000;
  const SPRING_K       = 0.05;
  const GRAVITY        = 0.04;
  const DAMPING_SETTLE = 0.78;
  const maxFlow = Math.max(...edges.map(e => e.flow), 1);
  const vx = nodes.map(() => 0);
  const vy = nodes.map(() => 0);

  function forceStep(n: number, damping: number): void {
    for (let it = 0; it < n; it++) {
      const fx = nodes.map(() => 0);
      const fy = nodes.map(() => 0);

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const d2 = Math.max(dx * dx + dy * dy, 1);
          const d  = Math.sqrt(d2);
          const f  = REPULSION / d2;
          fx[i] -= f * dx / d;  fy[i] -= f * dy / d;
          fx[j] += f * dx / d;  fy[j] += f * dy / d;
        }
      }

      for (const edge of edges) {
        const i = nodeIdx.get(edge.fromId);
        const j = nodeIdx.get(edge.toId);
        if (i === undefined || j === undefined) continue;
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const d  = Math.sqrt(dx * dx + dy * dy) || 1;
        const L  = 110 + 80 * (1 - edge.flow / maxFlow);
        const f  = SPRING_K * (d - L);
        fx[i] += f * dx / d;  fy[i] += f * dy / d;
        fx[j] -= f * dx / d;  fy[j] -= f * dy / d;
      }

      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].fixed) continue;
        fx[i] += GRAVITY * (cx - nodes[i].x);
        fy[i] += GRAVITY * (cy - nodes[i].y);
      }

      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].fixed) continue;
        vx[i] = (vx[i] + fx[i]) * damping;
        vy[i] = (vy[i] + fy[i]) * damping;
        nodes[i].x = Math.max(MARGIN, Math.min(W - MARGIN, nodes[i].x + vx[i]));
        nodes[i].y = Math.max(MARGIN, Math.min(H - MARGIN, nodes[i].y + vy[i]));
      }
    }
  }

  forceStep(400, DAMPING_SETTLE);

  // ── Build SVG ─────────────────────────────────────────────────────────────

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.classList.add('gv-svg');
  svg.style.userSelect = 'none';

  // Arrowhead markers
  const defs = document.createElementNS(NS, 'defs');
  for (const col of [...new Set(edges.map(e => e.color))]) {
    const mk = document.createElementNS(NS, 'marker');
    mk.setAttribute('id',           'gv-arr-' + col.replace('#', ''));
    mk.setAttribute('markerWidth',  '8');
    mk.setAttribute('markerHeight', '8');
    mk.setAttribute('refX',         '0');
    mk.setAttribute('refY',         '4');
    mk.setAttribute('orient',       'auto');
    mk.setAttribute('markerUnits',  'userSpaceOnUse');
    const poly = document.createElementNS(NS, 'polygon');
    poly.setAttribute('points', '0,0 8,4 0,8');
    poly.setAttribute('fill', col);
    mk.appendChild(poly);
    defs.appendChild(mk);
  }
  svg.appendChild(defs);

  // Faint title
  const titleEl = document.createElementNS(NS, 'text');
  titleEl.setAttribute('x',           String(cx));
  titleEl.setAttribute('y',           '22');
  titleEl.setAttribute('text-anchor', 'middle');
  titleEl.setAttribute('dominant-baseline', 'central');
  titleEl.setAttribute('class',       'sk-title');
  titleEl.textContent = 'Wärmefluss-Netzwerk';
  svg.appendChild(titleEl);

  // Edge layer — stroke/opacity/marker-end set at creation and by updateSelection();
  // draw() only updates the path 'd' and visibility.
  const edgeG = document.createElementNS(NS, 'g');
  const edgeLabelWanted = edges.map(() => false);
  const edgeElems = edges.map((e) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('fill',         'none');
    p.setAttribute('stroke',       e.color);
    p.setAttribute('stroke-width', (1.0 + 4.0 * (e.flow / maxFlow)).toFixed(1));
    p.setAttribute('opacity',      (0.28 + 0.52 * (e.flow / maxFlow)).toFixed(2));
    p.setAttribute('marker-end',   `url(#gv-arr-${e.color.replace('#', '')})`);
    edgeG.appendChild(p);
    return p;
  });
  svg.appendChild(edgeG);

  // Node layer
  let selectedIdx: number | null = null;
  const nodeElems: NodeElems[] = [];
  const nodeG = document.createElementNS(NS, 'g');

  const nodeGs = nodes.map((node) => {
    const g = document.createElementNS(NS, 'g') as SVGGElement;

    if (node.kind === 'env') {
      const nw = 76, nh = 34;
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x',       String(-nw / 2));
      rect.setAttribute('y',       String(-nh / 2));
      rect.setAttribute('width',   String(nw));
      rect.setAttribute('height',  String(nh));
      rect.setAttribute('rx',      '7');
      rect.setAttribute('fill',    C_NEIGHBOR);
      rect.setAttribute('opacity', '0.78');
      g.appendChild(rect);
      mkText(g, NS, node.label,                                0, -5, 'rgba(255,255,255,0.88)', '8',   'bold');
      const nt = mkText(g, NS, `${Math.round(node.heatLoad)} W`, 0,  7, 'rgba(255,255,255,0.55)', '7',   'normal', 'monospace');
      nodeElems.push({ mainShape: rect, nameText: nt, fullLabel: node.label, shortLabel: node.label });
    } else {
      const frac   = node.heatLoad / maxHL;
      const sat    = Math.round(40 + frac * 30);
      const lum    = Math.round(28 + frac * 18);
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx',           '0');
      circle.setAttribute('cy',           '0');
      circle.setAttribute('r',            node.r.toFixed(1));
      circle.setAttribute('fill',         `hsl(220,${sat}%,${lum}%)`);
      circle.setAttribute('stroke',       'rgba(255,255,255,0.15)');
      circle.setAttribute('stroke-width', '1');
      g.appendChild(circle);

      mkText(g, NS, `${Math.round(node.heatLoad)} W`, 0, 3, 'rgba(255,255,255,0.82)', '7', 'normal', 'monospace');
      const short = node.label.length > 11 ? node.label.substring(0, 10) + '…' : node.label;
      const nt = mkText(g, NS, short, 0, node.r + 12, 'rgba(255,255,255,0.32)', '7', 'normal');
      nodeElems.push({ mainShape: circle, nameText: nt, fullLabel: node.label, shortLabel: short });
      g.style.cursor = 'grab';
    }

    nodeG.appendChild(g);
    return g;
  });
  svg.appendChild(nodeG);

  // Edge label layer — above nodes so labels read cleanly
  const edgeLabelG = document.createElementNS(NS, 'g');
  const edgeLabelElems = edges.map((e) => {
    const t = document.createElementNS(NS, 'text') as SVGTextElement;
    t.setAttribute('text-anchor',  'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('font-size',    '7.5');
    t.setAttribute('font-family',  'monospace');
    t.setAttribute('font-weight',  'normal');
    t.setAttribute('fill',         'rgba(255,255,255,0.92)');
    t.setAttribute('stroke',       'rgba(12,14,20,0.9)');
    t.setAttribute('stroke-width', '2.5');
    t.setAttribute('paint-order',  'stroke fill');
    t.setAttribute('visibility',   'hidden');
    t.textContent = `${Math.round(e.flow)} W`;
    edgeLabelG.appendChild(t);
    return t;
  });
  svg.appendChild(edgeLabelG);

  container.appendChild(svg);

  // ── Edge geometry (straight line + midpoint for label) ────────────────────

  function edgeGeom(fn: GNode, tn: GNode): { d: string; mx: number; my: number } | null {
    const dx = tn.x - fn.x, dy = tn.y - fn.y;
    const d  = Math.sqrt(dx * dx + dy * dy);
    // env nodes are rectangles (76×34); the arrowhead tip must clear the rectangle
    // corner at any approach angle (max boundary ≈ 41.6 px from centre).
    // Room nodes: increase from 9 → 16 so the gap is visible at display scale.
    const endPad = tn.kind === 'env' ? 30 : 16;
    // Guard: ensure the path segment has at least 4 px of length so the arrowhead
    // is never placed backwards (negative-length path causes orient=auto to flip).
    if (d <= fn.r + tn.r + endPad + 2 + 4) return null;
    const nx = dx / d, ny = dy / d;
    const x1 = fn.x + nx * (fn.r + 2);
    const y1 = fn.y + ny * (fn.r + 2);
    const x2 = tn.x - nx * (tn.r + endPad);
    const y2 = tn.y - ny * (tn.r + endPad);
    // label offset: 8px perpendicular to edge direction (left-hand side)
    const mx = (x1 + x2) / 2 - ny * 8;
    const my = (y1 + y2) / 2 + nx * 8;
    return { d: `M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`, mx, my };
  }

  // ── draw(): update positions only; appearance is owned by updateSelection() ─

  function draw(): void {
    for (let i = 0; i < nodes.length; i++) {
      nodeGs[i].setAttribute('transform',
        `translate(${nodes[i].x.toFixed(1)},${nodes[i].y.toFixed(1)})`);
    }
    for (let ei = 0; ei < edges.length; ei++) {
      const e  = edges[ei];
      const fi = nodeIdx.get(e.fromId);
      const ti = nodeIdx.get(e.toId);
      if (fi === undefined || ti === undefined) continue;
      const g  = edgeGeom(nodes[fi], nodes[ti]);
      const ep = edgeElems[ei];
      const el = edgeLabelElems[ei];
      if (g === null) {
        ep.setAttribute('visibility', 'hidden');
        el.setAttribute('visibility', 'hidden');
      } else {
        ep.setAttribute('visibility', 'visible');
        ep.setAttribute('d', g.d);
        el.setAttribute('x', g.mx.toFixed(1));
        el.setAttribute('y', g.my.toFixed(1));
        // label visibility is governed by edgeLabelWanted (set by updateSelection)
        el.setAttribute('visibility', edgeLabelWanted[ei] ? 'visible' : 'hidden');
      }
    }
  }

  draw();

  // ── Selection: node + edge appearance ─────────────────────────────────────

  function updateSelection(): void {
    // Nodes
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].kind !== 'room') continue;
      const el = nodeElems[i];
      if (i === selectedIdx) {
        el.mainShape.setAttribute('stroke',       'rgba(255,255,255,0.68)');
        el.mainShape.setAttribute('stroke-width', '1.8');
        el.nameText.setAttribute('fill',        'rgba(255,255,255,0.85)');
        el.nameText.setAttribute('font-size',   '8.5');
        el.nameText.setAttribute('font-weight', 'bold');
        el.nameText.textContent = el.fullLabel;
        el.nameText.setAttribute('y', String(nodes[i].r + 14));
      } else {
        el.mainShape.setAttribute('stroke',       'rgba(255,255,255,0.15)');
        el.mainShape.setAttribute('stroke-width', '1');
        el.nameText.setAttribute('fill',        'rgba(255,255,255,0.32)');
        el.nameText.setAttribute('font-size',   '7');
        el.nameText.setAttribute('font-weight', 'normal');
        el.nameText.textContent = el.shortLabel;
        el.nameText.setAttribute('y', String(nodes[i].r + 12));
      }
    }

    // Edges
    const selId = selectedIdx !== null ? nodes[selectedIdx].id : null;
    for (let ei = 0; ei < edges.length; ei++) {
      const e  = edges[ei];
      const ep = edgeElems[ei];
      const connected = selId !== null && (e.fromId === selId || e.toId === selId);

      if (selId === null) {
        // Restore defaults
        ep.setAttribute('stroke',       e.color);
        ep.setAttribute('stroke-width', (1.0 + 4.0 * (e.flow / maxFlow)).toFixed(1));
        ep.setAttribute('opacity',      (0.28 + 0.52 * (e.flow / maxFlow)).toFixed(2));
        ep.setAttribute('marker-end',   `url(#gv-arr-${e.color.replace('#', '')})`);
        edgeLabelWanted[ei] = false;
      } else if (connected) {
        ep.setAttribute('stroke',       e.color);
        ep.setAttribute('stroke-width', (2.5 + 2.5 * (e.flow / maxFlow)).toFixed(1));
        ep.setAttribute('opacity',      '1');
        ep.setAttribute('marker-end',   `url(#gv-arr-${e.color.replace('#', '')})`);
        edgeLabelWanted[ei] = true;
      } else {
        ep.setAttribute('stroke',       'rgba(255,255,255,0.06)');
        ep.setAttribute('stroke-width', '0.8');
        ep.setAttribute('opacity',      '1');
        ep.setAttribute('marker-end',   'none');
        edgeLabelWanted[ei] = false;
      }
    }

    draw();
  }

  // ── Animation ─────────────────────────────────────────────────────────────

  let dragIdx: number | null = null;
  let dragMoved = false;
  let rafId = 0;

  function stopAnim(): void {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  // Re-settle after drag. 4 steps/frame at d=0.65 gives the same per-frame energy
  // decay as the original 8-step/0.78 config (0.65^4 ≈ 0.178), but with half the
  // position change per visual frame → smoother deceleration, no oscillation.
  function startAnim(): void {
    stopAnim();
    function tick(): void {
      forceStep(4, 0.15);
      draw();
      const ke = vx.reduce((s, v) => s + v * v, 0) + vy.reduce((s, v) => s + v * v, 0);
      if (ke > 0.05) rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  // ── Interaction ───────────────────────────────────────────────────────────

  function svgXY(e: MouseEvent): { x: number; y: number } {
    const r = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width)  * W,
      y: ((e.clientY - r.top)  / r.height) * H,
    };
  }

  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].fixed) continue;
    const ni = i;
    nodeGs[ni].addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      stopAnim();
      dragIdx   = ni;
      dragMoved = false;
      nodes[ni].fixed = true;
      vx[ni] = vy[ni] = 0;
      nodeGs[ni].style.cursor = 'grabbing';
    });
  }

  function onMove(e: MouseEvent): void {
    if (dragIdx === null) return;
    dragMoved = true;
    const { x, y } = svgXY(e);
    nodes[dragIdx].x = Math.max(MARGIN, Math.min(W - MARGIN, x));
    nodes[dragIdx].y = Math.max(MARGIN, Math.min(H - MARGIN, y));
    forceStep(3, DAMPING_SETTLE);
    draw();
  }

  function onUp(): void {
    if (dragIdx === null) return;
    const i = dragIdx;
    dragIdx = null;
    nodes[i].fixed = false;
    vx[i] = vy[i] = 0;
    nodeGs[i].style.cursor = 'grab';
    if (!dragMoved) {
      selectedIdx = selectedIdx === i ? null : i;
      updateSelection();
    }
    startAnim();
  }

  svg.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  _prevCleanup = () => {
    window.removeEventListener('mouseup', onUp);
    stopAnim();
  };
}

// ── SVG text helper ───────────────────────────────────────────────────────────

function mkText(
  parent: Element, ns: string, content: string,
  x: number, y: number, fill: string, fontSize: string,
  fontWeight: string, fontFamily = 'sans-serif',
): SVGTextElement {
  const t = document.createElementNS(ns, 'text') as SVGTextElement;
  t.setAttribute('x',            String(x));
  t.setAttribute('y',            String(y));
  t.setAttribute('text-anchor',  'middle');
  t.setAttribute('font-size',    fontSize);
  t.setAttribute('font-family',  fontFamily);
  t.setAttribute('font-weight',  fontWeight);
  t.setAttribute('fill',         fill);
  t.textContent = content;
  parent.appendChild(t);
  return t;
}
