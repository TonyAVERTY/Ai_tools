// Documents de facturation en PDF : devis, acompte, facture finale, avoir. Les textes viennent du contenu validé (rédigé avec Claude), les mentions légales
// et les chiffres du code (legalMentions, documentFacts). Sans valeurs d'émission, les variables restent en `{{variable}}` (modèle) ; avec, c'est un vrai document.
import { Pdf, A4 } from './pdf.js';
import { legalMentions, documentFacts, DOC_BY_KEY } from './billing.js';
import { fmtEur } from './accounting.js';

const M = 50; // marge
const W = A4.w - 2 * M;
const BOTTOM = A4.h - 70;
const THEMES = {
  classique: { serif: true, accent: '#1c1c1c', head: '#1c1c1c', tint: null, rule: 1.6, title: 24, spacing: 0 },
  moderne: { serif: false, accent: '#1d4ed8', head: '#1d4ed8', tint: '#eef2ff', rule: 3, title: 22, spacing: 0 },
  epure: { serif: false, accent: '#444444', head: '#444444', tint: null, rule: 0.6, title: 18, spacing: 1.6 },
};

const eur = (c) => fmtEur(c);
const frDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

/** Variables d'un document : la valeur donnée, sinon le repère `{{nom}}`. */
export function filler(values = {}) {
  return (name, fmt = (v) => v) => (name in values ? fmt(values[name]) : `{{${name}}}`);
}

/**
 * @param {{ kind: string, content: object, legal: object, layout?: string, values?: object }} d
 * @returns {Buffer} le PDF
 */
export function renderDocumentPdf({ kind, content, legal, layout = 'classique', values = {} }) {
  const th = THEMES[layout] || THEMES.classique;
  const c = content;
  const f = documentFacts({ kind, content: c, legal });
  const v = filler(values);
  const doc = new Pdf({ serif: th.serif, title: `${c.title}${values.numero ? ` ${values.numero}` : ''}`, author: legal.legal_name });
  let y = M;

  const ensure = (h) => { if (y + h > BOTTOM) { doc.newPage(); y = M; } };
  const paragraphs = (str, { size = 10, bold = false, color = '#222222', gap = 6, x = M, w = W } = {}) => {
    for (const para of String(str || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
      for (const ln of doc.wrap(para, w, size, bold)) { ensure(size + 3); doc.text(x, y + size, ln, { size, bold, color }); y += size + 3.2; }
      y += gap;
    }
  };
  const heading = (str) => { ensure(30); y += 4; doc.text(M, y + 11, str, { size: 11, bold: true, color: th.head }); y += 18; };

  // ---- En-tête : l'éditeur à gauche, le titre et les références à droite
  const left = [legal.legal_name, legal.address, `${legal.postal_code} ${legal.city}`.trim(), [legal.email, legal.phone, legal.website].filter(Boolean).join('  ·  ')].filter(Boolean);
  const meta = {
    devis: [`Devis n° ${v('numero')}`, `Date : ${v('date', frDate)}`, `Valable jusqu'au ${v('date_validite', frDate)}`],
    acompte: [`Facture d'acompte n° ${v('numero')}`, `Date : ${v('date', frDate)}`, `Échéance : ${v('date_echeance', frDate)}`],
    facture: [`Facture n° ${v('numero')}`, `Date : ${v('date', frDate)}`, `Échéance : ${v('date_echeance', frDate)}`, `Prestation réalisée le ${v('date_prestation', frDate)}`],
    avoir: [`Avoir n° ${v('numero')}`, `Date : ${v('date', frDate)}`, `Sur la facture n° ${v('facture_numero')}`],
  }[kind] || [];
  let ly = y + 12;
  left.forEach((ln, i) => { doc.text(M, ly, ln, { size: i === 0 ? 13 : 9.5, bold: i === 0, color: i > 2 ? '#666666' : '#1c1c1c' }); ly += i === 0 ? 17 : 13; });
  doc.text(M + W, y + th.title, c.title, { size: th.title, bold: layout !== 'epure', color: th.head, align: 'right', spacing: th.spacing });
  let ry = y + th.title + 20;
  meta.forEach((ln) => { doc.text(M + W, ry, ln, { size: 9.5, align: 'right' }); ry += 13; });
  y = Math.max(ly, ry) + 8;
  doc.line(M, y, M + W, y, { width: th.rule, color: th.accent });
  y += 16;

  // ---- Client
  const boxW = 230;
  const clientLines = [v('client_nom'), v('client_adresse'), v('client_siret') === '' ? '' : `SIRET : ${v('client_siret')}`];
  const addrLines = doc.wrap(clientLines[1], boxW - 20, 9.5);
  const boxH = 18 + 14 + addrLines.length * 13 + (clientLines[2] ? 13 : 0) + 8;
  doc.rect(M + W - boxW, y, boxW, boxH, { fill: th.tint, stroke: layout === 'moderne' ? '#c7d2fe' : '#999999', width: 0.6 });
  doc.text(M + W - boxW + 10, y + 15, 'Client', { size: 9.5, bold: true });
  let cy = y + 29;
  doc.text(M + W - boxW + 10, cy, clientLines[0], { size: 10, bold: true }); cy += 14;
  for (const ln of addrLines) { doc.text(M + W - boxW + 10, cy, ln, { size: 9.5 }); cy += 13; }
  if (clientLines[2]) doc.text(M + W - boxW + 10, cy, clientLines[2], { size: 9.5 });
  y += boxH + 16;

  // ---- Introduction
  paragraphs(c.intro);

  // ---- Tableau des lignes
  const cols = { qty: M + W - 195, unit: M + W - 105, total: M + W };
  const labelW = cols.qty - M - 62;
  const head = () => {
    if (th.tint) doc.rect(M, y, W, 20, { fill: th.tint });
    doc.text(M + 6, y + 14, 'Désignation', { size: 9, bold: true, color: th.head });
    doc.text(cols.qty, y + 14, 'Quantité', { size: 9, bold: true, color: th.head, align: 'right' });
    doc.text(cols.unit, y + 14, 'Prix unitaire HT', { size: 9, bold: true, color: th.head, align: 'right' });
    doc.text(cols.total - 6, y + 14, 'Total HT', { size: 9, bold: true, color: th.head, align: 'right' });
    doc.line(M, y + 20, M + W, y + 20, { width: layout === 'classique' ? 1.2 : 0.6, color: th.accent });
    y += 26;
  };
  ensure(60); head();
  for (const r of f.rows) {
    const lab = doc.wrap(r.label, labelW, 10, true);
    const desc = r.description ? doc.wrap(r.description, labelW, 8.5) : [];
    const h = lab.length * 13 + desc.length * 11.5 + 12;
    if (y + h > BOTTOM) { doc.newPage(); y = M; head(); }
    let ty = y + 11;
    for (const ln of lab) { doc.text(M + 6, ty, ln, { size: 10, bold: true }); ty += 13; }
    for (const ln of desc) { doc.text(M + 6, ty - 1, ln, { size: 8.5, color: '#666666' }); ty += 11.5; }
    doc.text(cols.qty, y + 11, r.qty, { size: 10, align: 'right' });
    doc.text(cols.unit, y + 11, eur(r.unit), { size: 10, align: 'right' });
    doc.text(cols.total - 6, y + 11, eur(r.total), { size: 10, align: 'right' });
    y += h;
    doc.line(M, y - 4, M + W, y - 4, { width: 0.4, color: '#cccccc' });
  }
  y += 4;

  // ---- Totaux
  const totW = 240;
  const tx = M + W - totW;
  for (const [label, cents, strong] of f.totals) {
    if (cents === null) continue;
    ensure(24);
    if (strong) { doc.line(tx, y, M + W, y, { width: 0.8, color: th.accent }); y += 4; }
    doc.text(tx + 6, y + 12, label, { size: strong ? 11 : 10, bold: !!strong });
    doc.text(M + W - 6, y + 12, eur(cents), { size: strong ? 11 : 10, bold: !!strong, align: 'right' });
    y += 18;
  }
  if (!f.assujetti) { ensure(16); doc.text(M + W - 6, y + 10, f.vatLabel, { size: 8.5, color: '#666666', align: 'right' }); y += 16; }
  y += 8;

  if (kind === 'avoir') {
    const reason = c.reason || v('motif');
    const lines = doc.wrap(`Motif de l'avoir : ${reason}`, W - 20, 10);
    ensure(lines.length * 13 + 16);
    doc.rect(M, y, W, lines.length * 13 + 12, { stroke: '#999999', width: 0.6 });
    lines.forEach((ln, i) => doc.text(M + 10, y + 16 + i * 13, ln, { size: 10 }));
    y += lines.length * 13 + 22;
  }
  if (kind !== 'avoir' && c.conditions) { heading('Conditions'); paragraphs(c.conditions); }
  if (kind !== 'avoir' && c.payment) { heading('Modalités de paiement'); paragraphs(c.payment); }
  if ((kind === 'acompte' || kind === 'facture') && legal.iban) {
    paragraphs(`Règlement par virement : IBAN ${legal.iban.replace(/(.{4})/g, '$1 ').trim()}${legal.bic ? ` — BIC ${legal.bic}` : ''}`, { size: 9.5, bold: false });
  }
  if (kind === 'devis') {
    ensure(100);
    doc.rect(M, y, 250, 80, { stroke: '#999999', width: 0.6 });
    doc.text(M + 10, y + 16, 'Bon pour accord', { size: 10, bold: true });
    doc.text(M + 10, y + 29, 'Date et signature du client', { size: 8.5, color: '#666666' });
    y += 94;
  }
  paragraphs(c.closing);

  // ---- Mentions légales (fixées par le code), puis numéros de page sur toutes les pages
  const mentions = legalMentions(kind, legal);
  const mLines = mentions.flatMap((m) => doc.wrap(m, W, 8));
  ensure(mLines.length * 10 + 20);
  y += 6;
  doc.line(M, y, M + W, y, { width: 0.4, color: '#999999' });
  y += 4;
  for (const ln of mLines) { doc.text(M, y + 9, ln, { size: 8, color: '#555555' }); y += 10; }
  const total = doc.pageCount;
  for (let i = 0; i < total; i++) doc.text(M + W, A4.h - 30, `Page ${i + 1}/${total}`, { size: 8, color: '#888888', align: 'right', page: i });
  return doc.toBuffer();
}

export const docLabel = (kind) => DOC_BY_KEY[kind]?.label || kind;
