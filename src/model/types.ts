export type BoundaryCategory =
  | 'exterior'
  | 'adj_heated'
  | 'adj_reduced'
  | 'ground'
  | 'unheated'
  | 'adj_neighbor';

export interface Point2D {
  x: number; // mm
  y: number; // mm
}

export interface WallSegment {
  id: string;
  start: Point2D;
  end: Point2D;
  /** Visual and thermal thickness in mm */
  thickness: number;
  /** Thermal transmittance W/m²K */
  uValue: number;
  /** Reference to a library preset (for display only) */
  typePresetId?: string;
  boundaryCategory: BoundaryCategory;
  adjacentRoomId?: string;
  unheatedSpaceTemp?: number;
  /** If true, the start vertex cannot be dragged */
  startFixed?: boolean;
  /** If true, the end vertex cannot be dragged */
  endFixed?: boolean;
}

export interface Opening {
  id: string;
  type: 'window' | 'door' | 'garage_door';
  wallId: string;
  positionAlongWall: number; // mm from wall start
  width: number;   // mm
  height: number;  // mm
  uValue: number;  // W/m²K
  /** Reference to a library preset */
  typePresetId?: string;
  label?: string;
}

export interface Room {
  id: string;
  label: string;
  wallIds: string[]; // ordered boundary wall IDs (from auto-detection)
  designTemperature: number; // °C
  ceilingHeight: number;     // mm
  floorType: 'ground' | 'above_room' | 'exterior';
  minAirChanges?: number;    // h⁻¹ override
  area?: number;             // m², computed by room detection
  heizlastResult?: RoomHeizlastResult;
}

export interface HullGroup {
  id: string;
  name: string;
  categories: BoundaryCategory[];
  isDefault: boolean;
}

export interface Floor {
  id: string;
  level: number;
  label: string;
  defaultCeilingHeight: number; // mm
  walls: WallSegment[];
  openings: Opening[];
  rooms: Room[];
}

export interface Project {
  id: string;
  name: string;
  plz: string;
  designTemperatureOverride?: number;
  floors: Floor[];
  hullGroups: HullGroup[];
  createdAt: string;
  updatedAt: string;
}

// ---- Calculation result types ----

export interface ElementHeatLoss {
  elementId: string;
  elementType: 'wall' | 'window' | 'door' | 'garage_door' | 'floor' | 'ceiling';
  boundaryCategory: BoundaryCategory;
  area: number;    // m²
  uValue: number;  // W/m²K
  fij: number;
  actualDeltaT: number; // K
  heatLoss: number;     // W
}

export interface RoomHeizlastResult {
  transmissionLoss: number; // W
  ventilationLoss: number;  // W
  totalLoss: number;        // W
  elementBreakdown: ElementHeatLoss[];
}

export interface HullSummaryEntry {
  hullId: string;
  hullName: string;
  totalTransmissionLoss: number; // W
  shareOfBuildingTotal: number;  // 0–1
}

export interface HeizlastResult {
  rooms: { roomId: string; result: RoomHeizlastResult }[];
  buildingTotal: number;
  specificHeatLoad: number;        // W/m² (buildingTotal / totalArea)
  /** Sum of losses to outside: exterior + ground + adj_neighbor + unheated transmissions + all ventilation */
  designHeatLoad: number;
  designSpecificHeatLoad: number;  // designHeatLoad / totalArea
  lossByCategory: {
    exterior: number;    // exterior + unheated transmission
    ground: number;
    adjNeighbor: number;
    ventilation: number;
  };
  designTemperature: number;  // °C
  plz: string;
  hullSummary: HullSummaryEntry[];
}
