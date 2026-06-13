import { jsPDF } from 'jspdf';
import type { HeizlastResult, Project, Room } from '../model/types.js';
import { getBoundaryCategoryLabel } from '../editor/adjacency.js';

// ── Layout constants ──────────────────────────────────────────────────────────
const LM = 15, RM = 15;
const PW = 210 - LM - RM;       // printable width = 180 mm
const PAGE_H = 297;
const BOTTOM_MARGIN = 282;       // 15 mm footer reserve

export function exportPdf(project: Project, result: HeizlastResult): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const allRooms = project.floors.flatMap(f => f.rooms);
  const roomMap = new Map(allRooms.map(r => [r.id, r]));
  const totalArea = allRooms.reduce((s, r) => s + (r.area ?? 0), 0);
  const date = new Date().toLocaleDateString('de-DE');

  let y = 0;
  let sankeyPageNum = 0;
  const needY = (mm: number) => { if (y + mm > BOTTOM_MARGIN) { doc.addPage('a4', 'p'); y = 15; } };

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
  richText(doc,
    `Norm-Außentemperatur  T_{e} = ${result.designTemperature} °C   |   ` +
    `Norm-Erdreichtemperatur  T_{g} = ${project.groundTemperature ?? 10} °C   |   ` +
    `Beheizte Fläche  A = ${totalArea.toFixed(1)} m²`,
    LM + 3, y + 10, 8);
  doc.setTextColor(0);
  y += 20;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — BUILDING SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  sectionTitle(doc, LM, PW, y, '1   Gebäude-Gesamtheizlast');
  y += 12;

  const bw = (PW - 6) / 3;
  const kw = (result.designHeatLoad / 1000).toFixed(2);
  const spec = result.designSpecificHeatLoad.toFixed(0);
  const eClass = energyClass(result.designSpecificHeatLoad);

  kpiBox(doc, LM,              y, bw, 'Gesamtheizlast Q_{HL}',
    `${kw} kW`,
    `${Math.round(result.designHeatLoad)} W gesamt`);
  kpiBox(doc, LM + bw + 3,     y, bw, 'Spez. Heizlast q_{HL}',
    `${spec} W/m²`,
    `bezogen auf ${totalArea.toFixed(0)} m² AN`);
  kpiBox(doc, LM + 2 * (bw+3), y, bw, 'Energieklasse',
    eClass,
    'nach Heizlastkennwert');
  y += 26;

  // ── Loss-by-category table ─────────────────────────────────────────────────
  needY(32);
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(40);
  doc.text('Verluste nach Kategorie', LM, y);
  y += 4;

  const { exterior, ground, adjNeighbor, ventilation } = result.lossByCategory;
  const catRows: [string, number][] = (
    [['Außenluft / Unbeheizt',  exterior],
     ['Erdreich (const. T_{g})', ground],
     ['Nachbargebäude',          adjNeighbor],
     ['Lüftung',                 ventilation]] as [string, number][]
  ).filter(([, w]) => w > 0);

  // Loss table: widths sum to 180 mm
  const lossW = [112, 40, 28] as const;
  tblHead(doc, LM, y, ['Kategorie', 'Q (W)', 'Anteil'], [...lossW]);
  y += 6;
  for (const [lbl, w] of catRows) {
    needY(6);
    tblRow(doc, LM, y, [lbl, String(Math.round(w)), `${(w / result.designHeatLoad * 100).toFixed(0)} %`], [...lossW]);
    y += 5;
  }
  needY(6);
  tblRow(doc, LM, y, ['Gesamt  Q_{HL}', String(Math.round(result.designHeatLoad)), '100 %'], [...lossW], true);
  y += 12;

  // ── Hull group summary ────────────────────────────────────────────────────
  if (result.hullSummary.length > 0) {
    needY(6 + result.hullSummary.length * 5 + 10);
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(40);
    doc.text('Hüllflächengruppen', LM, y);
    y += 4;
    const hw = [82, 30, 40, 28] as const;
    tblHead(doc, LM, y, ['Hüllgruppe', 'A (m²)', 'Q_{T} (W)', 'Anteil'], [...hw]);
    y += 6;
    for (const he of result.hullSummary) {
      needY(5);
      tblRow(doc, LM, y, [
        he.hullName,
        he.totalArea.toFixed(1),
        String(Math.round(he.totalTransmissionLoss)),
        `${(he.shareOfBuildingTotal * 100).toFixed(0)} %`,
      ], [...hw]);
      y += 5;
    }
    y += 8;
  }

  // ── Definitions note ───────────────────────────────────────────────────────
  needY(43);
  doc.setFillColor(245, 247, 252);
  doc.rect(LM, y, PW, 38, 'F');
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(40, 50, 80);
  doc.text('Definitionen', LM + 3, y + 5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(50);
  const defLines = [
    'Q_{HL} (Raum):    Heizlast Raum für Heizkörperauslegung = Q_{T} (alle Hüllflächen) + Q_{V}. Summe aller Räume kann > Gebäude-Q_{HL} sein.',
    'Q_{HL} (Gebäude): Norm-Heizlast Gebäude = Q_{T,HL} + Q_{V}. Interne adj.-beheizt-Verluste heben sich auf Gebäudeebene auf.',
    'Q_{T,HL}:         Heizlast-relevante Transmission — nur Außenluft, Erdreich, Nachbargebäude, Unbeheizt (keine adj. beheizten Räume).',
    'Q_{T}:            Transmission alle Hüllflächen — inkl. Verluste zu adj. beheizten und adj. reduzierten Räumen.',
    'Q_{V}:            Lüftungswärmeverlust = 0,34 × V × n_{min} × ΔT_{norm}',
  ];
  let dly = y + 11; for (const ln of defLines) { richText(doc, ln, LM + 3, dly, 7); dly += 5; }
  doc.setTextColor(0);
  y += 43;

  // ── Sankey — dedicated landscape page ──────────────────────────────────────
  doc.addPage('a4', 'l');
  sankeyPageNum = (doc as unknown as { getNumberOfPages(): number }).getNumberOfPages();
  const PW_L = 267; // 297 - LM - RM on landscape A4
  y = 15;
  sectionTitle(doc, LM, PW_L, y, '2   Heizlastverteilung (Sankey)');
  y += 12;
  drawSankey(doc, result, roomMap, LM, y, PW_L, 155);
  y += 167;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — ROOM OVERVIEW
  // ═══════════════════════════════════════════════════════════════════════════
  doc.addPage('a4', 'p');
  y = 15;
  sectionTitle(doc, LM, PW, y, '3   Raumübersicht');
  y += 12;

  // Room overview: Q_T = all-surface transmission (for radiator sizing).
  // Q_{HL} = Q_T + Q_V = totalLoss — the correct per-room design heat load per DIN EN 12831.
  // Note: Σ Q_{HL,Raum} ≥ building designHeatLoad because adj_heated losses cancel at building level.
  const rcw = [49, 19, 19, 23, 23, 25, 22] as const;
  tblHead(doc, LM, y, ['Raum', 'A (m²)', 'T_{i} (°C)', 'Q_{T} (W)', 'Q_{V} (W)', 'Q_{HL} (W)', 'q (W/m²)'], [...rcw]);
  y += 6;
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
    ], [...rcw]);
    y += 5;
  }
  y += 8;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — ROOM DETAILS (each room on its own page)
  // ═══════════════════════════════════════════════════════════════════════════

  // Element breakdown: widths sum to 180 mm
  const ecw = [20, 45, 20, 15, 25, 14, 18, 23] as const;

  for (let ri = 0; ri < result.rooms.length; ri++) {
    const rr   = result.rooms[ri];
    const room = roomMap.get(rr.roomId);
    const a    = room?.area ?? 0;
    const ti   = room?.designTemperature ?? 20;

    // Q_{T,HL}: heizlast-relevant transmission (exterior+ground+neighbor+unheated) — used in subtotal row
    const extTrans = rr.result.elementBreakdown
      .filter(e => e.boundaryCategory === 'exterior' || e.boundaryCategory === 'unheated' ||
                   e.boundaryCategory === 'ground'   || e.boundaryCategory === 'adj_neighbor')
      .reduce((s, e) => s + e.heatLoss, 0);

    doc.addPage('a4', 'p');
    y = 15;

    sectionTitle(doc, LM, PW, y, `4.${ri + 1}   ${room?.label ?? rr.roomId}  —  Elementaufschlüsselung`);
    y += 12;

    // Room meta — two lines so volume/air-change info fits
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(50);
    richText(doc,
      `Fläche: ${a.toFixed(1)} m²   |   T_{i} = ${ti} °C   |   ` +
      `V = ${rr.result.volume.toFixed(1)} m³   |   n_{min} = ${rr.result.nMin.toFixed(2)} 1/h`,
      LM, y, 8);
    y += 5;
    richText(doc,
      `Q_{HL} = ${Math.round(rr.result.totalLoss)} W   |   ` +
      `Q_{T,HL} = ${Math.round(extTrans)} W   |   ` +
      `Q_{T} = ${Math.round(rr.result.transmissionLoss)} W   |   ` +
      `Q_{V} = ${Math.round(rr.result.ventilationLoss)} W`,
      LM, y, 8);
    doc.setTextColor(0);
    y += 8;

    tblHead(doc, LM, y,
      ['Typ', 'Kategorie', 'T_{adj} (°C)', 'A (m²)', 'U (W/m²K)', 'f_{ij}', 'ΔT (K)', 'Q_{T} (W)'],
      [...ecw]);
    y += 6;

    for (const e of rr.result.elementBreakdown) {
      if (e.heatLoss < 0.5) continue;
      needY(5);
      const tl = e.elementType === 'wall'       ? 'Wand'    :
                 e.elementType === 'window'      ? 'Fenster' :
                 e.elementType === 'door'        ? 'Tür'     :
                 e.elementType === 'garage_door' ? 'Tor'     :
                 e.elementType === 'floor'       ? 'Boden'   : 'Decke';
      const tadj = (ti - e.actualDeltaT).toFixed(0);
      tblRow(doc, LM, y, [
        tl,
        getBoundaryCategoryLabel(e.boundaryCategory),
        tadj,
        e.area.toFixed(2),
        e.uValue.toFixed(3),
        e.fij.toFixed(3),
        e.actualDeltaT.toFixed(1),
        String(Math.round(e.heatLoss)),
      ], [...ecw]);
      y += 5;
    }
    // Two-tier totals: Q_{T,HL} (heizlast-relevant, matches Q_{HL} in overview) vs Q_{T} (all surfaces)
    needY(5);
    tblRow(doc, LM, y,
      ['', 'Außen / Boden / Nachbar', '', '', '', '', 'Q_{T,HL}:', String(Math.round(extTrans))],
      [...ecw]);
    y += 5;
    needY(5);
    tblRow(doc, LM, y,
      ['Gesamt', 'alle Hüllflächen', '', '', '', '', 'Q_{T}:', String(Math.round(rr.result.transmissionLoss))],
      [...ecw], true);
    y += 12;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYMBOL TABLE
  // ═══════════════════════════════════════════════════════════════════════════
  doc.addPage('a4', 'p');
  y = 15;
  sectionTitle(doc, LM, PW, y, 'Symbolverzeichnis');
  y += 12;

  const symW = [28, 118, 34] as const;
  tblHead(doc, LM, y, ['Symbol', 'Bedeutung', 'Einheit'], [...symW]);
  y += 6;

  const symbols: [string, string, string][] = [
    ['Q_{HL,Raum}',  'Heizlast Raum für Heizkörperauslegung = Q_{T} (alle Hüll.) + Q_{V}',    'W'],
    ['Q_{HL,Geb}',   'Norm-Heizlast Gebäude = Q_{T,HL} + Q_{V} (adj.-beheizt-Verluste kürzen sich heraus)', 'W'],
    ['Q_{T,HL}',     'Heizlast-relevante Transmission: nur Außen, Erdreich, Nachbargebäude, Unbeheizt',      'W'],
    ['Q_{T}',        'Transmissionswärmeverlust alle Hüllflächen (inkl. adj. beheizt/reduziert)',             'W'],
    ['Q_{V}',        'Lüftungswärmeverlust',                                                                 'W'],
    ['q_{HL}',  'Spezifische Heizlast, bezogen auf beheizte Fläche',                         'W/m²'],
    ['U',       'Wärmedurchgangskoeffizient',                                                  'W/(m²K)'],
    ['A',       'Bauteilfläche (netto, nach Ecküberlappungskorrektur)',                        'm²'],
    ['f_{ij}',  'Temperaturkorrekturfaktor nach DIN EN 12831',                                '-'],
    ['ΔT',      'Effektive Temperaturdiff.,  ΔT = f_{ij} × (T_{i} - T_{e})',             'K'],
    ['T_{i}',   'Norm-Innentemperatur des betrachteten Raumes',                               '°C'],
    ['T_{e}',   'Norm-Außentemperatur (aus PLZ-Klimazone oder manuell)',                      '°C'],
    ['T_{g}',   'Norm-Erdreichtemperatur',                                                    '°C'],
    ['T_{adj}', 'Temperatur des angrenzenden Raums / Bereichs',                              '°C'],
    ['T_{u}',   'Temperatur unbeheizter Räume (Ansatz: 0 °C, falls nicht angegeben)',   '°C'],
    ['V',       'Raumvolumen (Grundfläche × Raumhöhe, oder manuell)',                  'm³'],
    ['n',       'Mindestluftwechselrate',                                                     '1/h'],
  ];

  for (const [sym, desc, unit] of symbols) {
    needY(5);
    tblRow(doc, LM, y, [sym, desc, unit], [...symW]);
    y += 5;
  }

  y += 10;
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
  doc.text(
    'Berechnung nach vereinfachter Methode DIN EN 12831:2003. ' +
    'Wärmebrückenzuschläge und solare/interne Gewinne sind nicht berücksichtigt.',
    LM, y,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE FOOTER (applied retroactively to all pages)
  // ═══════════════════════════════════════════════════════════════════════════
  const np = (doc as unknown as { getNumberOfPages(): number }).getNumberOfPages();
  for (let p = 1; p <= np; p++) {
    doc.setPage(p);
    const isLandscape = p === sankeyPageNum;
    const pH = isLandscape ? 210 : PAGE_H;  // physical page height (landscape A4 = 210 mm)
    const pW = isLandscape ? 297 : 210;     // physical page width
    doc.setFillColor(20, 30, 50);
    doc.rect(0, pH - 8, pW, 8, 'F');
    doc.setTextColor(160, 170, 200);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(
      'Vereinfachte Methode DIN EN 12831:2003 — ohne Wärmebrückenzuschläge',
      LM, pH - 2.5,
    );
    doc.text(`Seite ${p} / ${np}`, pW - RM, pH - 2.5, { align: 'right' });
    doc.setTextColor(0);
  }

  doc.save(`${project.name.replace(/\s+/g, '_')}_Heizlast.pdf`);
}

// ── Rich text renderer (supports _{subscript} markup and Δ via Symbol font) ───
//
// Markup: _{...} for subscripts; literal Δ (U+0394) for Greek delta.
// Δ is rendered by switching to the PDF built-in Symbol font (where 'D' = Δ glyph)
// and back, so no custom font embedding is required.
// Caller must set font family/style before calling; they are preserved on return.
// Returns width consumed (mm). Pass measure=true to measure without rendering.

function richText(doc: jsPDF, text: string, x: number, y: number, size: number, measure = false): number {
  const DELTA     = 'Δ';
  const subSize   = size * 0.63;
  const subOffset = size * 0.20;
  let cx        = x;
  let remaining = text;

  // Capture caller's font so we can restore after Symbol switches
  const { fontName, fontStyle } = doc.getFont();
  const useBase = () => { doc.setFont(fontName, fontStyle); doc.setFontSize(size); };
  const useSub  = () => { doc.setFont(fontName, fontStyle); doc.setFontSize(subSize); };
  const useSym  = () => { doc.setFont('symbol', 'normal'); doc.setFontSize(size); };

  while (remaining.length > 0) {
    const subPos   = remaining.indexOf('_{');
    const deltaPos = remaining.indexOf(DELTA);

    // Find the earliest special marker
    let nextPos = -1;
    let nextType: 'sub' | 'delta' = 'sub';
    if (subPos !== -1 && (deltaPos === -1 || subPos <= deltaPos)) {
      nextPos = subPos; nextType = 'sub';
    } else if (deltaPos !== -1) {
      nextPos = deltaPos; nextType = 'delta';
    }

    if (nextPos === -1) {
      useBase();
      if (!measure) doc.text(remaining, cx, y);
      cx += doc.getTextWidth(remaining);
      break;
    }

    // Render plain text before the marker
    if (nextPos > 0) {
      useBase();
      const before = remaining.substring(0, nextPos);
      if (!measure) doc.text(before, cx, y);
      cx += doc.getTextWidth(before);
    }

    if (nextType === 'sub') {
      const end = remaining.indexOf('}', nextPos + 2);
      if (end === -1) break;
      const sub = remaining.substring(nextPos + 2, end);
      useSub();
      if (!measure) doc.text(sub, cx, y + subOffset);
      cx += doc.getTextWidth(sub);
      remaining = remaining.substring(end + 1);
    } else {
      // Δ: in the PDF standard Symbol encoding, 'D' (0x44) maps to the Delta glyph
      useSym();
      if (!measure) doc.text('D', cx, y);
      cx += doc.getTextWidth('D');
      remaining = remaining.substring(nextPos + 1);
    }
  }

  doc.setFont(fontName, fontStyle);
  doc.setFontSize(size);
  return cx - x;
}

// ── Sankey chart ───────────────────────────────────────────────────────────────

function drawSankey(
  doc: jsPDF,
  result: HeizlastResult,
  roomMap: Map<string, Room>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const BAR_W    = 12;
  const LABEL_W  = 32;
  const RLABEL_W = 36;
  const GAP      = 2;
  const total    = result.designHeatLoad;
  if (total <= 0) return;

  const LBX = x + LABEL_W;
  const RBX = x + w - BAR_W - RLABEL_W;

  type CatNode = { key: string; label: string; value: number; r: number; g: number; b: number };
  const cats: CatNode[] = [];
  const { exterior, ground, adjNeighbor, ventilation } = result.lossByCategory;
  if (exterior    > 0) cats.push({ key: 'exterior',    label: 'Außenluft',   value: exterior,    r: 70,  g: 130, b: 210 });
  if (ground      > 0) cats.push({ key: 'ground',      label: 'Erdreich',    value: ground,      r: 100, g: 165, b: 75  });
  if (adjNeighbor > 0) cats.push({ key: 'neighbor',    label: 'Nachbargeb.', value: adjNeighbor, r: 210, g: 140, b: 40  });
  if (ventilation > 0) cats.push({ key: 'ventilation', label: 'Lüftung',     value: ventilation, r: 155, g: 90,  b: 210 });

  // Per-room flow broken down by category — mirrors main app getRoomFlow.
  // Only counts designHeatLoad categories (adj_heated excluded) so both sides balance.
  const getRoomFlow = (rr: HeizlastResult['rooms'][0], key: string): number => {
    const eb = rr.result.elementBreakdown;
    if (key === 'exterior')    return eb.filter(e => e.boundaryCategory === 'exterior' || e.boundaryCategory === 'unheated').reduce((s, e) => s + e.heatLoss, 0);
    if (key === 'ground')      return eb.filter(e => e.boundaryCategory === 'ground').reduce((s, e) => s + e.heatLoss, 0);
    if (key === 'neighbor')    return eb.filter(e => e.boundaryCategory === 'adj_neighbor').reduce((s, e) => s + e.heatLoss, 0);
    return rr.result.ventilationLoss;
  };

  const rooms = result.rooms
    .map(rr => ({
      rr,
      room:  roomMap.get(rr.roomId),
      flows: Object.fromEntries(cats.map(c => [c.key, getRoomFlow(rr, c.key)])),
      total: cats.reduce((s, c) => s + getRoomFlow(rr, c.key), 0),
    }))
    .filter(r => r.total > 0);

  if (cats.length === 0 || rooms.length === 0) return;

  // Single mm-per-watt scale: pick the tighter side so both left and right fit in h.
  const catAvailH  = h - (cats.length  - 1) * GAP;
  const roomAvailH = h - (rooms.length - 1) * GAP;
  const mmPerW = Math.min(catAvailH / total, roomAvailH / total);
  const barH   = (flow: number) => Math.max(0.5, flow * mmPerW);

  const catBarH  = cats.map(c  => barH(c.value));
  const roomBarH = rooms.map(r => barH(r.total));

  const catY  = bandStarts(catBarH,  GAP, y);
  const roomY = bandStarts(roomBarH, GAP, y);

  // 1. Ribbons (behind bars) — each ribbon has identical height on both ends
  const lx  = LBX + BAR_W;
  const rx  = RBX;
  const dx  = rx - lx;
  const cpO = dx * 0.45;

  const catBandY  = [...catY];
  const roomBandY = [...roomY];

  for (let ci = 0; ci < cats.length; ci++) {
    const cat = cats[ci];
    doc.setFillColor(
      Math.round(cat.r * 0.3 + 255 * 0.7),
      Math.round(cat.g * 0.3 + 255 * 0.7),
      Math.round(cat.b * 0.3 + 255 * 0.7),
    );
    for (let ri = 0; ri < rooms.length; ri++) {
      const flow = rooms[ri].flows[cat.key] ?? 0;
      const fh   = flow * mmPerW;
      const ly1  = catBandY[ci];
      const ry1  = roomBandY[ri];
      catBandY[ci]  += fh;  // advance cursor regardless so bars are exactly filled
      roomBandY[ri] += fh;
      if (fh < 0.05) continue; // skip invisible ribbons after advancing
      const dyT = ry1 - ly1;
      doc.lines(
        [
          [ cpO, 0, dx  - cpO,  dyT, dx,  dyT],
          [0, fh],
          [-cpO, 0, -(dx - cpO), -dyT, -dx, -dyT],
        ],
        lx, ly1, [1, 1], 'F', true,
      );
    }
  }

  // 2. Bars on top
  for (let ci = 0; ci < cats.length; ci++) {
    const { r, g, b } = cats[ci];
    doc.setFillColor(r, g, b);
    doc.rect(LBX, catY[ci], BAR_W, catBarH[ci], 'F');
  }
  for (let ri = 0; ri < rooms.length; ri++) {
    const t = rooms[ri].total / total;
    doc.setFillColor(Math.round(55 + t * 185), Math.round(120 - t * 80), Math.round(210 - t * 175));
    doc.rect(RBX, roomY[ri], BAR_W, roomBarH[ri], 'F');
  }

  // 3. Labels — left nodes, single inline line (right-to-left measurement)
  for (let ci = 0; ci < cats.length; ci++) {
    const { label, value, r, g, b } = cats[ci];
    const midY = catY[ci] + catBarH[ci] / 2;
    const pct  = `${(value / total * 100).toFixed(0)} %`;
    const wStr = `${Math.round(value)} W`;

    // Percentage — rightmost, light gray
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.0); doc.setTextColor(130, 130, 130);
    doc.text(pct, LBX - 2, midY, { align: 'right' });
    const pctW = doc.getTextWidth(pct);

    // W value — bold, dark gray
    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5); doc.setTextColor(60, 60, 60);
    doc.text(wStr, LBX - 2 - pctW - 1.5, midY, { align: 'right' });
    const wW = doc.getTextWidth(wStr);

    // Category name — bold, category colour
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.0); doc.setTextColor(r, g, b);
    doc.text(label, LBX - 2 - pctW - 1.5 - wW - 1.5, midY, { align: 'right' });
  }

  // 3. Labels — right nodes (room name · W value · %)
  const labelX = RBX + BAR_W + 2;
  for (let ri = 0; ri < rooms.length; ri++) {
    const { rr, room } = rooms[ri];
    const midY = roomY[ri] + roomBarH[ri] / 2;
    const name = (room?.label ?? rr.roomId).substring(0, 13);
    const wStr = `${Math.round(rooms[ri].total)} W`;
    const pStr = `${(rooms[ri].total / total * 100).toFixed(0)} %`;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(50, 50, 50);
    doc.text(name, labelX, midY);
    const nameW = doc.getTextWidth(name);

    doc.setFont('helvetica', 'bold');   doc.setFontSize(5.5); doc.setTextColor(15, 15, 15);
    doc.text(wStr, labelX + nameW + 1.5, midY);
    const wW = doc.getTextWidth(wStr);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.0); doc.setTextColor(130, 130, 130);
    doc.text(pStr, labelX + nameW + 1.5 + wW + 1.5, midY);
  }

  doc.setTextColor(0); doc.setDrawColor(0); doc.setFillColor(0, 0, 0);
}

function bandStarts(heights: number[], gap: number, y0: number): number[] {
  const starts: number[] = [];
  let cur = y0;
  for (const h of heights) { starts.push(cur); cur += h + gap; }
  return starts;
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

  // Label — centered, may contain subscript markup
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
  const labelW = richText(doc, label, 0, 0, 7.5, true); // measure only
  richText(doc, label, x + (w - labelW) / 2, y + 5, 7.5);

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
  doc.setFont('helvetica', 'bold'); doc.setTextColor(25, 35, 70);
  let cx = x + 1;
  for (let i = 0; i < cols.length; i++) {
    richText(doc, cols[i], cx, y, 8);
    cx += widths[i];
  }
  doc.setTextColor(0);
  doc.setFontSize(8);
}

function tblRow(doc: jsPDF, x: number, y: number, cols: string[], widths: number[], bold = false): void {
  doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setTextColor(20);
  let cx = x + 1;
  for (let i = 0; i < cols.length; i++) {
    richText(doc, String(cols[i]), cx, y, 8.5);
    cx += widths[i];
  }
  doc.setDrawColor(210); doc.setLineWidth(0.1);
  doc.line(x, y + 1.5, x + widths.reduce((a, b) => a + b, 0), y + 1.5);
  doc.setTextColor(0); doc.setDrawColor(0);
  doc.setFontSize(8.5);
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
