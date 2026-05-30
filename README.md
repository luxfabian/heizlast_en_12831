# Heizlastberechnung DIN EN 12831

Browser-based heating load calculator following **DIN EN 12831** with a 2D CAD floor plan editor. Draw rooms, assign materials, enter your postal code — and get a complete room-by-room heat load breakdown with charts and a printable PDF report.

## Requirements

- Node.js ≥ 18
- npm ≥ 9

## Getting started

```bash
# Install dependencies (first time only)
npm install

# Start the development server
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## Other commands

```bash
# Run unit tests (calculation engine + persistence)
npm test

# Build for production
npm run build

# Preview the production build locally
npm run preview
```

## How to use

### 1. Set project parameters

The **Projekt** panel (left column) lets you configure:

- Project name
- Postal code (PLZ) — norm outside temperature θe is looked up from DIN EN 12831 / DWD climate zones and shown in green below the field
- **Als Norm** button — copies the PLZ-derived temperature into the θe override field
- θe Norm (°C) — manual override for the design outside temperature
- θg Erde (°C) — ground temperature (default 10 °C per DIN EN 12831)
- Heated area (read-only, derived from drawn rooms)

### 2. Draw walls

Select the **Wand** tool (or press `W`) and click to place wall endpoints. Each click continues the chain from the last point. Press `Esc` or right-click to stop drawing. When walls form a closed polygon, a **room is detected automatically** using a half-edge planar face traversal algorithm that guarantees only minimal faces (no phantom rooms).

### 3. Add openings

Select **Fenster** (`F`), **Tür** (`T`), or **Tor** (`G`) and click on an existing wall to place an opening at that position.

### 4. Set room properties

Click inside a room with the **Auswahl** tool (`Q`) to open the property panel. Set:

- Room name and design temperature
- Ceiling height and minimum air change rate
- Multiple floor surface elements (with optional area overrides for irregular geometry)
- Multiple ceiling surface elements
- Volume override for non-standard rooms

Each wall can be assigned a **Grenzkategorie** (boundary category). Options are contextually filtered: interior walls (shared between two rooms) only show `Beheizt`, `Reduziert`, `Nachbargebäude`; exterior walls only show `Außenluft`, `Erdreich`, `Unbeheizt`, `Nachbargebäude`.

### 5. Calculate

Click **▶ Berechnen**. The results bench at the bottom expands and shows:

- **Summary bar** — total heat load in kW, specific heat load (W/m²), energy class badge, and a colour-coded bar proportional to each room's absolute heat load
- **Loss breakdown** — by category (Außenluft, Erdreich, Nachbargebäude, Lüftung) with proportional bars
- **Room overview table** — area, Ti, ΦT, ΦV, ΦHL, W/m² per room; click a row to expand the element breakdown
- **ΦHL(θe) chart** — heat load vs. outside temperature curve (design point marked in orange)
- **Sankey chart** — flow diagram from loss category to room, balanced to the building design heat load

> **Note on internal walls:** Internal heat transfers (adj_heated / adj_reduced walls between rooms at different temperatures) are excluded from the design heat load and the Sankey chart because they cancel within the building envelope.

The floor plan switches to a **heat map** view — room colours range from blue (low load) to red (high load), normalised to the highest-loaded room. Canvas labels show name, design temperature, heat load (W), and floor area (when sufficiently zoomed in).

### 6. Export

| Button | Action |
|--------|--------|
| **PDF** | Download a printable DIN EN 12831 report with cover page, KPI boxes, loss-by-category table, room overview, and per-room element breakdown |
| **JSON** | Save the full project to a `.heizlast.json` file |
| **Laden** | Load a previously saved project file |

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Q` | Auswahl (select) |
| `W` | Wand zeichnen (draw wall) |
| `F` | Fenster einfügen |
| `T` | Tür einfügen |
| `G` | Garagentor einfügen |
| `Esc` | Abbrechen / stop drawing |
| `Del` | Delete selected wall or opening |
| `Ctrl+Z` | Undo (50 steps) |
| `Ctrl+Y` | Redo |
| Scroll wheel | Zoom in / out |
| Middle mouse | Pan |

## Project structure

```
src/
  calc/        # DIN EN 12831 calculation engine (pure functions, unit-tested)
  climate/     # PLZ → design temperature lookup (static JSON, DWD climate zones)
  editor/      # Canvas engine, viewport, geometry, room detection (half-edge), adjacency
  library/     # Built-in and custom presets for walls, windows, doors, floors, ceilings
  materials/   # U-value database (static JSON)
  model/       # TypeScript data model, localStorage persistence, migration
  ui/          # Property panel, results panel (tables + charts + Sankey), PDF export
  main.ts      # Application entry point
```

## Calculation overview

The engine follows the simplified method of **DIN EN 12831:2003**:

| Symbol | Formula |
|--------|---------|
| ΦT (W) | Σ U · A · fij · (Ti − Te) |
| ΦV (W) | 0.34 · V (m³) · n (h⁻¹) · (Ti − Te) |
| ΦHL    | ΦT + ΦV |

Temperature correction factor fij by boundary category:

| Category | fij |
|----------|-----|
| Außenluft | 1.0 |
| Beheizt (adj_heated) | (Ti − Tadj) / (Ti − Te) |
| Reduziert (adj_reduced) | (Ti − Tadj) / (Ti − Te) |
| Erdreich | 0.45 (simplified) |
| Unbeheizt | (Ti − Tu) / (Ti − Te) |
| Nachbargebäude | (Ti − Tn) / (Ti − Te) |

Wall areas are corrected for corner overlaps (internal face length = centreline length minus half-thickness of connecting walls at each vertex).

## Test suite

```
src/
  calc/heizlast.test.ts      # fij, transmission, ventilation, window areas, two-room buildings
  model/persistence.test.ts  # JSON round-trip and migration of legacy/missing fields
```

Run with `npm test`.

## Scope and limitations

- **Single-storey buildings.** The data model is prepared for multi-floor extension.
- **No thermal bridges (Wärmebrücken).** Noted in the PDF report footer.
- No solar gains or internal gains.
- Fully static — no backend, all data persisted in `localStorage`.
