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

test('motion design : les quatre réglages du pro et « une chose à chaque seconde » arrivent dans la consigne, et le contrôle du montage les vérifie', async () => {
  const { promoPrompt } = await import('../src/services/prompts.js');
  const { VIDEO_REVIEWERS } = await import('../src/services/promoqa.js');
  const base = { projectName: 'Fidélio', profile: { resume: 'r', proposition_valeur: 'v', arguments: [] }, target: {}, seconds: 15, fps: 30, format: 'vertical', width: 720, height: 1280, custom: {} };
  for (const model of ['haiku', 'sonnet', 'opus']) {
    const { system, prompt } = promoPrompt({ ...base, model });
    const all = `${system}\n${prompt}`;
    for (const rule of [/rien ne s'arrête net/i, /Flou de mouvement/, /on ne coupe pas/i, /tombe pile sur l'image/, /au moins un événement utile par seconde/i]) assert.match(all, rule, `${model} : ${rule}`);
    // Les trois fiches vidéo tiennent ensemble dans le plafond : aucune n'est écartée pour faire de la place
    for (const name of ['mouvement et technique', 'scénario et textes', 'direction artistique']) assert.match(all, new RegExp(`Vidéo de promotion : ${name}`), `${model} : fiche « ${name} »`);
  }
  const motion = VIDEO_REVIEWERS.find((r) => r.id === 'motion').brief;
  assert.match(motion, /quatre réglages/);
  assert.match(motion, /au moins deux images consécutives/, 'un défaut isolé reste mineur : pas de nouvelle tentative coûteuse pour un artefact');
});
