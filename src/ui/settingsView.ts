import type { Project } from '../model/types.js';
import type { Editor } from '../editor/editorState.js';
import { getDesignTemperature, validatePlz } from '../climate/index.js';

export function renderSettingsView(container: HTMLElement, project: Project, editor: Editor): void {
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'sv-wrap';
  container.appendChild(wrap);

  // ── Projektinformationen ─────────────────────────────────────────────────
  const projSec = addSection(wrap, 'Projektinformationen');

  const nameInp = svInput('text', project.name, 'Projektname');
  nameInp.addEventListener('change', () => editor.updateProject({ name: nameInp.value }));
  projSec.appendChild(svField('Projektname', nameInp));

  // PLZ + derived temperature
  const plzInp = svInput('text', project.plz, '12345');
  plzInp.maxLength = 5;
  const plzStatusEl = document.createElement('div');
  plzStatusEl.className = 'sv-note';

  function updatePlzStatus(plz: string): void {
    if (!plz) { plzStatusEl.textContent = ''; plzStatusEl.className = 'sv-note'; return; }
    if (!validatePlz(plz)) {
      plzStatusEl.textContent = 'Ungültige PLZ';
      plzStatusEl.className = 'sv-note sv-note-err';
      return;
    }
    const { temp, warning } = getDesignTemperature(plz);
    plzStatusEl.innerHTML = `θ<sub>e</sub> = ${temp} °C${warning ? '  ⚠ interpoliert' : ''}`;
    plzStatusEl.className = `sv-note ${warning ? 'sv-note-warn' : 'sv-note-ok'}`;
  }
  plzInp.addEventListener('change', () => {
    const plz = plzInp.value.trim();
    editor.updateProject({ plz });
    updatePlzStatus(plz);
  });
  updatePlzStatus(project.plz);
  const plzField = svField('PLZ', plzInp, plzStatusEl);
  projSec.appendChild(plzField);

  // θe override
  const tExtInp = svNumInput(project.designTemperatureOverride ?? NaN, -30, 25, 1);
  tExtInp.placeholder = '— aus PLZ';
  tExtInp.title = 'Überschreibt den PLZ-Wert';
  tExtInp.addEventListener('change', () => {
    const v = tExtInp.value.trim();
    editor.updateProject({ designTemperatureOverride: v === '' ? undefined : Number(v) });
  });
  projSec.appendChild(svField('θ<sub>e</sub> Normaussentemperatur (°C)', tExtInp,
    document.createTextNode('Leer lassen, um PLZ-Wert zu verwenden')));

  // θg ground temperature
  const tGndInp = svNumInput(project.groundTemperature ?? 10, -5, 20, 0.5);
  tGndInp.addEventListener('change', () => {
    const v = Number(tGndInp.value);
    editor.updateProject({ groundTemperature: isNaN(v) ? 10 : v });
  });
  projSec.appendChild(svField('θ<sub>g</sub> Erdreichtemperatur (°C)', tGndInp));

  // Heat gains from warmer neighbours
  const gainsCb = document.createElement('input') as HTMLInputElement;
  gainsCb.type = 'checkbox';
  gainsCb.className = 'proj-checkbox';
  gainsCb.checked = project.allowHeatGains ?? false;
  gainsCb.addEventListener('change', () => editor.updateProject({ allowHeatGains: gainsCb.checked }));
  projSec.appendChild(svField('Wärmegewinne Nachbarräume', gainsCb,
    document.createTextNode('⚠ Weicht von DIN EN 12831 ab')));

  // ── Unsicherheitsanalyse ─────────────────────────────────────────────────
  const uncSec = addSection(wrap, 'Unsicherheitsanalyse');

  const desc = document.createElement('p');
  desc.className = 'sv-desc';
  desc.innerHTML =
    'Gausssche Fehlerfortpflanzung mit systematisch korreliertem Fehlermodell: ' +
    'σ = |Φ<sub>T</sub>| · √(ε<sub>U</sub>² + ε<sub>A</sub>²) + |Φ<sub>V</sub>| · √(ε<sub>n</sub>² + ε<sub>A</sub>²). ' +
    'Das Ergebnis erscheint als Φ<sub>HL</sub> ± σ in Report und Zusammenfassung.';
  uncSec.appendChild(desc);

  const unc = project.uncertainty ?? { uRelPct: 0, aRelPct: 0, nRelPct: 0 };

  function updateUnc(patch: Partial<typeof unc>): void {
    const current = (editor.getProject() as Project).uncertainty
      ?? { uRelPct: 0, aRelPct: 0, nRelPct: 0 };
    editor.updateProject({ uncertainty: { ...current, ...patch } });
  }

  const uInp = svNumInput(unc.uRelPct, 0, 50, 1);
  uInp.addEventListener('change', () => updateUnc({ uRelPct: Number(uInp.value) }));
  uncSec.appendChild(svField('ε<sub>U</sub> — U-Wert (%)', uInp));

  const aInp = svNumInput(unc.aRelPct, 0, 50, 1);
  aInp.addEventListener('change', () => updateUnc({ aRelPct: Number(aInp.value) }));
  uncSec.appendChild(svField('ε<sub>A</sub> — Fläche (%)', aInp));

  const nInp = svNumInput(unc.nRelPct, 0, 50, 1);
  nInp.addEventListener('change', () => updateUnc({ nRelPct: Number(nInp.value) }));
  uncSec.appendChild(svField('ε<sub>n</sub> — Luftwechsel (%)', nInp));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function addSection(parent: HTMLElement, title: string): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'sv-section';
  const h = document.createElement('div');
  h.className = 'rp-section-title';
  h.textContent = title;
  sec.appendChild(h);
  parent.appendChild(sec);
  return sec;
}

function svField(
  label: string,
  control: HTMLElement,
  note?: Node,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'sv-field';
  const lbl = document.createElement('label');
  lbl.className = 'sv-label';
  lbl.innerHTML = label;
  row.appendChild(lbl);
  row.appendChild(control);
  if (note) {
    const nd = document.createElement('div');
    nd.className = 'sv-note';
    nd.appendChild(note);
    row.appendChild(nd);
  }
  return row;
}

function svInput(type: string, value: string, placeholder = ''): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.className = 'input sv-input';
  i.value = value;
  i.placeholder = placeholder;
  return i;
}

function svNumInput(value: number, min: number, max: number, step: number): HTMLInputElement {
  const i = svInput('number', isNaN(value) ? '' : String(value));
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  return i;
}
