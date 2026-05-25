# Heizlastberechnung DIN EN 12831

Browser-based heating load calculator following **DIN EN 12831** with a 2D CAD floor plan editor. Draw rooms, assign materials, enter your postal code — and get a complete room-by-room heat load breakdown.

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
# Run unit tests (calculation engine)
npm test

# Build for production
npm run build

# Preview the production build locally
npm run preview
```

## How to use

### 1. Draw walls

Select the **Wand** tool (or press `W`) and click to place wall endpoints. Each click continues the chain from the last point. Press `Esc` or right-click to stop drawing. When walls form a closed polygon, a **room is detected automatically**.

### 2. Add openings

Select **Fenster** (`F`), **Tür** (`T`), or **Tor** (`G`) and click on an existing wall to place an opening at that position.

### 3. Set room properties

Click inside a room with the **Auswahl** tool (`Q`) to open the property panel. Set:
- Room name and target temperature (quick buttons: 15 °C / 20 °C / 24 °C)
- Ceiling height and floor type
- Material and boundary category for each wall segment

### 4. Enter the postal code

Type a 5-digit German PLZ into the toolbar field. The design outside temperature θe is looked up automatically from DIN EN 12831 / DWD climate zones and shown next to the field.

### 5. Calculate

Click **▶ Berechnen**. The results tab opens showing:
- Per-room table (ΦT, ΦV, ΦHL)
- Building total and specific heat load (W/m²)
- Energetic hull group summary (Außenhülle, Gesamthülle, …)
- Expandable element breakdown with fij, ΔT, and ΦT per element

The floor plan switches to a **heat map** view (blue = low load, red = high).

### 6. Export

| Button | Action |
|--------|--------|
| **PDF** | Download a printable report with all tables |
| **Export JSON** | Save the full project to a `.heizlast.json` file |
| **Import JSON** | Load a previously saved project file |

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
  climate/     # PLZ → design temperature lookup (static JSON)
  editor/      # Canvas engine, geometry, room detection, adjacency
  materials/   # U-value database (static JSON)
  model/       # TypeScript data model, localStorage persistence
  ui/          # Property panel, results panel, PDF export
  main.ts      # Application entry point
```

## Scope and limitations

- **Phase 1:** Single-storey buildings only. The data model is prepared for multi-floor extension.
- Thermal bridges (Wärmebrücken) are **not** included (noted in the PDF report).
- No solar gains or internal gains.
- Fully static — no backend, all data persisted in `localStorage`.
