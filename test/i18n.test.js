import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLookup, canonInline, restoreTags, normalize } from '../src/i18n/core.js';
import { translateHtml } from '../src/i18n/html.js';
import { ROWS, entriesFor } from '../src/i18n/dictionary.js';
import { LANGS, isLang, lookupFor } from '../src/i18n/index.js';

const L = makeLookup({
  'Annuler': 'Cancel',
  'Erreur de connexion': 'Connection error',
  'Tu as {n} projets': 'You have {n} projects',
  'Tu as {n} projets et {m} prospects': 'You have {n} projects and {m} prospects',
  "Clique sur <strong>Accepter</strong> pour continuer": 'Click <strong>Accept</strong> to continue',
  'Ton choix est gardé.': 'Your choice is saved.',
});

test('noyau : texte exact, espaces réduits, point final ajouté par l\'application, modèles à trous (le plus précis d\'abord)', () => {
  assert.equal(L.text('Annuler'), 'Cancel');
  assert.equal(L.text('  \n Annuler  '), '  \n Cancel  ', 'espaces autour conservés tels quels, insécable compris dans la recherche');
  assert.equal(L.text('Erreur de connexion.'), 'Connection error.', 'point ajouté à l\'affichage');
  assert.equal(L.text('Ton choix est gardé'), null, 'pas de traduction sans la clé exacte (le point de la clé n\'est pas facultatif dans ce sens)');
  assert.equal(L.text('Tu as 3 projets'), 'You have 3 projects');
  assert.equal(L.text('Tu as 3 projets et 12 prospects'), 'You have 3 projects and 12 prospects', 'le modèle le plus précis gagne');
  assert.equal(L.text('Texte inconnu'), null);
  assert.equal(L.text(''), null);
  assert.equal(normalize(' a   b\n'), 'a b');
});

test('noyau : une phrase avec balises se cherche sans les attributs et les remet ensuite', () => {
  assert.equal(canonInline('Clique sur <strong class="x">Accepter</strong>  pour continuer'), 'Clique sur <strong>Accepter</strong> pour continuer');
  const original = 'Clique sur <strong class="x">Accepter</strong> pour continuer';
  const tr = L.inline(original);
  assert.equal(tr, 'Click <strong>Accept</strong> to continue');
  assert.equal(restoreTags(tr, original), 'Click <strong class="x">Accept</strong> to continue');
  assert.equal(restoreTags('Click <em>Accept</em>', original), null, 'balises qui ne correspondent pas : on garde le français');
  assert.equal(restoreTags('Click <a>x</a> <a>y</a>', '<a href="1">x</a>'), null);
});

test('page : textes, attributs visibles, phrases avec balises ; le reste est recopié à l\'identique', () => {
  const html = `<!doctype html><html lang="fr" data-theme="dark"><head><meta charset="utf-8"><title>Annuler</title><meta name="description" content="Annuler"></head><body>
<button type="submit" class="btn" title="Annuler">Annuler</button>
<input type="submit" value="Annuler"><input type="text" value="Annuler" placeholder="Annuler">
<p>Clique sur <strong class="b">Accepter</strong> pour continuer</p>
<p>Tu as 7 projets</p>
<a href="/x?a=1&amp;b=2" aria-label="Annuler">Texte inconnu</a>
<script>const t = "Annuler"; if (a < b && c > d) {}</script>
<style>.x::after{content:"Annuler"}</style>
<pre>Annuler</pre><code>Annuler</code><textarea>Annuler</textarea>
<svg><text>Annuler</text></svg>
<!-- Annuler -->
</body></html>`;
  const out = translateHtml(html, L, 'en');
  assert.match(out, /<html lang="en" data-theme="dark">/);
  assert.match(out, /<title>Cancel<\/title>/);
  assert.match(out, /<meta name="description" content="Cancel">/);
  assert.match(out, /<button type="submit" class="btn" title="Cancel">Cancel<\/button>/);
  assert.match(out, /<input type="submit" value="Cancel">/);
  assert.match(out, /<input type="text" value="Annuler" placeholder="Cancel">/, 'la valeur d\'un champ de saisie n\'est jamais traduite');
  assert.match(out, /<p>Click <strong class="b">Accept<\/strong> to continue<\/p>/);
  assert.match(out, /<p>You have 7 projects<\/p>/);
  assert.match(out, /<a href="\/x\?a=1&amp;b=2" aria-label="Cancel">Texte inconnu<\/a>/, 'inconnu : reste en français');
  assert.match(out, /<script>const t = "Annuler"; if \(a < b && c > d\) \{\}<\/script>/, 'script intact');
  assert.match(out, /content:"Annuler"/);
  assert.match(out, /<pre>Annuler<\/pre><code>Annuler<\/code><textarea>Annuler<\/textarea>/);
  assert.match(out, /<svg><text>Annuler<\/text><\/svg>/);
  assert.match(out, /<!-- Annuler -->/);
  // Rien d'autre ne bouge : retirer les traductions redonne l'original
  assert.equal(translateHtml(html, makeLookup({}), 'fr').replace('lang="fr"', 'lang="fr"'), html);
});

test('page : entités, apostrophes et texte écrit par la personne', () => {
  const l = makeLookup({ "Aujourd'hui": 'Today', 'Chat & mails': 'Chat & emails', '« Choisir »': '« Choose »' });
  const out = translateHtml('<h1>Aujourd&#39;hui</h1><p>Chat &amp; mails</p><p>&laquo; Choisir &raquo;</p><p>Boulangerie &lt;3</p>', l, 'en');
  assert.equal(out, '<h1>Today</h1><p>Chat &amp; emails</p><p>« Choose »</p><p>Boulangerie &lt;3</p>');
});

test('dictionnaire : trois langues par ligne, rien de vide, clés uniques, mêmes trous et mêmes balises partout', () => {
  const seen = new Set();
  const holes = (s) => (s.match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');
  const tags = (s) => (s.match(/<\/?[a-z][a-z0-9]*>/gi) || []).map((t) => t.toLowerCase()).sort().join(',');
  for (const row of ROWS) {
    assert.equal(row.length, 3, `ligne à 3 colonnes : ${row[0]}`);
    for (const c of row) assert.ok(typeof c === 'string' && c.trim(), `colonne vide : ${row[0]}`);
    const key = canonInline(row[0]);
    assert.ok(!seen.has(key), `clé en double : ${row[0]}`);
    seen.add(key);
    for (const tr of row.slice(1)) {
      assert.equal(holes(tr), holes(row[0]), `mêmes { trous } que le français : ${row[0]}`);
      assert.equal(tags(tr), tags(row[0]), `mêmes balises que le français : ${row[0]}`);
    }
  }
  assert.deepEqual(LANGS, ['fr', 'en', 'es']);
  assert.equal(isLang('de'), false);
  assert.equal(lookupFor('fr'), null);
  assert.ok(lookupFor('en').size === Object.keys(entriesFor('en')).length);
  assert.equal(lookupFor('es').text('Annuler'), 'Cancelar');
});
