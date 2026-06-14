import './style.css';
import { loadProject, saveProject, clearProject, exportProjectJSON, importProjectJSON } from './model/persistence.js';
import { loadCustomPresets, mergeCustomPresets } from './library/customPresets.js';
import { Editor } from './editor/editorState.js';
import { renderFloor } from './editor/canvasRenderer.js';
import { renderPropertyPanel } from './ui/propertyPanel.js';
import { renderLibraryPanel } from './ui/libraryPanel.js';
import { renderRoomPanel } from './ui/roomPanel.js';
import { renderResultsBench, renderSankey } from './ui/resultsPanel.js';
import { renderGraph } from './ui/graphView.js';
import { renderReport } from './ui/reportView.js';
import { renderSettingsView } from './ui/settingsView.js';
import { renderImpressumView } from './ui/impressumView.js';
import { renderMaterialsView } from './ui/materialsView.js';
import { createExampleProject } from './ui/exampleProject.js';
import { calculateHeizlast } from './calc/heizlast.js';
import { exportPdf } from './ui/pdfExport.js';
import type { Project, Room } from './model/types.js';
import type { ToolMode } from './editor/editorState.js';

const project = loadProject();
const editor = new Editor(project);

// ---- Canvas ----
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function resizeCanvas(): void {
  const container = canvas.parentElement!;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w > 0 && h > 0) {
    canvas.width = w;
    canvas.height = h;
  }
  scheduleRender();
}

// ResizeObserver catches all container size changes (window resize, panel expand/collapse, etc.)
new ResizeObserver(() => resizeCanvas()).observe(canvas.parentElement!);
// Keep window listener as a fallback for browsers without ResizeObserver
window.addEventListener('resize', resizeCanvas);

// ---- Render ----
let renderScheduled = false;

function scheduleRender(): void {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(doRender);
}

function doRender(): void {
  renderScheduled = false;
  if (canvas.width === 0 || canvas.height === 0) return;
  const state   = editor.getState();
  const project = editor.getProject();
  const activeIdx  = state.activeFloorIndex;
  const floor      = project.floors[activeIdx] ?? project.floors[0];
  const activeFloor = project.floors[activeIdx];
  const floorBelow  = project.floors.find(f => f.level === activeFloor.level - 1);
  const ghostFloors = floorBelow ? [floorBelow] : undefined;
  renderFloor(ctx, floor, state.viewport, editor.getRenderState(), canvas.width, canvas.height, ghostFloors);
}

// View-only updates: canvas + cursor + status (no save, no DOM panel rebuild)
editor.onRenderUpdate(() => {
  scheduleRender();
  updateCursor();
  updateStatusBar();
});

// Full project changes: save + DOM rebuild
editor.onChange(() => {
  saveProject(editor.getProject() as Project);
  scheduleRender();
  updateCursor();
  refreshSidebar();
  refreshLeftPanel();
  refreshRoomPanel();
  refreshFloorTabs();
  refreshResultsBench();
  updateStatusBar();
});

// ---- Left panel: library ----
const leftPanelContent = document.getElementById('leftpanel-content')!;

function refreshLeftPanel(): void {
  renderLibraryPanel(leftPanelContent, editor);
}
refreshLeftPanel();

// ---- Left panel: rooms ----
const roomsContent      = document.getElementById('rooms-content')!;
const roomsHeaderCount  = document.getElementById('rooms-header-count');

function refreshRoomPanel(): void {
  const proj       = editor.getProject() as Project;
  const totalRooms = proj.floors.reduce((s, f) => s + f.rooms.length, 0);
  if (roomsHeaderCount) roomsHeaderCount.textContent = `(${totalRooms})`;
  renderRoomPanel(roomsContent, proj, editor.getState().activeFloorIndex, editor);
}
refreshRoomPanel();

// ---- Floor tabs (canvas overlay) ----
const floorTabs = document.getElementById('floor-tabs')!;

function refreshFloorTabs(): void {
  const floors    = editor.getProject().floors;
  const activeIdx = editor.getState().activeFloorIndex;
  if (floors.length <= 1) {
    floorTabs.style.display = 'none';
    return;
  }
  floorTabs.style.display = 'flex';
  floorTabs.innerHTML = '';
  floors.forEach((floor, i) => {
    const btn = document.createElement('button');
    btn.className = 'floor-tab-btn' + (i === activeIdx ? ' active' : '');
    btn.textContent = floor.label;
    btn.addEventListener('click', () => editor.setActiveFloor(i));
    floorTabs.appendChild(btn);
  });
}
refreshFloorTabs();

// ---- Sidebar (property panel) ----
const sidebarContent = document.getElementById('sidebar-content')!;

function refreshSidebar(): void {
  renderPropertyPanel(sidebarContent, editor);
}
refreshSidebar();

// ---- Results bench ----
const resultsBench = document.getElementById('results-bench')!;
const rbTotal      = document.getElementById('rb-total')!;
const rbSpecific   = document.getElementById('rb-specific')!;
const rbStrip      = document.getElementById('rb-roomstrip')!;

function refreshResultsBench(): void {
  const state = editor.getState();
  if (state.heizlastResult) {
    renderResultsBench(resultsBench, rbTotal, rbSpecific, rbStrip, state.heizlastResult);
    if (sankeyView.style.display !== 'none') {
      renderSankey(sankeyView, state.heizlastResult, editor.getProject() as Project);
    }
    if (graphView.style.display !== 'none') {
      renderGraph(graphView, state.heizlastResult, editor.getProject() as Project);
    }
    if (reportView.style.display !== 'none') {
      renderReport(reportView, state.heizlastResult, editor.getProject() as Project, editor);
    }
  }
}

// ---- View tabs: Grundriss / Sankey / Netzwerk / Report / Einstellungen ----
const canvasContainer  = document.getElementById('canvas-container')!;
const sankeyView       = document.getElementById('sankey-view')!;
const graphView        = document.getElementById('graph-view')!;
const reportView       = document.getElementById('report-view')!;
const settingsViewEl   = document.getElementById('settings-view')!;
const materialsViewEl  = document.getElementById('materials-view')!;
const impressumViewEl  = document.getElementById('impressum-view')!;
const viewPlanBtn      = document.getElementById('view-plan-btn')!;
const viewSankeyBtn    = document.getElementById('view-sankey-btn')!;
const viewGraphBtn     = document.getElementById('view-graph-btn')!;
const viewReportBtn    = document.getElementById('view-report-btn')!;
const viewSettingsBtn  = document.getElementById('view-settings-btn')!;
const viewMaterialsBtn = document.getElementById('view-materials-btn')!;
const viewImpressumBtn = document.getElementById('view-impressum-btn')!;

type ViewName = 'plan' | 'sankey' | 'graph' | 'report' | 'settings' | 'materials' | 'impressum';

function activateView(view: ViewName): void {
  canvasContainer.style.display  = 'none';
  sankeyView.style.display       = 'none';
  graphView.style.display        = 'none';
  reportView.style.display       = 'none';
  settingsViewEl.style.display   = 'none';
  materialsViewEl.style.display  = 'none';
  impressumViewEl.style.display  = 'none';
  viewPlanBtn.classList.remove('active');
  viewSankeyBtn.classList.remove('active');
  viewGraphBtn.classList.remove('active');
  viewReportBtn.classList.remove('active');
  viewSettingsBtn.classList.remove('active');
  viewMaterialsBtn.classList.remove('active');
  viewImpressumBtn.classList.remove('active');

  const state = editor.getState();
  if (view === 'plan') {
    canvasContainer.style.display = '';
    viewPlanBtn.classList.add('active');
    scheduleRender();
  } else if (view === 'sankey') {
    sankeyView.style.display = 'flex';
    viewSankeyBtn.classList.add('active');
    if (state.heizlastResult) renderSankey(sankeyView, state.heizlastResult, editor.getProject() as Project);
  } else if (view === 'graph') {
    graphView.style.display = 'flex';
    viewGraphBtn.classList.add('active');
    if (state.heizlastResult) renderGraph(graphView, state.heizlastResult, editor.getProject() as Project);
  } else if (view === 'report') {
    reportView.style.display = 'flex';
    viewReportBtn.classList.add('active');
    if (state.heizlastResult) renderReport(reportView, state.heizlastResult, editor.getProject() as Project, editor);
  } else if (view === 'settings') {
    settingsViewEl.style.display = 'flex';
    viewSettingsBtn.classList.add('active');
    renderSettingsView(settingsViewEl, editor.getProject() as Project, editor);
  } else if (view === 'materials') {
    materialsViewEl.style.display = 'flex';
    viewMaterialsBtn.classList.add('active');
    renderMaterialsView(materialsViewEl, editor);
  } else {
    impressumViewEl.style.display = 'flex';
    viewImpressumBtn.classList.add('active');
    renderImpressumView(impressumViewEl);
  }
}

// Re-render live when project changes and view is visible
editor.onChange(() => {
  if (settingsViewEl.style.display !== 'none') {
    renderSettingsView(settingsViewEl, editor.getProject() as Project, editor);
  }
  if (materialsViewEl.style.display !== 'none') {
    renderMaterialsView(materialsViewEl, editor);
  }
});

viewPlanBtn.addEventListener('click',      () => activateView('plan'));
viewSankeyBtn.addEventListener('click',    () => activateView('sankey'));
viewGraphBtn.addEventListener('click',     () => activateView('graph'));
viewReportBtn.addEventListener('click',    () => activateView('report'));
viewSettingsBtn.addEventListener('click',  () => activateView('settings'));
viewMaterialsBtn.addEventListener('click', () => activateView('materials'));
viewImpressumBtn.addEventListener('click', () => activateView('impressum'));

// ---- Toolbar tools ----
function activateTool(tool: ToolMode): void {
  editor.setTool(tool);
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-tool="${tool}"]`)?.classList.add('active');
}

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => activateTool(btn.dataset.tool as ToolMode));
});

// Undo / Redo
document.getElementById('undo-btn')?.addEventListener('click', () => editor.undo());
document.getElementById('redo-btn')?.addEventListener('click', () => editor.redo());

// New project
document.getElementById('new-btn')?.addEventListener('click', () => {
  if (!confirm('Aktuelles Projekt verwerfen und neu beginnen?')) return;
  clearProject();
  editor.resetProject();
  viewSankeyBtn.setAttribute('disabled', '');
  viewGraphBtn.setAttribute('disabled', '');
  viewReportBtn.setAttribute('disabled', '');
  activateView('plan');
  activateTool('select');
});

// Load example project
document.getElementById('example-btn')?.addEventListener('click', () => {
  if (!confirm(
    'Beispielprojekt laden?\n\n' +
    'Das aktuelle Projekt wird unwiderruflich überschrieben.\n' +
    'Nicht gespeicherte Änderungen gehen verloren.'
  )) return;
  saveProject(createExampleProject() as Project);
  location.reload();
});

// Dialog close / cancel
const addPresetDialog = document.getElementById('add-preset-dialog') as HTMLDialogElement | null;
document.getElementById('dialog-close')?.addEventListener('click',  () => addPresetDialog?.close());
document.getElementById('dialog-cancel')?.addEventListener('click', () => addPresetDialog?.close());

// Grid toggle
const gridToggle = document.getElementById('grid-toggle') as HTMLButtonElement;
gridToggle?.addEventListener('click', () => {
  const v = !editor.getState().gridEnabled;
  editor.setGridEnabled(v);
  gridToggle.classList.toggle('active', v);
});

// Calculate
document.getElementById('calc-btn')?.addEventListener('click', () => {
  const proj = editor.getProject() as Project;
  if (!proj.plz && proj.designTemperatureOverride === undefined) {
    alert('Bitte PLZ eingeben oder Außentemperatur manuell setzen.');
    return;
  }
  if (proj.floors[0].rooms.length === 0) {
    alert('Keine geschlossenen Räume erkannt.\nBitte zuerst ein vollständiges Wandpolygon zeichnen.');
    return;
  }
  const result = calculateHeizlast(proj);
  editor.setHeizlastResult(result);
  editor.setShowHeatMap(true);
  for (const rr of result.rooms) {
    editor.updateRoom(rr.roomId, { heizlastResult: rr.result } as Partial<Room>);
  }
  // Enable result tabs now that results are available
  viewSankeyBtn.removeAttribute('disabled');
  viewGraphBtn.removeAttribute('disabled');
  viewReportBtn.removeAttribute('disabled');
});

// Boundary labels toggle
const boundaryToggle = document.getElementById('boundary-toggle') as HTMLButtonElement;
boundaryToggle?.addEventListener('click', () => {
  const v = !editor.getState().showBoundaryLabels;
  editor.setShowBoundaryLabels(v);
  boundaryToggle.classList.toggle('active', v);
});

// Heatmap toggle
const hmToggle = document.getElementById('heatmap-toggle') as HTMLButtonElement;
hmToggle?.addEventListener('click', () => {
  const v = !editor.getState().showHeatMap;
  editor.setShowHeatMap(v);
  hmToggle.classList.toggle('active', v);
});

// PDF
document.getElementById('pdf-btn')?.addEventListener('click', () => {
  const state = editor.getState();
  if (!state.heizlastResult) { alert('Bitte zuerst Heizlast berechnen.'); return; }
  exportPdf(editor.getProject() as Project, state.heizlastResult);
});

// Save / Load
document.getElementById('save-btn')?.addEventListener('click', () => {
  const proj = editor.getProject() as Project;
  // Embed custom presets so they travel with the project file
  exportProjectJSON({ ...proj, customPresets: loadCustomPresets() } as Project);
});

const loadInput = document.getElementById('load-input') as HTMLInputElement;
loadInput?.addEventListener('change', async () => {
  const file = loadInput.files?.[0];
  if (!file) return;
  try {
    const proj = await importProjectJSON(file);
    // Restore any custom presets embedded in the file
    if ((proj as any).customPresets) mergeCustomPresets((proj as any).customPresets);
    saveProject(proj);
    location.reload();
  } catch (e) {
    alert(`Fehler beim Laden: ${e}`);
  }
});

// Zoom
document.getElementById('zoom-in')?.addEventListener('click', () =>
  editor.handleWheel(canvas.width / 2, canvas.height / 2, -100));
document.getElementById('zoom-out')?.addEventListener('click', () =>
  editor.handleWheel(canvas.width / 2, canvas.height / 2, 100));
document.getElementById('zoom-reset')?.addEventListener('click', () => {
  editor.resetViewport(canvas.width, canvas.height);
});
document.getElementById('zoom-fit')?.addEventListener('click', () => {
  editor.fitToFloor(canvas.width, canvas.height);
});

// ---- Canvas events ----
canvas.addEventListener('mousedown', e => {
  e.preventDefault();
  editor.handleMouseDown(e.offsetX, e.offsetY, e.button);
  updateCursor();
});

canvas.addEventListener('mousemove', e => {
  editor.handleMouseMove(e.offsetX, e.offsetY);
  updateCursor();
});

canvas.addEventListener('mouseup', e => {
  editor.handleMouseUp(e.offsetX, e.offsetY, e.button);
  updateCursor();
});

canvas.addEventListener('mouseleave', () => {
  editor.handleMouseUp(0, 0, 0);
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  editor.handleWheel(e.offsetX, e.offsetY, e.deltaY);
}, { passive: false });

// ---- Keyboard ----
window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

  // Prevent browser scroll on space
  if (e.key === ' ') e.preventDefault();

  editor.handleKeyDown(e.key, e.ctrlKey || e.metaKey);

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const s = editor.getState();
    if (s.selectedWallId) editor.deleteSelectedWall();
    else if (s.selectedOpeningId) editor.deleteSelectedOpening();
  }

  if (e.key === 'Escape') activateTool('select');

  if (!e.ctrlKey && !e.metaKey) {
    if (e.shiftKey && e.key === 'F') {
      editor.fitToFloor(canvas.width, canvas.height);
    } else if (!e.shiftKey) {
      switch (e.key.toLowerCase()) {
        case 'q': activateTool('select'); break;
        case 'w': activateTool('wall'); break;
        case 'f': activateTool('window'); break;
        case 't': activateTool('door'); break;
        case 'g': activateTool('garage_door'); break;
      }
    }
  }
  updateCursor();
});

window.addEventListener('keyup', e => {
  editor.handleKeyUp(e.key);
  updateCursor();
});

// ---- Cursor ----
function updateCursor(): void {
  canvas.style.cursor = editor.getCursor();
}

// ---- Status bar ----
function updateStatusBar(): void {
  const state = editor.getState();
  const scaleEl = document.getElementById('status-scale');
  if (scaleEl) {
    const mmPerPx = Math.round(1 / state.viewport.scale);
    scaleEl.textContent = `1 px = ${mmPerPx} mm`;
  }
  const gridEl = document.getElementById('status-grid');
  if (gridEl) {
    gridEl.textContent = state.gridEnabled ? `Raster ${state.gridSize} mm` : 'Raster aus';
  }
  const proj = editor.getProject();
  const countEl = document.getElementById('status-count');
  if (countEl) {
    const activeIdx = state.activeFloorIndex;
    const f = proj.floors[activeIdx] ?? proj.floors[0];
    const totalRooms = proj.floors.reduce((s, fl) => s + fl.rooms.length, 0);
    countEl.textContent = `${f.walls.length} Wände · ${totalRooms} Räume · ${f.openings.length} Öffnungen`;
  }
}

// Initial setup
activateTool('select');
updateStatusBar();

