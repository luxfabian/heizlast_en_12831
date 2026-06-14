# Heizlastberechnung DIN EN 12831

Browser-based heating load calculator following **DIN EN 12831** with a 2D CAD floor plan editor. Draw rooms, assign materials, enter your postal code — and get a complete room-by-room heat load breakdown with charts and a printable PDF report.

## Disclaimers

### Conformity with DIN EN 12831

This application implements a **simplified interpretation** of DIN EN 12831-1:2017. Conformity with the current version of the norm is **not guaranteed**. Results depend on the accuracy of the input data (geometry, U-values, air change rates, boundary conditions) provided by the user. The application is intended as a planning aid and does **not** replace verification by a qualified engineer. The user bears full responsibility for checking and validating all results before using them as a basis for engineering decisions.

### AI-assisted development

This application was developed entirely with the assistance of **[Claude Code](https://claude.ai/code)** (Anthropic PBC), an AI-powered coding tool. All source code — including the calculation engine, CAD editor, and user interface — was produced through AI-assisted programming. The author has reviewed and validated the code, but users should be aware of this development context.

---

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
  - [7. Analyse results](#7-analyse-results)
  - [8. Export](#8-export)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Project structure](#project-structure)
- [Calculation overview](#calculation-overview)
- [Uncertainty analysis](#uncertainty-analysis)
- [Test suite](#test-suite)
- [Deploying](#deploying)
  - [GitHub Pages](#github-pages)
  - [Self-hosted (nginx)](#self-hosted-nginx)
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

Open the **Einstellungen** tab in the toolbar. It has two sections:

**Projektinformationen**
- Project name
- Postal code (PLZ) — norm outside temperature θe is looked up from DIN EN 12831 / DWD climate zones
- θe Normaussentemperatur (°C) — manual override; leave blank to use the PLZ-derived value
- θg Erdreichtemperatur (°C) — ground temperature (default 10 °C per DIN EN 12831)
- Option to allow heat gains from warmer neighbouring rooms (non-standard, deviates from DIN EN 12831)

**Unsicherheitsanalyse**

Set relative uncertainties (%) for U-values (εU), areas (εA), and air change rates (εn). Gaussian error propagation is applied automatically; results are shown as Φ_HL ± σ. Defaults to 5 % each.

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

- Total heat load (kW) with uncertainty ± σ
- Specific heat load (W/m²)
- Energy class badge
- Colour-coded bar proportional to each room's heat load

The floor plan switches to a **heat map** view — room colours range from blue (low load) to red (high load), normalised to the highest-loaded room.

The **Analyse** tabs in the toolbar are unlocked: Sankey, Netzwerk, Report.

### 7. Analyse results

**Sankey** — flow diagram from loss category to room, balanced to the building design heat load.

**Netzwerk** — heat flow graph showing rooms as nodes and thermal connections as edges, with node count, edge count, and connected components.

**Report** — detailed results page:
- Building-level KPIs and loss-by-category table
- Hull-group editor for grouping boundary elements
- Gaussian probability distribution plot for Φ_HL (based on the propagated uncertainty σ)
- Room selector with per-room KPIs and full element breakdown table

### 8. Export

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
| `Shift+F` | Fit floor plan to view |
| `Esc` | Abbrechen / stop drawing |
| `Del` | Delete selected wall or opening |
| `Ctrl+Z` | Undo (50 steps) |
| `Ctrl+Y` | Redo |
| Scroll wheel | Zoom in / out |
| Middle mouse / Right mouse / Space | Pan |

## Project structure

```
src/
  calc/        # DIN EN 12831 calculation engine (pure functions, unit-tested)
  climate/     # PLZ → design temperature lookup (static JSON, DWD climate zones)
  editor/      # Canvas engine, viewport, geometry, room detection (half-edge), wall adjacency, multi-floor ghost rendering
  library/     # Built-in and custom presets for walls, windows, doors, floors, ceilings
  materials/   # U-value database (static JSON)
  model/       # TypeScript data model, localStorage persistence, migration
  ui/          # Property panel, results panel, Sankey, network graph, report, settings, impressum, PDF export
  main.ts      # Application entry point
```

## Calculation overview

The engine follows the simplified method of **DIN EN 12831-1:2017**:

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

## Uncertainty analysis

The application propagates input uncertainties to Φ_HL using a **systematic (correlated) Gaussian error model**:

| Component | Formula |
|-----------|---------|
| σ_T (transmission) | \|Φ_T\| · √(εU² + εA²) |
| σ_V (ventilation) | \|Φ_V\| · √(εn² + εA²) |
| σ total (building) | σ_T + σ_V (correlated sum — interior walls cancel) |

At building level, only exterior losses (Außenluft, Erdreich, Nachbargebäude) contribute to σ, because opposing interior wall contributions cancel under correlated errors.

Results are shown as Φ_HL ± σ in the bottom bar, Report KPIs, and a Gaussian probability density plot in the Report tab. Default uncertainties are 5 % for all three sources.

## Test suite

```
src/
  calc/heizlast.test.ts      # fij, transmission, ventilation, window areas, two-room buildings
  model/persistence.test.ts  # JSON round-trip and migration of legacy/missing fields
```

Run with `npm test`.

## Deploying

The app is fully static. After `npm run build` the `dist/` folder contains only HTML, CSS, and JS — no server-side runtime required.

### GitHub Pages

The repository is configured for automatic deployment via GitHub Actions (`.github/workflows/deploy.yml`).

1. Go to your repository → **Settings** → **Pages**
2. Set *Source* to **GitHub Actions**
3. Push to `main` — the workflow builds and deploys automatically

Live URL: `https://<your-username>.github.io/heizlast_en_12831/`

### Self-hosted (nginx)

Below is a step-by-step guide for a fresh Ubuntu server.

#### 1. Build the app locally

```bash
npm run build
# produces a dist/ folder
```

#### 2. Install nginx on the server

```bash
ssh root@YOUR_SERVER_IP
apt update && apt install nginx -y
```

#### 3. Copy the build to the server

Run this on your **local machine**:

```bash
ssh root@YOUR_SERVER_IP "mkdir -p /var/www/heizlast"
scp -r dist/* root@YOUR_SERVER_IP:/var/www/heizlast/
```

#### 4. Configure nginx

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

#### 5. Add a domain and HTTPS (recommended)

Point an **A record** for your domain to the server IP at your domain registrar, then:

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

Certbot configures HTTPS automatically and renews the certificate for free via Let's Encrypt.

#### Updating

Rebuild locally and re-copy — no server restart required:

```bash
npm run build
scp -r dist/* root@YOUR_SERVER_IP:/var/www/heizlast/
```

## Scope and limitations

- **Multi-storey buildings are supported.** Inter-floor adjacency (ceiling/floor surfaces between storeys) is computed automatically from room polygon intersection. The Sutherland–Hodgman algorithm is exact for convex rooms; non-convex rooms are handled approximately.
- **No thermal bridges (Wärmebrücken).** Noted in the PDF report footer.
- No solar gains or internal gains.
- Ground floor heat loss uses a simplified fixed fij = 0.45; the detailed ground calculation per EN ISO 13370 is not implemented.
- Fully static — no backend, all data persisted in `localStorage`.
