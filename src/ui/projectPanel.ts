import type { Project } from '../model/types.js';
import type { Editor } from '../editor/editorState.js';
import { getDesignTemperature, validatePlz } from '../climate/index.js';

export function renderProjectPanel(container: HTMLElement, project: Project, editor: Editor): void {
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'proj-grid';

  // ── Project name ──
  addRow(grid, 'Name', makeInput('text', project.name, 'Projektname', e => {
    editor.updateProject({ name: (e.target as HTMLInputElement).value });
  }));

  // ── PLZ + derived temperature status + "Als Norm" button ──
  const plzInp = document.createElement('input');
  plzInp.id = 'plz-input';
  plzInp.type = 'text';
  plzInp.className = 'input proj-input proj-plz-input';
  plzInp.value = project.plz;
  plzInp.maxLength = 5;
  plzInp.placeholder = '12345';
  plzInp.autocomplete = 'off';
  plzInp.spellcheck = false;

  addRow(grid, 'PLZ', plzInp);

  // PLZ status + "Als Norm" button — second column only, no label in first column
  const plzStatus = document.createElement('span');
  plzStatus.id = 'plz-status';
  plzStatus.className = 'plz-status';

  const setNormBtn = document.createElement('button');
  setNormBtn.className = 'btn btn-sm proj-setnorm-btn';
  setNormBtn.textContent = 'Als Norm';
  setNormBtn.title = 'PLZ-Normtemperatur als θe-Vorgabe übernehmen';
  setNormBtn.style.display = 'none';

  // Status on its own row (empty label + status text)
  grid.appendChild(document.createElement('span'));
  grid.appendChild(plzStatus);

  // Button on its own row (empty label + button)
  grid.appendChild(document.createElement('span'));
  grid.appendChild(setNormBtn);

  // ── θe override ──
  const tExtInp = document.createElement('input');
  tExtInp.type = 'number';
  tExtInp.className = 'input proj-input proj-num-input';
  tExtInp.min = '-30'; tExtInp.max = '25'; tExtInp.step = '1';
  tExtInp.placeholder = '—';
  tExtInp.title = 'Überschreibt den PLZ-Wert';
  if (project.designTemperatureOverride != null) tExtInp.value = String(project.designTemperatureOverride);
  tExtInp.addEventListener('change', () => {
    const v = tExtInp.value.trim();
    editor.updateProject({ designTemperatureOverride: v === '' ? undefined : Number(v) });
  });
  addRow(grid, 'θe Norm (°C)', tExtInp);

  // PLZ change handler — update status + show/hide "Als Norm" button
  const updateStatus = (plz: string) => {
    refreshPlzStatus(plzStatus, plz);
    const derived = derivedTemp(plz);
    setNormBtn.style.display = derived != null ? '' : 'none';
    if (derived != null) {
      setNormBtn.onclick = () => {
        tExtInp.value = String(derived);
        editor.updateProject({ designTemperatureOverride: derived });
      };
    }
  };
  plzInp.addEventListener('change', () => {
    const plz = plzInp.value.trim();
    editor.updateProject({ plz });
    updateStatus(plz);
  });
  updateStatus(project.plz);

  // ── Ground temperature ──
  addRow(grid, 'θg Erde (°C)', makeNumberInput(project.groundTemperature ?? 10, -5, 20, 0.5, e => {
    const v = Number((e.target as HTMLInputElement).value);
    editor.updateProject({ groundTemperature: isNaN(v) ? 10 : v });
  }));

  // ── Heated area (read-only) ──
  const floor = project.floors[0];
  const totalArea = floor.rooms.reduce((s, r) => s + (r.area ?? 0), 0);
  const areaSpan = document.createElement('span');
  areaSpan.className = 'proj-value';
  areaSpan.textContent = `${totalArea.toFixed(1)} m²`;
  addRow(grid, 'Fläche (beheizt)', areaSpan);

  container.appendChild(grid);
}

function addRow(grid: HTMLElement, label: string, control: HTMLElement): void {
  const lbl = document.createElement('span');
  lbl.className = 'proj-label';
  lbl.textContent = label;
  grid.appendChild(lbl);
  grid.appendChild(control);
}

function makeInput(type: string, value: string, placeholder: string, onChange?: (e: Event) => void): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = type; inp.className = 'input proj-input';
  inp.value = value; inp.placeholder = placeholder;
  if (onChange) inp.addEventListener('change', onChange);
  return inp;
}

function makeNumberInput(value: number, min: number, max: number, step: number, onChange: (e: Event) => void): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'number'; inp.className = 'input proj-input proj-num-input';
  inp.value = isNaN(value) ? '' : String(value);
  inp.min = String(min); inp.max = String(max); inp.step = String(step);
  inp.addEventListener('change', onChange);
  return inp;
}

export function refreshPlzStatus(el: HTMLElement, plz: string): void {
  if (!plz) { el.textContent = ''; el.className = 'plz-status'; return; }
  if (!validatePlz(plz)) { el.textContent = 'Ungültige PLZ'; el.className = 'plz-status error'; return; }
  const { temp, warning } = getDesignTemperature(plz);
  el.textContent = `θe = ${temp} °C${warning ? ' ⚠' : ''}`;
  el.className = `plz-status ${warning ? 'warn' : 'ok'}`;
}

function derivedTemp(plz: string): number | null {
  if (!plz || !validatePlz(plz)) return null;
  return getDesignTemperature(plz).temp;
}
