// Bandeau de résultat commun (src/banner.js) : une seule apparence, le bon rôle, jamais de HTML venant d'une donnée,
// et plus aucun bandeau écrit à la main ni de seconde feuille de style pour le même besoin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { banner } from '../src/banner.js';

test('banner : une erreur finit par un point (jamais doublé), un succès et un avertissement restent tels quels', () => {
  const span = (html) => html.match(/<span>(.*)<\/span>/)[1];
  assert.equal(span(banner('err', 'Choisis ta situation pour continuer')), 'Choisis ta situation pour continuer.');
  for (const done of ['Choisis une date.', 'Vraiment ?', 'Attention…', 'Zut !']) assert.equal(span(banner('err', done)), done, `« ${done} » : rien à ajouter`);
  assert.equal(span(banner('ok', 'Réglages enregistrés')), 'Réglages enregistrés', 'un succès (« Nom + participe passé ») n\'a pas de point');
  assert.equal(span(banner('warn', 'Informations légales incomplètes')), 'Informations légales incomplètes');
  assert.equal(span(banner('err', '<b>x</b>')), '&lt;b&gt;x&lt;/b&gt;.', 'le point s\'ajoute avant l\'échappement : le texte reste échappé');
});

test('banner : classe, icône et rôle selon le type (alert pour une erreur, status sinon)', () => {
  assert.match(banner('ok', 'Réglages enregistrés'), /^<p class="msg msg-ok" role="status"><svg class="ic"[^>]*><use href="#i-check"><\/use><\/svg><span>Réglages enregistrés<\/span><\/p>$/);
  assert.match(banner('err', 'Impossible d\'envoyer'), /^<p class="msg msg-err" role="alert">.*#i-alert.*<span>Impossible d&#39;envoyer\.<\/span><\/p>$/); // l'apostrophe est échappée ; l'erreur finit par un point
  assert.match(banner('warn', 'Informations légales incomplètes'), /^<p class="msg msg-warn" role="status">.*#i-alert/);
  assert.match(banner('ok', 'Enregistré', { strong: true }), /<span><b>Enregistré<\/b><\/span>/);
  assert.throws(() => banner('succes', 'x'), /type inconnu/);
});

test('banner : le texte est échappé (une donnée saisie ne devient jamais du HTML)', () => {
  const h = banner('err', '<img src=x onerror=alert(1)> & "guillemets"');
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;guillemets&quot;/);
});

test('un seul système : aucun bandeau écrit à la main dans les vues, plus de .ok-box ni de .cmp-flash', () => {
  const dir = new URL('../src/', import.meta.url);
  const offenders = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'banner.js')) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    // un conteneur rempli par le navigateur (caché au départ) est le seul cas où le balisage reste écrit à la main
    for (const m of src.matchAll(/<[a-z]+ class="msg msg-(?:ok|err|warn)"[^>]*>/g)) if (!/\shidden\b/.test(m[0])) offenders.push(`${f} : ${m[0]}`);
    for (const k of ['cmp-flash', 'ok-box']) if (src.includes(k)) offenders.push(`${f} : ${k}`);
  }
  assert.deepEqual(offenders, [], 'utilise banner() de src/banner.js');
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  for (const k of ['.cmp-flash', '.ok-box']) assert.ok(!css.includes(k), `${k} n'existe plus dans app.css`);
});

test('le bandeau .msg n\'est plus écrasé par les bulles du chat (qui ont leur propre nom : .chat-msg)', () => {
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.equal([...css.matchAll(/^\.msg \{/gm)].length, 1, 'une seule règle .msg (le bandeau)');
  assert.doesNotMatch(css, /^\.msg\.(user|bot)/m);
  assert.match(css, /^\.chat-msg\.user/m);
  for (const f of ['../public/chat.js', '../src/chatviews.js']) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /'msg (user|bot)'|"msg (user|bot)"/, f);
});
