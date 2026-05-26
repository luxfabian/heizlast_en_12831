import { jsPDF } from 'jspdf';
import type { HeizlastResult, Project } from '../model/types.js';
import { getBoundaryCategoryLabel } from '../editor/adjacency.js';

// ── Layout constants ──────────────────────────────────────────────────────────
const LM = 15, RM = 15;
const PW = 210 - LM - RM;       // printable width  = 180 mm
const PAGE_H = 297;
const BOTTOM_MARGIN = 282;       // leave 15 mm for footer

export function exportPdf(project: Project, result: HeizlastResult): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const floor = project.floors[0];
  const roomMap = new Map(floor.rooms.map(r => [r.id, r]));
  const totalArea = floor.rooms.reduce((s, r) => s + (r.area ?? 0), 0);
  const date = new Date().toLocaleDateString('de-DE');

  let y = 0;
  const needY = (mm: number) => { if (y + mm > BOTTOM_MARGIN) { doc.addPage(); y = 15; } };

  // ═══════════════════════════════════════════════════════════════════════════
  // COVER HEADER
  // ═══════════════════════════════════════════════════════════════════════════
  doc.setFillColor(20, 30, 50);
  doc.rect(0, 0, 210, 30, 'F');

  doc.setTextColor(225, 232, 245);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Heizlastberechnung nach DIN EN 12831', LM, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Projekt: ${project.name}   |   PLZ: ${result.plz || '—'}   |   Erstellt: ${date}`,
    LM, 21,
  );

  doc.setTextColor(0);
  y = 36;

  // ── Norm conditions bar ────────────────────────────────────────────────────
  doc.setFillColor(240, 243, 250);
  doc.rect(LM, y, PW, 14, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(50, 60, 90);
  doc.text('Normbedingungen', LM + 3, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(40);
  doc.text(
    `Norm-Aussentemperatur  Te = ${result.designTemperature} °C   |   ` +
    `Norm-Erdreichtemperatur  Tg = ${project.groundTemperature ?? 10} °C   |   ` +
    `Beheizte Flaeche  A = ${totalArea.toFixed(1)} m²`,
    LM + 3, y + 10,
  );
  doc.setTextColor(0);
  y += 20;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — BUILDING SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  sectionTitle(doc, LM, PW, y, '1   Gebaeude-Gesamtheizlast');
  y += 10;

  const bw = (PW - 6) / 3;
  const kw = (result.designHeatLoad / 1000).toFixed(2);
  const spec = result.designSpecificHeatLoad.toFixed(0);
  const eClass = energyClass(result.designSpecificHeatLoad);

  kpiBox(doc, LM,              y, bw, 'Gesamtheizlast Q_HL',
    `${kw} kW`,
    `${Math.round(result.designHeatLoad)} W gesamt`);
  kpiBox(doc, LM + bw + 3,     y, bw, 'Spez. Heizlast q_HL',
    `${spec} W/m²`,
    `bezogen auf ${totalArea.toFixed(0)} m² AN`);
  kpiBox(doc, LM + 2 * (bw+3), y, bw, 'Energieklasse',
    eClass,
    'nach Heizlastkennwert');
  y += 24;

  // ── Loss-by-category table ─────────────────────────────────────────────────
  needY(32);
  doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  doc.text('Verluste nach Kategorie', LM, y); y += 4;

  const { exterior, ground, adjNeighbor, ventilation } = result.lossByCategory;
  const catRows: [string, number][] = (
    [['Aussenluft / Unbeheizt', exterior],
     ['Erdreich (const. Tg)', ground],
     ['Nachbargebaeude', adjNeighbor],
     ['Lueftung', ventilation]] as [string, number][]
  ).filter(([, w]) => w > 0);

  tblHead(doc, LM, y, ['Kategorie', 'Q (W)', 'Anteil'], [100, 35, 25]); y += 6;
  for (const [lbl, w] of catRows) {
    needY(6); tblRow(doc, LM, y, [lbl, String(Math.round(w)), `${(w / result.designHeatLoad * 100).toFixed(0)} %`], [100, 35, 25]); y += 5;
  }
  needY(6); tblRow(doc, LM, y, ['Gesamt  Q_HL', String(Math.round(result.designHeatLoad)), '100 %'], [100, 35, 25], true); y += 10;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — ROOM OVERVIEW
  // ═══════════════════════════════════════════════════════════════════════════
  needY(32);
  sectionTitle(doc, LM, PW, y, '2   Raumuebersicht');
  y += 10;

  const rcw = [46, 18, 18, 22, 22, 24, 20] as const;
  tblHead(doc, LM, y, ['Raum', 'A (m²)', 'Ti (°C)', 'Q_T (W)', 'Q_V (W)', 'Q_HL (W)', 'q (W/m²)'], [...rcw]); y += 6;
  for (const rr of result.rooms) {
    needY(6);
    const room = roomMap.get(rr.roomId);
    const a = room?.area ?? 0;
    const q = a > 0 ? rr.result.totalLoss / a : 0;
    tblRow(doc, LM, y, [
      room?.label ?? '—',
      a.toFixed(1),
      String(room?.designTemperature ?? ''),
      String(Math.round(rr.result.transmissionLoss)),
      String(Math.round(rr.result.ventilationLoss)),
      String(Math.round(rr.result.totalLoss)),
      q.toFixed(0),
    ], [...rcw]); y += 5;
  }
  y += 8;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — ROOM DETAILS
  // ═══════════════════════════════════════════════════════════════════════════
  for (let ri = 0; ri < result.rooms.length; ri++) {
    const rr   = result.rooms[ri];
    const room = roomMap.get(rr.roomId);
    const a    = room?.area ?? 0;

    needY(30);
    sectionTitle(doc, LM, PW, y, `3.${ri + 1}   ${room?.label ?? rr.roomId}  —  Elementaufschluesselung`);
    y += 8;

    // Room meta row
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(50);
    doc.text(
      `Flaeche: ${a.toFixed(1)} m²   |   Ti = ${room?.designTemperature ?? '—'} °C   |   ` +
      `Q_HL = ${Math.round(rr.result.totalLoss)} W   |   Q_T = ${Math.round(rr.result.transmissionLoss)} W   |   Q_V = ${Math.round(rr.result.ventilationLoss)} W`,
      LM, y,
    );
    doc.setTextColor(0);
    y += 6;

    const ecw = [20, 42, 16, 22, 14, 16, 18] as const;
    tblHead(doc, LM, y, ['Typ', 'Kategorie', 'A (m²)', 'U (W/m²K)', 'f_ij', 'dT (K)', 'Q_T (W)'], [...ecw]); y += 6;

    for (const e of rr.result.elementBreakdown) {
      if (e.heatLoss < 0.5) continue;
      needY(5);
      const tl = e.elementType === 'wall'         ? 'Wand'    :
                 e.elementType === 'window'        ? 'Fenster' :
                 e.elementType === 'door'          ? 'Tuer'    :
                 e.elementType === 'garage_door'   ? 'Tor'     :
                 e.elementType === 'floor'         ? 'Boden'   : 'Decke';
      tblRow(doc, LM, y, [
        tl,
        getBoundaryCategoryLabel(e.boundaryCategory),
        e.area.toFixed(2),
        e.uValue.toFixed(3),
        e.fij.toFixed(3),
        e.actualDeltaT.toFixed(1),
        String(Math.round(e.heatLoss)),
      ], [...ecw]); y += 5;
    }
    needY(5);
    tblRow(doc, LM, y, ['Gesamt', '', '', '', '', 'Q_T:', String(Math.round(rr.result.transmissionLoss))], [...ecw], true);
    y += 12;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE FOOTER  (added after all content is placed)
  // ═══════════════════════════════════════════════════════════════════════════
  const np = (doc as unknown as { getNumberOfPages(): number }).getNumberOfPages();
  for (let p = 1; p <= np; p++) {
    doc.setPage(p);
    doc.setFillColor(20, 30, 50);
    doc.rect(0, PAGE_H - 8, 210, 8, 'F');
    doc.setTextColor(160, 170, 200);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(
      'Vereinfachte Methode DIN EN 12831:2003 — ohne Waermebrueckenzuschlaege',
      LM, PAGE_H - 2.5,
    );
    doc.text(`Seite ${p} / ${np}`, 210 - RM, PAGE_H - 2.5, { align: 'right' });
    doc.setTextColor(0);
  }

  doc.save(`${project.name.replace(/\s+/g, '_')}_Heizlast.pdf`);
}

// ── Visual helpers ─────────────────────────────────────────────────────────────

function sectionTitle(doc: jsPDF, lm: number, pw: number, y: number, title: string): void {
  doc.setFillColor(30, 42, 70);
  doc.rect(lm, y, pw, 8, 'F');
  doc.setTextColor(210, 222, 248);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(title, lm + 3, y + 5.5);
  doc.setTextColor(0);
}

function kpiBox(doc: jsPDF, x: number, y: number, w: number, label: string, value: string, sub: string): void {
  doc.setFillColor(242, 245, 252);
  doc.roundedRect(x, y, w, 20, 1.5, 1.5, 'F');
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
  doc.text(label, x + w / 2, y + 5, { align: 'center' });
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 32, 60);
  doc.text(value, x + w / 2, y + 13, { align: 'center' });
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(110);
  doc.text(sub, x + w / 2, y + 18, { align: 'center' });
  doc.setTextColor(0);
}

function tblHead(doc: jsPDF, x: number, y: number, cols: string[], widths: number[]): void {
  const totalW = widths.reduce((a, b) => a + b, 0);
  doc.setFillColor(220, 226, 242);
  doc.rect(x, y - 4, totalW, 6, 'F');
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(25, 35, 70);
  let cx = x + 1;
  for (let i = 0; i < cols.length; i++) {
    doc.text(cols[i], cx, y); cx += widths[i];
  }
  doc.setTextColor(0);
}

function tblRow(doc: jsPDF, x: number, y: number, cols: string[], widths: number[], bold = false): void {
  doc.setFontSize(8.5); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setTextColor(20);
  let cx = x + 1;
  for (let i = 0; i < cols.length; i++) {
    doc.text(String(cols[i]), cx, y); cx += widths[i];
  }
  doc.setDrawColor(210); doc.setLineWidth(0.1);
  doc.line(x, y + 1.5, x + widths.reduce((a, b) => a + b, 0), y + 1.5);
  doc.setTextColor(0); doc.setDrawColor(0);
}

function energyClass(wPerM2: number): string {
  if (wPerM2 < 10)  return 'A+++';
  if (wPerM2 < 20)  return 'A++';
  if (wPerM2 < 35)  return 'A+';
  if (wPerM2 < 50)  return 'A';
  if (wPerM2 < 75)  return 'B';
  if (wPerM2 < 100) return 'C';
  if (wPerM2 < 125) return 'D';
  if (wPerM2 < 160) return 'E';
  return 'F';
}
