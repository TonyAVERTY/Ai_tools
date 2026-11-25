// Garde-fou de la traduction : chaque page de l'application (connectée) et du site public, lue avec un compte garni, n'a plus aucun texte sans traduction
// en anglais ni en espagnol. Un nouveau texte d'interface sans ligne dans src/i18n/dict/ fait échouer ce test : ajoute la ligne [français, anglais, espagnol].
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { seedAccount, appPaths, readPage, legalVariants, plannedAccounts, PUBLIC_PATHS, SEED_TEXTS } from './helpers/i18n-pages.js';
import { collectTexts, missingIn, unbrand } from '../src/i18n/audit.js';
import { tabSlugs } from '../src/projectviews.js';

let s;
let user;
let projectId;
before(async () => {
  s = await startApp();
  ({ user, projectId } = await seedAccount(s));
});
after(async () => { await s.close(); });

async function missingOn(who, paths, lang) {
  const out = [];
  for (const path of paths) {
    const html = await readPage(s, who, path);
    if (html == null) continue;
    for (const k of missingIn(collectTexts(html), lang, SEED_TEXTS)) out.push(`${path} : ${k.slice(0, 120)}`);
  }
  return out;
}

for (const lang of ['en', 'es']) {
  test(`traduction (${lang}) : aucune page publique n'a de texte sans traduction`, async () => {
    assert.deepEqual(await missingOn(null, PUBLIC_PATHS, lang), []);
  });
  test(`traduction (${lang}) : les pages juridiques sont traduites, avec toutes leurs variantes`, async () => {
    const miss = [];
    for (const html of await legalVariants()) for (const k of missingIn(collectTexts(html), lang)) miss.push(k.slice(0, 120));
    assert.deepEqual(miss, []);
  });
  test(`traduction (${lang}) : aucune page de l'application n'a de texte sans traduction`, async () => {
    const paths = appPaths(s, projectId, tabSlugs());
    assert.ok(paths.length > 25, 'les pages sont bien trouvées par le routeur');
    assert.deepEqual(await missingOn(user, paths, lang), []);
  });
}

test('traduction (en, es) : les pages dépendant de l\'offre (Démarrage à Échelle, mode développeur) sont traduites', async () => {
  const miss = [];
  for (const { user: who } of await plannedAccounts(s)) {
    for (const path of ['/', '/account', '/settings', '/projets', '/developer', '/facturation', '/compta', '/team', '/clients', '/calendar']) {
      for (const lang of ['en', 'es']) miss.push(...(await missingOn(who, [path], lang)));
    }
  }
  assert.deepEqual([...new Set(miss)], []);
});

test('traduction (en, es) : le back-office est traduit', async () => {
  const admin = await s.newUser({ admin: true });
  const miss = [];
  for (const lang of ['en', 'es']) miss.push(...(await missingOn(admin, ['/admin', '/admin/stats'], lang)));
  assert.deepEqual([...new Set(miss)], []);
});

test('traduction : un message d\'erreur de tâche enregistré en français est traduit à l\'affichage', async () => {
  const { lookupFor } = await import('../src/i18n/index.js');
  assert.match(lookupFor('en').text('Tâche en échec : Le mail fait 250 mots : au-delà de 200 mots, la réponse devient plus rare.'), /^Task failed: The email is 250 words long/);
  assert.match(lookupFor('es').text('Implémentation en échec : Chemin refusé : « .env »'), /^Implementación fallida: Ruta rechazada/);
});

test('traduction (en) : aucun texte de page traduite ne ressemble encore à du français (contrôle de secours contre les modèles trop larges)', async () => {
  const { translateHtml } = await import('../src/i18n/html.js');
  const { lookupFor } = await import('../src/i18n/index.js');
  const FRW = /\b(les|des|une|pour|avec|dans|ton|tes|vous|nous|sont|est|que|qui|pas|du|au|ou|et|sur)\b/gi;
  const ok = /Français|Español|Liffré|Mérignac|Kiné|Agenda Kiné/g;
  const bad = [];
  const lists = [[null, [...PUBLIC_PATHS]], [user, appPaths(s, projectId, tabSlugs())]];
  for (const [who, paths] of lists) for (const path of paths) {
    const html = await readPage(s, who, path);
    if (html == null) continue;
    for (const k of collectTexts(translateHtml(unbrand(html), lookupFor('en'), 'en'))) {
      const t = k.replace(/<[^>]*>/g, ' ').replace(ok, '');
      if (SEED_TEXTS.has(k) || /@/.test(t)) continue;
      if (/[àâçéèêëîïôùûüœ]/.test(t) || (t.match(FRW) || []).length >= 2) bad.push(`${path} : ${k.slice(0, 100)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('traduction : une page lue avec la langue choisie sort bien traduite (cookie lang)', async () => {
  const r = await fetch(`${s.base}/accueil`, { headers: { cookie: 'lang=en', accept: 'text/html' } });
  const html = await r.text();
  assert.match(html, /<html lang="en"/);
  assert.match(html, /Create my account/);
  assert.doesNotMatch(html, /Créer mon compte/);
});
