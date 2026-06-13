import type { Room, Floor, BoundaryCategory } from '../model/types.js';

function buildWallRoomMap(rooms: Room[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const room of rooms) {
    for (const wallId of room.wallIds) {
      if (!map.has(wallId)) map.set(wallId, []);
      map.get(wallId)!.push(room.id);
    }
  }
  return map;
}

/** Auto-update adjacency categories after room detection */
export function updateAdjacency(floor: Floor): Floor {
  const wallRoomMap = buildWallRoomMap(floor.rooms);
  const roomTempMap = new Map<string, number>();
  for (const room of floor.rooms) {
    roomTempMap.set(room.id, room.designTemperature);
  }

  const updatedWalls = floor.walls.map(wall => {
    const roomIds = wallRoomMap.get(wall.id) ?? [];

    if (roomIds.length === 2) {
      // Both rooms are modelled. If either room is not fully heated, the shared
      // boundary is adj_reduced; otherwise adj_heated.
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

    // No room (free wall) — exterior by default
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
  }
}
