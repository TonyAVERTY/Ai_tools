// Plateformes cibles de la vidéo de promotion : préréglages valides, paramètre contrôlé, consigne donnée à l'IA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMS, PLATFORM_IDS } from '../src/services/promoplatforms.js';
import { PROMO, FORMATS, parsePromoParams } from '../src/services/promovideo.js';
import { promoPrompt } from '../src/services/prompts.js';

test('chaque préréglage reste dans les bornes du formulaire et vise un format qui existe', () => {
  assert.ok(PLATFORM_IDS.length >= 5);
  for (const [id, p] of Object.entries(PLATFORMS)) {
    assert.ok(p.label && p.brief, id);
    assert.ok(FORMATS[p.format], `${id} : format inconnu`);
    assert.ok(p.fps >= PROMO.fps.min && p.fps <= PROMO.fps.max, `${id} : images par seconde hors bornes`);
    assert.ok(p.seconds >= PROMO.seconds.min && p.seconds <= PROMO.seconds.max, `${id} : durée hors bornes`);
    assert.ok(p.fps * p.seconds <= PROMO.maxFrames, `${id} : trop d'images`);
  }
});

test('le paramètre plateforme est facultatif et contrôlé', () => {
  assert.equal(parsePromoParams({}).platform, '');
  assert.equal(parsePromoParams({ platform: 'tiktok' }).platform, 'tiktok');
  for (const bad of ['TikTok', 'snapchat', 'constructor', '__proto__', 'toString', 42, null]) assert.equal(parsePromoParams({ platform: bad }).platform, '', String(bad));
  // choisir une plateforme ne change pas les valeurs saisies : le préréglage est appliqué par le formulaire, pas par le serveur
  const p = parsePromoParams({ platform: 'tiktok', fps: 24, seconds: 8, format: 'carre' });
  assert.deepEqual([p.fps, p.seconds, p.format], [24, 8, 'carre']);
});

test('prompt : la consigne de la plateforme apparaît seulement quand elle est choisie', () => {
  const base = { projectName: 'Fidélio', profile: { resume: 'r', proposition_valeur: 'v', arguments: [] }, target: {}, seconds: 15, fps: 30, format: 'vertical', width: 720, height: 1280, custom: {} };
  assert.doesNotMatch(promoPrompt(base).prompt, /Plateforme de diffusion/);
  assert.doesNotMatch(promoPrompt({ ...base, platform: 'inconnue' }).prompt, /Plateforme de diffusion/);
  const p = promoPrompt({ ...base, platform: 'tiktok' }).prompt;
  assert.match(p, /Plateforme de diffusion : TikTok, au format vertical/);
  assert.match(p, /zones? masquée|recouvre/i);
  assert.match(promoPrompt({ ...base, platform: 'youtube', format: 'paysage' }).prompt, /Plateforme de diffusion : YouTube, au format paysage/);
});
