import type { Room, Floor, WallSegment, Point2D, BoundaryCategory } from '../model/types.js';

function buildWallRoomMap(rooms: Room[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const room of rooms) {
    for (const wallId of room.wallIds) {
      if (!map.has(wallId)) map.set(wallId, []);
      // Deduplicate: a spur wall that appears twice in the same room must not be
      // counted as a two-room boundary (which would give it adj_heated with a
      // self-referencing adjacentRoomId, causing getAdjacentRoomTemp to fall back
      // to tE and produce full exterior heat loss).
      if (!map.get(wallId)!.includes(room.id)) map.get(wallId)!.push(room.id);
    }
  }
  return map;
}

/**
 * Returns the set of wall IDs that belong to a proper closed network.
 * Walls with a free endpoint (dangling spurs) are excluded iteratively:
 * removing one segment can expose the next in a chain, so pruning repeats
 * until no more free endpoints remain.
 */
export function buildActiveWallIds(floor: Floor): Set<string> {
  const pk = (p: Point2D) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const cnt = new Map<string, number>();
  for (const w of floor.walls) {
    const sk = pk(w.start), ek = pk(w.end);
    cnt.set(sk, (cnt.get(sk) ?? 0) + 1);
    cnt.set(ek, (cnt.get(ek) ?? 0) + 1);
  }
  const active = new Set(floor.walls.map(w => w.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of floor.walls) {
      if (!active.has(w.id)) continue;
      const sk = pk(w.start), ek = pk(w.end);
      if ((cnt.get(sk) ?? 0) <= 1 || (cnt.get(ek) ?? 0) <= 1) {
        active.delete(w.id);
        cnt.set(sk, Math.max(0, (cnt.get(sk) ?? 0) - 1));
        cnt.set(ek, Math.max(0, (cnt.get(ek) ?? 0) - 1));
        changed = true;
      }
    }
  }
  return active;
}

/** Auto-update adjacency categories after room detection */
export function updateAdjacency(floor: Floor): Floor {
  const wallRoomMap = buildWallRoomMap(floor.rooms);
  const activeWallIds = buildActiveWallIds(floor);
  const roomTempMap = new Map<string, number>();
  for (const room of floor.rooms) {
    roomTempMap.set(room.id, room.designTemperature);
  }

  const updatedWalls = floor.walls.map((wall: WallSegment) => {
    // Dangling spur wall — mark immediately, skip further classification.
    if (!activeWallIds.has(wall.id)) {
      return { ...wall, boundaryCategory: 'freestanding' as BoundaryCategory, adjacentRoomId: undefined };
    }

    const roomIds = wallRoomMap.get(wall.id) ?? [];

    if (roomIds.length === 2) {
      const r0 = floor.rooms.find(r => r.id === roomIds[0]);
      const r1 = floor.rooms.find(r => r.id === roomIds[1]);
      const type0 = r0?.roomType ?? (r0?.isHeated === false ? 'reduced' : 'heated');
      const type1 = r1?.roomType ?? (r1?.isHeated === false ? 'reduced' : 'heated');
      const cat: BoundaryCategory = (type0 === 'heated' && type1 === 'heated') ? 'adj_heated' : 'adj_reduced';
      return { ...wall, boundaryCategory: cat, adjacentRoomId: roomIds[0] };
    }

    if (roomIds.length === 1) {
      // Single-room boundary: keep user-set category (exterior / ground / unheated)
      const keepCat =
        wall.boundaryCategory === 'exterior' ||
        wall.boundaryCategory === 'ground' ||
        wall.boundaryCategory === 'unheated' ||
        wall.boundaryCategory === 'adj_neighbor';
      return {
        ...wall,
        boundaryCategory: keepCat ? wall.boundaryCategory : 'exterior' as BoundaryCategory,
        adjacentRoomId: undefined,
      };
    }

    // Active wall not in any room (isolated closed loop) — exterior by default
    return { ...wall, boundaryCategory: 'exterior' as BoundaryCategory, adjacentRoomId: undefined };
  });

  return { ...floor, walls: updatedWalls };
}

export function getBoundaryCategoryLabel(cat: BoundaryCategory): string {
  switch (cat) {
    case 'exterior':      return 'Außenluft';
    case 'adj_heated':    return 'Beheizt';
    case 'adj_reduced':   return 'Reduziert';
    case 'ground':        return 'Erdreich';
    case 'unheated':      return 'Unbeheizt';
    case 'adj_neighbor':  return 'Nachbargebäude';
    case 'freestanding':  return 'Freistehend';
  }
}

export function getBoundaryCategoryColor(cat: BoundaryCategory): string {
  switch (cat) {
    case 'exterior':      return '#ef4444';
    case 'adj_heated':    return '#22c55e';
    case 'adj_reduced':   return '#eab308';
    case 'ground':        return '#f97316';
    case 'unheated':      return '#9ca3af';
    case 'adj_neighbor':  return '#a855f7';
    case 'freestanding':  return '#64748b';
  }
}

/** Short label for in-canvas adjacency badges */
export function getBoundaryCategoryShort(cat: BoundaryCategory): string {
  switch (cat) {
    case 'exterior':      return 'EXT';
    case 'adj_heated':    return 'ADJ';
    case 'adj_reduced':   return 'RED';
    case 'ground':        return 'ERD';
    case 'unheated':      return 'UBH';
    case 'adj_neighbor':  return 'NBG';
    case 'freestanding':  return 'FST';
  }
}
