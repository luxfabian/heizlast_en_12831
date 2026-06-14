export interface CeilingTypePreset {
  id: string;
  name: string;
  uValue: number;
}

export interface WallTypePreset {
  id: string;
  name: string;
  description: string;
  uValue: number;    // W/m²K
  thickness: number; // mm
}

export interface OpeningTypePreset {
  id: string;
  name: string;
  type: 'window' | 'door' | 'garage_door';
  width: number;  // mm
  height: number; // mm
  uValue: number; // W/m²K
}

// ─────────────────────────────────────────────────────────────────────────────
// U-values are based on:
//   • IWU TABULA Germany building typology (Loga et al. 2016, webtool.building-typology.eu)
//     — typical as-built values per construction period for German single-family houses
//   • GEG 2023 (Gebäudeenergiegesetz) — minimum requirements for new construction
//   • KfW Effizienzhaus 40/55 — voluntary high-performance standards
// ─────────────────────────────────────────────────────────────────────────────

export const WALL_PRESETS: WallTypePreset[] = [
  // ── New construction: energy efficiency standards ──────────────────────────
  { id: 'aw_kfw40',      name: 'AW KfW 40',       description: 'KfW Effizienzhaus 40',          uValue: 0.15, thickness: 380 },
  { id: 'aw_kfw55',      name: 'AW KfW 55',       description: 'KfW Effizienzhaus 55',          uValue: 0.20, thickness: 320 },
  { id: 'aw_neubau',     name: 'AW GEG 2024',     description: 'GEG 2023 Mindestanforderung',   uValue: 0.28, thickness: 250 },
  // ── Existing building stock: TABULA Germany typical values ─────────────────
  { id: 'aw_2002_2015',  name: 'AW 2002–2015',    description: 'EnEV 2002, TABULA DE typisch',  uValue: 0.35, thickness: 240 },
  { id: 'aw_1995_2001',  name: 'AW 1995–2001',    description: 'WSchV 1995, TABULA DE typisch', uValue: 0.45, thickness: 240 },
  { id: 'aw_1984_1994',  name: 'AW 1984–1994',    description: 'WSchV 1984, TABULA DE typisch', uValue: 0.60, thickness: 240 },
  { id: 'aw_altbau',     name: 'AW 1969–1983',    description: 'WSchV 1977, TABULA DE typisch', uValue: 0.90, thickness: 300 },
  { id: 'aw_1958_1968',  name: 'AW 1958–1968',    description: 'TABULA DE typisch',             uValue: 1.10, thickness: 360 },
  { id: 'aw_vor1958',    name: 'AW vor 1958',     description: 'Massivbau, TABULA DE typisch',  uValue: 1.40, thickness: 380 },
  // ── Interior walls ─────────────────────────────────────────────────────────
  { id: 'iw_massiv',     name: 'IW Massiv',       description: 'Kalksandstein 17,5 cm',         uValue: 1.20, thickness: 175 },
  { id: 'iw_std',        name: 'IW Standard',     description: 'Kalksandstein 11,5 cm',         uValue: 2.00, thickness: 115 },
  { id: 'iw_leicht',     name: 'IW Leicht',       description: 'Leichtbauwand 8 cm',            uValue: 2.50, thickness:  80 },
  // ── Basement / ground-contact walls ────────────────────────────────────────
  { id: 'keller',        name: 'KW Keller',       description: 'Betonwand Erdreich, unsaniert', uValue: 0.50, thickness: 300 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Window U-values (Uw including frame) from TABULA Germany and EN 673.
// Triple glazing standard today: Uw ≈ 0.7–1.0 W/m²K (argon/krypton, warm edge)
// Double glazing with heat-protection coating (post-1995): Uw ≈ 1.1–1.6 W/m²K
// Double glazing (1979–1994, air-filled): Uw ≈ 2.7–3.1 W/m²K   (TABULA)
// Single glazing (pre-1979): Uw ≈ 4.8–5.5 W/m²K               (TABULA)
// ─────────────────────────────────────────────────────────────────────────────

export const WINDOW_PRESETS: OpeningTypePreset[] = [
  // ── Triple glazing (Dreifach-ISO) — current standard ───────────────────────
  { id: 'win_triple_60x60',    name: '60×60 3×',    type: 'window', width:  600, height:  600, uValue: 0.9 },
  { id: 'win_triple_80x120',   name: '80×120 3×',   type: 'window', width:  800, height: 1200, uValue: 0.9 },
  { id: 'win_triple_100x120',  name: '100×120 3×',  type: 'window', width: 1000, height: 1200, uValue: 0.9 },
  { id: 'win_triple_120x140',  name: '120×140 3×',  type: 'window', width: 1200, height: 1400, uValue: 0.9 },
  // ── Double glazing with Wärmeschutzbeschichtung (post-1995, argon) ──────────
  { id: 'win_double_80x120',   name: '80×120 2× WS',  type: 'window', width:  800, height: 1200, uValue: 1.3 },
  { id: 'win_double_100x120',  name: '100×120 2× WS', type: 'window', width: 1000, height: 1200, uValue: 1.3 },
  { id: 'win_double_120x140',  name: '120×140 2× WS', type: 'window', width: 1200, height: 1400, uValue: 1.3 },
  { id: 'win_double_150x140',  name: '150×140 2× WS', type: 'window', width: 1500, height: 1400, uValue: 1.3 },
  { id: 'win_double_200x140',  name: '200×140 2× WS', type: 'window', width: 2000, height: 1400, uValue: 1.3 },
  // ── Double glazing, air-filled (1979–1994) — TABULA ───────────────────────
  { id: 'win_old_80x120',      name: '80×120 2× alt',   type: 'window', width:  800, height: 1200, uValue: 2.8 },
  { id: 'win_old_120x140',     name: '120×140 2× alt',  type: 'window', width: 1200, height: 1400, uValue: 2.8 },
  // ── Single glazing (vor 1979) — TABULA ─────────────────────────────────────
  { id: 'win_single_80x120',   name: '80×120 1×',       type: 'window', width:  800, height: 1200, uValue: 4.8 },
  { id: 'win_single_120x140',  name: '120×140 1×',      type: 'window', width: 1200, height: 1400, uValue: 4.8 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Door U-values from GEG 2023 and TABULA.
// Modern exterior (GEG min): Ud ≤ 1.80 W/m²K; high-quality: 0.8–1.3 W/m²K
// Old exterior doors: 2.5–4.0 W/m²K
// Interior doors (unheated side): ~2.0–3.5 W/m²K
// ─────────────────────────────────────────────────────────────────────────────

export const DOOR_PRESETS: OpeningTypePreset[] = [
  { id: 'door_int_75',    name: '75×200 innen',     type: 'door', width:  750, height: 2000, uValue: 2.0 },
  { id: 'door_int_87',    name: '87.5×200 innen',   type: 'door', width:  875, height: 2000, uValue: 2.0 },
  { id: 'door_int_100',   name: '100×200 innen',    type: 'door', width: 1000, height: 2000, uValue: 2.0 },
  { id: 'door_ext_100',   name: '100×200 außen',    type: 'door', width: 1000, height: 2100, uValue: 1.3 },
  { id: 'door_ext_125',   name: '125×210 außen',    type: 'door', width: 1250, height: 2100, uValue: 1.3 },
  { id: 'door_ext_old',   name: '100×200 alt',      type: 'door', width: 1000, height: 2000, uValue: 3.5 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Garage door U-values.
// Uninsulated steel sectional door: 3.5–5.0 W/m²K
// Insulated steel sectional door (modern): 0.9–1.5 W/m²K
// ─────────────────────────────────────────────────────────────────────────────

export const GARAGE_PRESETS: OpeningTypePreset[] = [
  { id: 'garage_240x200', name: '240×200 unged.',  type: 'garage_door', width: 2400, height: 2000, uValue: 4.0 },
  { id: 'garage_250x225', name: '250×225 unged.',  type: 'garage_door', width: 2500, height: 2250, uValue: 4.0 },
  { id: 'garage_300x225', name: '300×225 unged.',  type: 'garage_door', width: 3000, height: 2250, uValue: 4.0 },
  { id: 'garage_500x225', name: '500×225 unged.',  type: 'garage_door', width: 5000, height: 2250, uValue: 4.0 },
  { id: 'garage_insul',   name: '240×200 gedämmt', type: 'garage_door', width: 2400, height: 2000, uValue: 1.0 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Ceiling / roof U-values from TABULA Germany and GEG 2023.
// Uninsulated tile roof (Dachstuhl + Ziegel): ~1.5–2.5 W/m²K
// Post-1995 insulated: ~0.25–0.40 W/m²K
// GEG 2023 new: max 0.20 W/m²K
// ─────────────────────────────────────────────────────────────────────────────

export const CEILING_PRESETS: CeilingTypePreset[] = [
  // ── Pitched/flat roofs, exterior-facing ────────────────────────────────────
  { id: 'roof_passive',    name: 'Dach KfW 40',            uValue: 0.12 },
  { id: 'roof_kfw40',      name: 'Dach KfW 55',            uValue: 0.15 },
  { id: 'roof_kfw55',      name: 'Dach GEG 2024',          uValue: 0.20 },
  { id: 'roof_neubau',     name: 'Dach 2002–2015',         uValue: 0.30 },
  { id: 'roof_1995_2001',  name: 'Dach 1995–2001',         uValue: 0.45 },
  { id: 'roof_1979_1994',  name: 'Dach 1979–1994',         uValue: 0.70 },
  { id: 'roof_altbau',     name: 'Dach 1969–1978',         uValue: 0.90 },
  { id: 'roof_vor1969',    name: 'Dach vor 1969 (unged.)', uValue: 1.60 },
  // ── Ceiling below unheated attic or cellar ─────────────────────────────────
  { id: 'ceil_dachboden',  name: 'Decke zu Dachboden',     uValue: 0.25 },
  { id: 'ceil_keller',     name: 'Decke zu Keller',        uValue: 0.35 },
  // ── Inter-floor (heated room above) ────────────────────────────────────────
  { id: 'ceil_beheizt',    name: 'Decke zu Beheiztem',     uValue: 0.40 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Floor U-values. DIN EN 12831 uses fij = 0.45 (simplified ground correction),
// so U here represents the slab construction only.
// GEG 2023: max Ueq = 0.35 W/m²K. Uninsulated concrete: ~0.7–1.5 W/m²K.
// ─────────────────────────────────────────────────────────────────────────────

export const FLOOR_PRESETS: CeilingTypePreset[] = [
  { id: 'floor_kfw40',    name: 'Bodenplatte KfW 40',    uValue: 0.15 },
  { id: 'floor_neubau',   name: 'Bodenplatte GEG 2024',  uValue: 0.30 },
  { id: 'floor_2002',     name: 'Bodenplatte 2002–2015', uValue: 0.40 },
  { id: 'floor_1995',     name: 'Bodenplatte 1995–2001', uValue: 0.50 },
  { id: 'floor_altbau',   name: 'Bodenplatte Altbau',    uValue: 0.80 },
  { id: 'floor_above',    name: 'Decke über Beheiztem',  uValue: 0.40 },
  { id: 'floor_ext',      name: 'Decke über Außenluft',  uValue: 0.25 },
];

export const DEFAULT_CEILING_PRESET_ID = 'roof_neubau';

/** All opening presets in one flat list */
export const ALL_OPENING_PRESETS: OpeningTypePreset[] = [
  ...WINDOW_PRESETS,
  ...DOOR_PRESETS,
  ...GARAGE_PRESETS,
];

export function getWallPreset(id: string): WallTypePreset | undefined {
  return WALL_PRESETS.find(p => p.id === id);
}

export function getOpeningPreset(id: string): OpeningTypePreset | undefined {
  return ALL_OPENING_PRESETS.find(p => p.id === id);
}

export function getCeilingPreset(id: string): CeilingTypePreset | undefined {
  return [...CEILING_PRESETS, ...FLOOR_PRESETS].find(p => p.id === id);
}

/** Default active presets for a fresh session — GEG 2024 new construction */
export const DEFAULT_WALL_PRESET_ID    = 'aw_neubau';
export const DEFAULT_WINDOW_PRESET_ID  = 'win_triple_120x140';
export const DEFAULT_DOOR_PRESET_ID    = 'door_ext_100';
export const DEFAULT_GARAGE_PRESET_ID  = 'garage_240x200';

/** All built-in preset IDs (used by Materialien view). Ceilings are excluded — not in the left panel. */
export const ALL_PRESET_IDS: string[] = [
  ...WALL_PRESETS.map(p => p.id),
  ...WINDOW_PRESETS.map(p => p.id),
  ...DOOR_PRESETS.map(p => p.id),
  ...GARAGE_PRESETS.map(p => p.id),
  ...FLOOR_PRESETS.map(p => p.id),
];

/** Default active preset IDs for a new project — a lean, representative selection */
export const DEFAULT_ACTIVE_PRESET_IDS: string[] = [
  // Walls: coverage from KfW new-build to pre-war stock + interior + basement
  'aw_kfw40', 'aw_neubau', 'aw_1984_1994', 'aw_altbau', 'iw_std', 'keller',
  // Windows: one per glazing era
  'win_triple_100x120', 'win_triple_120x140', 'win_double_100x120', 'win_old_80x120',
  // Doors: standard interior + exterior
  'door_int_87', 'door_ext_100',
  // Garage: one standard uninsulated
  'garage_250x225',
  // Floors: new build, existing, and intermediate floor
  'floor_neubau', 'floor_2002', 'floor_altbau', 'floor_above',
];
