// Pages trouvables depuis la recherche globale : libellés, mots-clés, onglets de projet selon les droits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPages, SITE_PAGES } from '../src/searchpages.js';
import { NAV, MORE_PAGES } from '../src/views.js';

const mine = { id: 1, name: 'Alpha', user_id: 7 };
const shared = { id: 2, name: 'Beta', user_id: 99 };
const hrefs = (q, projects = [mine, shared]) => searchPages(q, projects, 7).map((i) => i.href);

test('chaque page du menu et du menu du compte est trouvable par son nom', () => {
  for (const [href, , label] of [...NAV, ...MORE_PAGES]) {
    const found = searchPages(label, [], 7).map((i) => i.href);
    assert.ok(found.includes(href), `${label} (${href}) introuvable`);
  }
  assert.ok(SITE_PAGES.every(([h]) => h.startsWith('/')));
});

test('accents, majuscules et mots-clés', () => {
  assert.deepEqual(hrefs('RÉGLAGES', []), ['/settings']);
  assert.ok(hrefs('parametres', []).includes('/settings'));
  assert.ok(hrefs('devis', []).includes('/facturation'), '« devis » mène à Facturation');
  assert.deepEqual(hrefs('x', []), [], 'une lettre ne cherche rien');
  assert.deepEqual(hrefs('zzzzz'), []);
});

test('onglets d\'un projet : « Réservé » seulement à qui gère le projet', () => {
  const h = hrefs('factu');
  assert.ok(h.includes('/p/1/facturation'), 'mon projet : onglet Facturation');
  assert.ok(!h.includes('/p/2/facturation'), 'projet partagé par un autre : onglet réservé masqué');
  assert.ok(hrefs('prospection').includes('/p/2/prospection'), 'onglet ouvert à tous : visible');
  assert.deepEqual(searchPages('prospection', [mine], 7).map((i) => i.title), ['Prospection · Alpha']);
});

test('au plus six résultats', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `P${i}`, user_id: 7 }));
  assert.ok(searchPages('outils', many, 7).length <= 6);
});
