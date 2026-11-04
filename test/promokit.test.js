// Direction artistique, scène de référence et contrôle qualité (partie pure : sans Chromium).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMO_STYLES, PROMO_STYLE_IDS, pickStyle, styleBrief, exampleFor, PROMO_EXAMPLE } from '../src/services/promokit.js';
import { judgeScene, parsePromoParams } from '../src/services/promovideo.js';

const good = (i) => ({ cover: 0.5, maxFont: 90, minFont: 30, cy: 0.5, bg: { solid: false, gradient: true, lum: 0.1 }, boxes: [['a', 10 + i * 5, 20, 100, 100]] });
const size = { width: 720, height: 1280 };

test('direction : un style demandé est respecté, « auto » est stable pour un même projet', () => {
  assert.equal(pickStyle('chaud', 'x').id, 'chaud');
  assert.equal(pickStyle('auto', 'Projet|sujet').id, pickStyle('auto', 'Projet|sujet').id);
  assert.ok(PROMO_STYLE_IDS.includes(pickStyle('inconnu', 'a').id));
  assert.equal(parsePromoParams({ style: 'nimporte' }).style, 'auto');
  assert.equal(parsePromoParams({ style: 'clair' }).style, 'clair');
});

test('direction : le brief donne les couleurs exactes et la scène de référence les reprend', () => {
  for (const [id, st] of Object.entries(PROMO_STYLES)) {
    const brief = styleBrief(pickStyle(id));
    assert.ok(brief.includes(st.fond[0]) && brief.includes(st.a));
    const scene = exampleFor(pickStyle(id));
    assert.ok(scene.includes(st.fond[0]), id);
    assert.match(scene, /window\.renderFrame=function\(t\)/);
  }
  assert.match(PROMO_EXAMPLE, /renderFrame/);
});

test('qualité : une scène vivante passe, sans remarque bloquante', () => {
  const m = Array.from({ length: 20 }, (_, i) => good(i));
  assert.deepEqual(judgeScene(m, size).errors, []);
});

test('qualité : vide, petits titres, fond blanc et image figée sont refusés', () => {
  const bad = Array.from({ length: 20 }, () => ({ cover: 0.08, maxFont: 26, minFont: 14, cy: 0.12, bg: { solid: true, gradient: false, lum: 1 }, boxes: [['a', 10, 20, 100, 100]] }));
  const e = judgeScene(bad, size).errors.join('\n');
  for (const re of [/Trop de vide/, /Titres trop petits/, /Texte illisible/, /collé en haut/, /Fond blanc uni/, /Image figée/]) assert.match(e, re);
});

test('qualité : le dernier plan vide est signalé', () => {
  const m = Array.from({ length: 10 }, (_, i) => good(i));
  m[9] = { ...m[9], cover: 0 };
  assert.match(judgeScene(m, size).errors.join('\n'), /dernier plan est vide/);
});
