# Heizlastberechnung DIN EN 12831

Browser-based heating load calculator following **DIN EN 12831** with a 2D CAD floor plan editor. Draw rooms, assign materials, enter your postal code — and get a complete room-by-room heat load breakdown with charts and a printable PDF report.

## Table of contents

- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Other commands](#other-commands)
- [How to use](#how-to-use)
  - [1. Set project parameters](#1-set-project-parameters)
  - [2. Draw walls](#2-draw-walls)
  - [3. Add openings](#3-add-openings)
  - [4. Manage floors](#4-manage-floors)
  - [5. Set room properties](#5-set-room-properties)
  - [6. Calculate](#6-calculate)
  - [7. Export](#7-export)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Project structure](#project-structure)
- [Calculation overview](#calculation-overview)
- [Test suite](#test-suite)
- [Deploying to a server](#deploying-to-a-server)
  - [1. Build the app locally](#1-build-the-app-locally)
  - [2. Install nginx on the server](#2-install-nginx-on-the-server)
  - [3. Copy the build to the server](#3-copy-the-build-to-the-server)
  - [4. Configure nginx](#4-configure-nginx)
  - [5. Add a domain and HTTPS](#5-add-a-domain-and-https-recommended)
  - [Updating](#updating)
- [Scope and limitations](#scope-and-limitations)

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

### 4. Manage floors

A project starts with a single floor (EG). Use the **+ Etage** button in the Räume panel to add upper floors. Each floor has its own independent drawing canvas. The active floor is highlighted; other floors are shown as a ghost overlay at 18 % opacity for reference.

- Floor tabs at the bottom of the canvas allow quick switching
- Rename a floor by editing its label in the property panel
- Remove a floor with the **×** button (requires at least two floors)

**Inter-floor adjacency is computed automatically.** When two rooms on adjacent floors have overlapping footprints, the calculator determines the shared ceiling/floor area via polygon intersection (Sutherland–Hodgman) and uses each room's actual design temperatures to compute fij. No manual configuration is required.

### 5. Set room properties

Click inside a room with the **Auswahl** tool (`Q`) to open the property panel. Set:

- Room name and design temperature
- Ceiling height and minimum air change rate
- Floor surface elements — preset (material/U-value) and boundary category
- Ceiling surface elements — preset (material/U-value) and boundary category
- Volume override for non-standard rooms

**Boundary categories for walls** are contextually filtered:

| Wall type | Available categories |
|-----------|---------------------|
| Interior (shared between two modelled rooms) | Auto-managed — fij is computed directly from the two room temperatures; no user input needed |
| Exterior (building envelope) | `Außenluft`, `Erdreich`, `Unbeheizt`, `Nachbargebäude` |

For `Unbeheizt` and `Nachbargebäude` a temperature field appears to specify the temperature on the other side.

**Boundary categories for floors and ceilings** work the same way: when an adjacent floor exists in the project the category is auto-computed from the polygon intersection; otherwise the full dropdown is shown.

### 6. Calculate

Click **▶ Berechnen**. The results bench at the bottom expands and shows:

- **Summary bar** — total heat load in kW, specific heat load (W/m²), energy class badge, and a colour-coded bar proportional to each room's absolute heat load
- **Loss breakdown** — by category (Außenluft, Erdreich, Nachbargebäude, Lüftung) with proportional bars
- **Room overview table** — rooms from all floors, area, Ti, ΦT, ΦV, ΦHL, W/m² per room; click a row to expand the element breakdown
- **ΦHL(θe) chart** — heat load vs. outside temperature curve (design point marked in orange)
- **Sankey chart** — flow diagram from loss category to room across all floors, balanced to the building design heat load

> **Note on internal surfaces:** Heat transfers through interior walls and inter-floor ceilings/floors between rooms at the same temperature (fij ≈ 0) contribute negligibly to the design heat load and appear with near-zero values in the element breakdown.

The floor plan switches to a **heat map** view — room colours range from blue (low load) to red (high load), normalised to the highest-loaded room. Canvas labels show name, design temperature, heat load (W), and floor area (when sufficiently zoomed in).

### 7. Export

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
  editor/      # Canvas engine, viewport, geometry, room detection (half-edge), wall adjacency, multi-floor ghost rendering
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
| Interior wall / inter-floor surface (both rooms modelled) | (Ti − Tadj) / (Ti − Te) — Tadj from adjacent room's design temperature |
| Erdreich | 0.45 (simplified) |
| Unbeheizt | (Ti − Tu) / (Ti − Te) — Tu user-specified |
| Nachbargebäude | (Ti − Tn) / (Ti − Te) — Tn user-specified |

**Inter-floor surfaces** are handled automatically: the shared area between rooms on adjacent floors is calculated via Sutherland–Hodgman polygon intersection (exact for convex rooms, approximate for concave). The resulting ceiling/floor surfaces are injected into the calculation as virtual elements; no manual floor/ceiling entries are needed for those portions.

Wall areas are corrected for corner overlaps (internal face length = centreline length minus half-thickness of connecting walls at each vertex).

## Test suite

```
src/
  calc/heizlast.test.ts      # fij, transmission, ventilation, window areas, two-room buildings
  model/persistence.test.ts  # JSON round-trip and migration of legacy/missing fields
```

Run with `npm test`.

## Deploying to a server

The app is fully static, so you only need a web server to host the built files. Below is a step-by-step guide for a fresh Ubuntu server (the same applies to any VPS from Hetzner, DigitalOcean, AWS, etc.).

### 1. Build the app locally

```bash
npm run build
# produces a dist/ folder
```

### 2. Install nginx on the server

```bash
ssh root@YOUR_SERVER_IP
apt update && apt install nginx -y
```

Visiting `http://YOUR_SERVER_IP` should now show the nginx welcome page.

### 3. Copy the build to the server

Run this on your **local machine**:

```bash
ssh root@YOUR_SERVER_IP "mkdir -p /var/www/heizlast"
scp -r dist/* root@YOUR_SERVER_IP:/var/www/heizlast/
```

### 4. Configure nginx

On the server, create `/etc/nginx/sites-available/heizlast`:

```nginx
server {
    listen 80;
    server_name YOUR_SERVER_IP;

    root /var/www/heizlast;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable the config and reload:

```bash
ln -s /etc/nginx/sites-available/heizlast /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

The app is now available at `http://YOUR_SERVER_IP`.

### 5. Add a domain and HTTPS (recommended)

Point an **A record** for your domain to the server IP at your domain registrar, then:

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

Certbot configures HTTPS automatically and renews the certificate for free via Let's Encrypt.

### Updating

Rebuild locally and re-copy — no server restart required:

```bash
npm run build
scp -r dist/* root@YOUR_SERVER_IP:/var/www/heizlast/
```

## Scope and limitations

- **Multi-storey buildings are supported.** Inter-floor adjacency (ceiling/floor surfaces between storeys) is computed automatically from room polygon intersection. The Sutherland–Hodgman algorithm is exact for convex rooms; non-convex rooms are handled approximately.
- **No thermal bridges (Wärmebrücken).** Noted in the PDF report footer.
- No solar gains or internal gains.
- Fully static — no backend, all data persisted in `localStorage`.
