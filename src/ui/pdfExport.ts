import { jsPDF } from 'jspdf';
import type { HeizlastResult, Project } from '../model/types.js';
import { getBoundaryCategoryLabel } from '../editor/adjacency.js';

export function exportPdf(project: Project, result: HeizlastResult): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const floor = project.floors[0];
  const roomMap = new Map(floor.rooms.map(r => [r.id, r]));

  let y = 15;
  const lm = 15; // left margin
  const pageW = 210;

  const newPage = () => {
    doc.addPage();
    y = 15;
  };

  const checkPage = (neededMm: number) => {
    if (y + neededMm > 280) newPage();
  };

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Heizlastberechnung nach DIN EN 12831', lm, y);
  y += 8;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Projekt: ${project.name}`, lm, y); y += 6;
  doc.text(`PLZ: ${result.plz}  |  θe: ${result.designTemperature}°C  |  Erstellt: ${new Date().toLocaleDateString('de-DE')}`, lm, y); y += 8;

  doc.setLineWidth(0.3);
  doc.line(lm, y, pageW - lm, y); y += 6;

  // Building summary
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Gebäudezusammenfassung', lm, y); y += 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Gesamtheizlast: ${Math.round(result.buildingTotal)} W  (${(result.buildingTotal / 1000).toFixed(2)} kW)`, lm, y); y += 5;
  doc.text(`Spezifische Heizlast: ${result.specificHeatLoad.toFixed(0)} W/m²`, lm, y); y += 8;

  // Per-room table
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Raumübersicht', lm, y); y += 6;

  const roomCols = ['Raum', 'Fl. (m²)', 'θint (°C)', 'ΦT (W)', 'ΦV (W)', 'ΦHL (W)'];
  const roomColW = [55, 22, 22, 25, 25, 25];
  drawTableHeader(doc, lm, y, roomCols, roomColW); y += 6;

  for (const rr of result.rooms) {
    checkPage(6);
    const room = roomMap.get(rr.roomId);
    const row = [
      room?.label ?? rr.roomId,
      room?.area?.toFixed(1) ?? '—',
      String(room?.designTemperature ?? ''),
      String(Math.round(rr.result.transmissionLoss)),
      String(Math.round(rr.result.ventilationLoss)),
      String(Math.round(rr.result.totalLoss)),
    ];
    drawTableRow(doc, lm, y, row, roomColW);
    y += 6;
  }
  y += 4;

  // Hull summary
  checkPage(20);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Hüllflächengruppen', lm, y); y += 6;

  const hullCols = ['Hülle', 'Kategorien', 'ΦT (W)', 'Anteil (%)'];
  const hullColW = [50, 75, 30, 25];
  drawTableHeader(doc, lm, y, hullCols, hullColW); y += 6;

  for (const he of result.hullSummary) {
    checkPage(6);
    const hull = project.hullGroups.find(h => h.id === he.hullId);
    const catStr = hull?.categories.map(c => getBoundaryCategoryLabel(c)).join(', ') ?? '';
    const row = [
      he.hullName,
      catStr,
      String(Math.round(he.totalTransmissionLoss)),
      `${(he.shareOfBuildingTotal * 100).toFixed(0)}%`,
    ];
    drawTableRow(doc, lm, y, row, hullColW);
    y += 6;
  }
  y += 4;

  // Element breakdown per room
  for (const rr of result.rooms) {
    checkPage(30);
    const room = roomMap.get(rr.roomId);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`${room?.label ?? rr.roomId} — Elementaufschlüsselung`, lm, y); y += 5;

    const elCols = ['Element', 'Kategorie', 'A (m²)', 'U', 'fij', 'ΔT (K)', 'ΦT (W)'];
    const elColW = [20, 35, 18, 16, 16, 18, 18];
    drawTableHeader(doc, lm, y, elCols, elColW); y += 5;

    for (const e of rr.result.elementBreakdown) {
      checkPage(5);
      const typeLabel = e.elementType === 'wall' ? 'Wand' :
        e.elementType === 'window' ? 'Fenster' :
        e.elementType === 'door' ? 'Tür' :
        e.elementType === 'garage_door' ? 'Tor' :
        e.elementType === 'floor' ? 'Boden' : 'Decke';
      const row = [
        typeLabel,
        getBoundaryCategoryLabel(e.boundaryCategory),
        e.area.toFixed(2),
        e.uValue.toFixed(2),
        e.fij.toFixed(3),
        e.actualDeltaT.toFixed(1),
        String(Math.round(e.heatLoss)),
      ];
      drawTableRow(doc, lm, y, row, elColW);
      y += 5;
    }
    y += 4;
  }

  // Footer note
  checkPage(15);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text('Hinweis: Wärmebrücken (Wärmebrückenzuschläge) sind in dieser Berechnung nicht enthalten.', lm, y); y += 4;
  doc.text('Berechnung nach vereinfachter Methode DIN EN 12831:2003.', lm, y);

  doc.save(`${project.name.replace(/\s+/g, '_')}_Heizlast.pdf`);
}

function drawTableHeader(doc: jsPDF, x: number, y: number, cols: string[], widths: number[]): void {
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  let cx = x;
  for (let i = 0; i < cols.length; i++) {
    doc.text(cols[i], cx, y);
    cx += widths[i];
  }
  doc.setLineWidth(0.2);
  doc.line(x, y + 1, x + widths.reduce((a, b) => a + b, 0), y + 1);
}

function drawTableRow(doc: jsPDF, x: number, y: number, cols: string[], widths: number[]): void {
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  let cx = x;
  for (let i = 0; i < cols.length; i++) {
    doc.text(String(cols[i]), cx, y);
    cx += widths[i];
  }
}
