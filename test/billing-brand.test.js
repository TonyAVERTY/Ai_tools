// Identité du projet pour les documents de facturation : police TrueType et images dans le PDF, lecture sûre du dépôt, couleurs lisibles,
// relecture par l'IA (essais, corrections bornées, livraison avec avertissements).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { Pdf } from '../src/services/pdf.js';
import { TrueTypeFont, FontError } from '../src/services/pdffont.js';
import { loadImage, trimImage, ImageError } from '../src/services/pdfimage.js';
import { normColor, contrast, legibleOnWhite, parseBrand, readRepoFile, resolveBrand, cleanAdjust, themeOf, ADJUST_LIMITS } from '../src/services/billingbrand.js';
import { parseReview, reviewDocument, sampleValues, rasterizePdf } from '../src/services/billingreview.js';
import { renderDocumentPdf } from '../src/services/billingpdf.js';

const FONT = readFileSync(new URL('../promo-video/assets/fonts/figtree-600.ttf', import.meta.url));
const FONT_BOLD = readFileSync(new URL('../promo-video/assets/fonts/figtree-800.ttf', import.meta.url));
const JPEG = readFileSync(new URL('../public/img/icon.jpg', import.meta.url));

// PNG RGBA de w × h pixels (un carré opaque dans un cadre transparent), fabriqué à la main
function png(w, h, { alpha = true } = {}) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crcb = Buffer.alloc(4); crcb.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crcb]); };
  const ch = alpha ? 4 : 3;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * ch);
    for (let x = 0; x < w; x++) { const inside = x >= 2 && x < w - 2 && y >= 2 && y < h - 2; row[1 + x * ch] = 14; row[2 + x * ch] = 122; row[3 + x * ch] = 102; if (alpha) row[4 + x * ch] = inside ? 255 : 0; }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

test('police TrueType : lue, mesurée, refusée quand ce n\'est pas une police gérée', () => {
  const f = new TrueTypeFont(FONT);
  assert.equal(f.family, 'Figtree');
  assert.ok(f.width('Facture', 10) > 20 && f.width('Facture', 10) < 60);
  assert.ok(f.width('Facture', 20) > f.width('Facture', 10) * 1.9, 'proportionnel à la taille');
  assert.ok(f.glyph('é') > 0 && f.glyph('€') > 0, 'accents et euro présents');
  assert.equal(f.glyph(' '), f.glyph(' '), 'espace insécable = espace');
  for (const bad of [Buffer.alloc(100), Buffer.from('OTTO'.padEnd(100, 'x')), Buffer.from('wOF2'.padEnd(100, 'x')), Buffer.from('ttcf'.padEnd(100, 'x'))]) assert.throws(() => new TrueTypeFont(bad), FontError);
  assert.throws(() => new TrueTypeFont(Buffer.alloc(2_000_000, 1)), /trop lourde/);
});

test('images : PNG avec transparence, PNG opaque, JPEG ; refus lisibles ; marges transparentes retirées', () => {
  const a = loadImage(png(20, 12));
  assert.deepEqual([a.kind, a.width, a.height, !!a.alpha], ['png', 20, 12, true]);
  assert.equal(loadImage(png(8, 8, { alpha: false })).alpha, null);
  const j = loadImage(JPEG);
  assert.equal(j.kind, 'jpeg');
  assert.ok(j.width > 0 && j.height > 0);
  const t = trimImage(a);
  assert.deepEqual([t.width, t.height], [16, 8], 'le cadre transparent de 2 px disparaît');
  for (const bad of [Buffer.from('GIF89a'.padEnd(40, 'x')), Buffer.alloc(8)]) assert.throws(() => loadImage(bad), ImageError);
  assert.throws(() => loadImage(Buffer.alloc(2_000_000)), /trop lourde/);
});

test('PDF avec police du projet et logo : valide, texte lisible et copiable', () => {
  const doc = new Pdf({ title: 'T', fonts: { regular: new TrueTypeFont(FONT), bold: new TrueTypeFont(FONT_BOLD) } });
  doc.text(50, 80, 'Devis n° 2026-001 — éàç € Société', { size: 16, bold: true, color: '#0e7a66' });
  doc.text(50, 110, 'Total 1 234,56 €', { size: 11 });
  doc.image(loadImage(png(20, 12)), 50, 130, 60, 36);
  const buf = doc.toBuffer();
  const head = buf.toString('latin1');
  assert.ok(head.startsWith('%PDF-1.4') && head.includes('/Subtype /Type0') && head.includes('/FontFile2') && head.includes('/XObject') && head.includes('/SMask'));
  const tmp = mkdtempSync(join(tmpdir(), 'pdfb-'));
  try {
    writeFileSync(join(tmp, 'a.pdf'), buf);
    const r = spawnSync('pdftotext', [join(tmp, 'a.pdf'), '-'], { encoding: 'utf8' });
    if (!r.error) { assert.match(r.stdout, /Devis n° 2026-001 — éàç € Société/); assert.match(r.stdout, /Total 1 234,56 €/); }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('police sans gras : le gras est simulé, la mesure reste cohérente', () => {
  const doc = new Pdf({ fonts: { regular: new TrueTypeFont(FONT), bold: null } });
  assert.ok(doc.width('Total', 10, true) > doc.width('Total', 10, false));
  doc.text(10, 20, 'Total', { bold: true });
  assert.ok(doc.pages[0].some((op) => op.includes(' 2 Tr ')), 'contour de remplissage + trait');
});

test('couleurs : normalisées, jamais illisibles sur du blanc', () => {
  assert.equal(normColor('#ABC'), '#aabbcc');
  assert.equal(normColor('0E7A66'), '#0e7a66');
  for (const bad of ['', 'rouge', '#12', 'rgb(1,2,3)', '#gggggg', null]) assert.equal(normColor(bad), '', String(bad));
  assert.ok(contrast('#000000', '#ffffff') > 20.9);
  const pale = legibleOnWhite('#f2b544'); // le jaune de la marque est illisible en texte sur blanc
  assert.ok(contrast('#f2b544', '#ffffff') < 3 && contrast(pale, '#ffffff') >= 4.5);
  assert.equal(legibleOnWhite('#0e3a66'), '#0e3a66', 'une couleur déjà lisible ne change pas');
});

test('ajustements : seules les clés connues, dans leurs bornes', () => {
  assert.deepEqual(cleanAdjust({ logoHeight: 500, fontScale: 0.1, rowPad: 'x', hideLogo: 'oui', evil: 1, accent: 'bleu' }), { logoHeight: ADJUST_LIMITS.logoHeight[1], fontScale: ADJUST_LIMITS.fontScale[0] });
  assert.deepEqual(cleanAdjust({ hideLogo: true, accent: '#123' }), { hideLogo: true, accent: '#112233' });
  assert.equal(themeOf({ primary: '' }), null, 'sans couleur principale : pas de thème');
  const th = themeOf({ primary: '#f2b544' }, { fontScale: 0.9 });
  assert.ok(contrast(th.accent, '#ffffff') >= 4.5 && th.fontScale === 0.9);
});

test('réponse de Claude : types vérifiés, listes bornées, aucun chemin ni couleur inventés conservés', () => {
  const b = parseBrand({ primary: 'blue', secondary: '#ABCDEF', fontFamily: 'Figtree <script>', fontFiles: ['a.ttf', 3, '', 'b.ttf'], logoFiles: 'x', notes: 'n'.repeat(900) });
  assert.deepEqual([b.primary, b.secondary, b.fontFamily, b.fontFiles, b.logoFiles], ['', '#abcdef', 'Figtree script', ['a.ttf', 'b.ttf'], []]);
  assert.equal(b.notes.length, 300);
  assert.equal(parseBrand(null).primary, '');
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'repo-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'f.ttf'), FONT);
  writeFileSync(join(dir, 'assets', 'f-bold.ttf'), FONT_BOLD);
  writeFileSync(join(dir, 'assets', 'logo.png'), png(30, 10));
  writeFileSync(join(dir, 'assets', 'broken.ttf'), Buffer.alloc(200, 7));
  writeFileSync(join(dir, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  return dir;
}

test('lecture du dépôt : rien ne sort du dépôt (chemin, lien symbolique), extensions et tailles contrôlées', () => {
  const dir = repo();
  const outside = mkdtempSync(join(tmpdir(), 'out-'));
  try {
    writeFileSync(join(outside, 'secret.png'), png(4, 4));
    symlinkSync(join(outside, 'secret.png'), join(dir, 'assets', 'link.png'));
    symlinkSync(outside, join(dir, 'assets', 'dir'));
    const png_ = { exts: new Set(['.png']), max: 1_000_000 };
    assert.ok(readRepoFile(dir, 'assets/logo.png', png_));
    assert.equal(readRepoFile(dir, '../' + outside.split('/').pop() + '/secret.png', png_), null, 'chemin remontant');
    assert.equal(readRepoFile(dir, outside + '/secret.png', png_), null, 'chemin absolu hors dépôt');
    assert.equal(readRepoFile(dir, 'assets/link.png', png_), null, 'lien symbolique vers un fichier extérieur');
    assert.equal(readRepoFile(dir, 'assets/dir/secret.png', png_), null, 'dossier-lien vers l\'extérieur');
    assert.equal(readRepoFile(dir, 'assets/f.ttf', png_), null, 'mauvaise extension');
    assert.equal(readRepoFile(dir, 'assets/logo.png', { ...png_, max: 10 }), null, 'trop gros');
    assert.equal(readRepoFile(dir, 'inexistant.png', png_), null);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('identité : police et logo du dépôt, polices illisibles ignorées, police chez Google en dernier recours, SVG converti', async () => {
  const dir = repo();
  try {
    const raw = parseBrand({ primary: '#0e7a66', fontFamily: 'Figtree', fontFiles: ['assets/broken.ttf', 'assets/f.ttf'], boldFontFiles: ['assets/f-bold.ttf'], logoFiles: ['assets/logo.svg', 'assets/logo.png'] });
    const sawSvg = [];
    const r = await resolveBrand(raw, dir, { rasterSvg: async (svg) => { sawSvg.push(svg.length); return png(40, 16); } });
    assert.equal(r.brand.fontName, 'Figtree');
    assert.ok(r.assets.fontRegular && r.assets.fontBold && r.brand.hasBoldFont);
    assert.ok(r.brand.hasLogo && r.assets.logoType === 'png' && sawSvg.length === 1, 'le SVG est converti, le premier logo lisible est gardé');
    assert.ok(r.notes.some((n) => /broken\.ttf/.test(n)), 'la police cassée est signalée');

    // Aucune police dans le dépôt : récupérée par le fournisseur, jamais bloquant si elle manque
    const none = parseBrand({ primary: '#0e7a66', fontFamily: 'Figtree' });
    const asked = [];
    const viaFetch = await resolveBrand(none, dir, { fetchFont: async (fam, w) => { asked.push([fam, w]); return w === 700 ? FONT_BOLD : FONT; } });
    assert.deepEqual(asked, [['Figtree', 500], ['Figtree', 700]]);
    assert.ok(viaFetch.assets.fontRegular && viaFetch.brand.hasBoldFont && viaFetch.notes.some((n) => /Google Fonts/.test(n)));
    const failing = await resolveBrand(none, dir, { fetchFont: async () => { throw new Error('hors ligne'); } });
    assert.equal(failing.assets.fontRegular, null);
    assert.ok(failing.notes.some((n) => /introuvable/.test(n)));
    // SVG sans outil de conversion : ignoré avec une note, pas d'erreur
    const noTool = await resolveBrand(parseBrand({ primary: '#0e7a66', logoFiles: ['assets/logo.svg'] }), dir);
    assert.equal(noTool.brand.hasLogo, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- Document aux couleurs du projet ----------

const LEGAL = { legal_name: 'Atelier Test', address: '1 rue A', postal_code: '35000', city: 'Rennes', siret: '12345678900012', email: 'a@t.fr', vat_mode: 'franchise', iban: '', bic: '', phone: '', website: '' };
const CONTENT = { title: 'Devis', intro: 'Bonjour', lines: [{ label: 'Site vitrine', description: '', qty: 1, unit_cents: 150000 }], conditions: 'Paiement à 30 jours', payment: 'Virement', closing: 'Merci', layout: 'moderne', deposit_percent: 30 };

test('document : la couleur, le logo et la police du projet apparaissent dans le PDF', () => {
  const brand = { theme: themeOf({ primary: '#0e7a66' }), fonts: { regular: new TrueTypeFont(FONT), bold: new TrueTypeFont(FONT_BOLD) }, logo: trimImage(loadImage(png(40, 16))) };
  const plain = renderDocumentPdf({ kind: 'devis', content: CONTENT, legal: LEGAL, layout: 'moderne', values: sampleValues('devis') }).toString('latin1');
  const themed = renderDocumentPdf({ kind: 'devis', content: CONTENT, legal: LEGAL, layout: 'moderne', values: sampleValues('devis'), brand }).toString('latin1');
  assert.ok(!plain.includes('/XObject') && !plain.includes('/Type0'));
  assert.ok(themed.includes('/XObject') && themed.includes('/Type0'));
  const noLogo = renderDocumentPdf({ kind: 'devis', content: CONTENT, legal: LEGAL, layout: 'moderne', values: sampleValues('devis'), brand: { ...brand, theme: { ...brand.theme, hideLogo: true } } }).toString('latin1');
  assert.ok(!noLogo.includes('/XObject'), 'hideLogo retire le logo');
});

// ---------- Relecture par l'IA ----------

const verdict = (o) => JSON.stringify({ approved: false, issues: [{ page: 1, severity: 'blocker', problem: 'Logo trop grand' }], ...o });
const harness = (answers, { files = ['/p/page-1.png'], read = true } = {}) => {
  const seen = { renders: [], prompts: [] };
  let i = 0;
  return {
    seen,
    opts: {
      kind: 'devis', content: CONTENT, legal: LEGAL, brand: { primary: '#0e7a66', hasLogo: true }, extraRoot: tmpdir(), model: 'm',
      render: (content, adjust) => { seen.renders.push({ content, adjust }); return Buffer.from('%PDF'); },
      rasterize: async () => files,
      runAgent: async (o) => { seen.prompts.push(o.prompt); if (read) for (const f of files) o.onTool('Read', { file_path: f }); return { ok: true, text: answers[Math.min(i++, answers.length - 1)] }; },
    },
  };
};

test('verdict : illisible refusé, un refus sans défaut en devient un, corrections bornées', () => {
  assert.throws(() => parseReview('rien', 'devis'), /illisible/);
  assert.throws(() => parseReview('{"issues":[]}', 'devis'), /illisible/);
  const v = parseReview(verdict({ issues: [], adjust: { logoHeight: 999 }, content: { intro: 'x'.repeat(5000), evil: 'y' } }), 'devis');
  assert.equal(v.approved, false);
  assert.equal(v.issues.length, 1, 'refus sans précision : défaut générique');
  assert.equal(v.adjust.logoHeight, ADJUST_LIMITS.logoHeight[1]);
  assert.deepEqual(Object.keys(v.content), ['intro']);
  assert.equal(v.content.intro.length, 1500);
  assert.equal(parseReview('{"approved":true,"issues":[{"severity":"minor","problem":"détail"}]}', 'devis').approved, true, 'un défaut mineur n\'empêche pas l\'accord');
  assert.equal(parseReview('{"approved":true,"issues":[{"severity":"blocker","problem":"montant faux"}]}', 'devis').approved, false, 'un défaut bloquant l\'emporte');
});

test('relecture : refus, corrections appliquées, nouveau rendu, puis accord', async () => {
  const h = harness([verdict({ adjust: { logoHeight: 30 }, content: { intro: 'Bonjour, voici notre proposition.' } }), '{"approved":true,"issues":[]}']);
  const r = await reviewDocument(h.opts);
  assert.equal(r.approved, true);
  assert.equal(r.rounds, 2);
  assert.equal(h.seen.renders.length, 2);
  assert.deepEqual(h.seen.renders[1].adjust, { logoHeight: 30 });
  assert.equal(h.seen.renders[1].content.intro, 'Bonjour, voici notre proposition.');
  assert.equal(r.content.intro, 'Bonjour, voici notre proposition.');
  assert.match(h.seen.prompts[0], /Site vitrine/, 'l\'agent reçoit ce qui doit figurer sur le PDF');
  assert.match(h.seen.prompts[0], /#0e7a66/);
});

test('relecture : trois refus, le document est livré avec la liste des défauts restants', async () => {
  const h = harness([verdict({ adjust: { rowPad: 5 } }), verdict({ adjust: { rowPad: 6 } }), verdict({ adjust: { rowPad: 7 } })]);
  const r = await reviewDocument(h.opts);
  assert.deepEqual([r.approved, r.rounds, h.seen.renders.length], [false, 3, 3]);
  assert.equal(r.issues[0].problem, 'Logo trop grand');
  assert.equal(r.adjust.rowPad, 7);
});

test('relecture : un refus qui ne propose aucun changement n\'est pas rejoué pour rien', async () => {
  const h = harness([verdict({})]);
  const r = await reviewDocument(h.opts);
  assert.deepEqual([r.approved, r.rounds, h.seen.renders.length], [false, 1, 1]);
});

test('relecture : pages non toutes regardées = contrôle incomplet ; pdftoppm absent = relecture sautée avec explication', async () => {
  await assert.rejects(reviewDocument(harness(['{"approved":true,"issues":[]}'], { read: false }).opts), /pas regardé toutes les pages/);
  const h = harness(['{"approved":true,"issues":[]}']);
  const r = await reviewDocument({ ...h.opts, rasterize: async () => null });
  assert.deepEqual([r.approved, r.rounds], [false, 0]);
  assert.match(r.skipped, /pdftoppm/);
});

test('relecture : un agent en échec lève une erreur claire (la génération la rattrape sans bloquer)', async () => {
  const h = harness([]);
  await assert.rejects(reviewDocument({ ...h.opts, runAgent: async () => ({ ok: false, subtype: 'error_max_turns' }) }), /relecture a échoué/);
});

test('pdftoppm : une page par fichier PNG, absence signalée par null', { skip: spawnSync('pdftoppm', ['-v']).error ? 'pdftoppm absent' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'rast-'));
  try {
    const pdf = renderDocumentPdf({ kind: 'devis', content: CONTENT, legal: LEGAL, layout: 'moderne', values: sampleValues('devis') });
    const files = rasterizePdf(pdf, dir);
    assert.ok(files.length >= 1 && files.every((f) => f.endsWith('.png')));
    assert.equal(rasterizePdf(pdf, dir, { bin: 'binaire-inexistant-xyz' }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
