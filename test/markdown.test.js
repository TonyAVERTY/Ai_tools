import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, parseEvolutions, evolutionHtml } from '../src/services/markdown.js';
import { evolutionMail, prospectHtml } from '../src/services/mailhtml.js';
import { bar } from '../src/services/notify.js';

const EVOS = `### 1. Export CSV des clients
- **Pourquoi** : les commerçants veulent leurs données dans Excel.
- **Effort** : S
- **Pistes techniques** :
  - route \`GET /export\` dans \`src/routes.js\`
  - réutiliser le module csv

### 2. Rappels par SMS
- **Pourquoi** : *beaucoup* plus lu qu'un mail.
- **Effort** : L (fournisseur à intégrer)`;

test('markdown : titres, listes imbriquées, gras, code', () => {
  const h = renderMarkdown('## Titre\n\nUn **gras** et `code`.\n\n- a\n  - a1\n- b\n\n1. un\n2. deux');
  assert.match(h, /<h2>Titre<\/h2>/);
  assert.match(h, /<p>Un <strong>gras<\/strong> et <code>code<\/code>\.<\/p>/);
  assert.match(h, /<ul><li>a<ul><li>a1<\/li><\/ul><\/li><li>b<\/li><\/ul>/);
  assert.match(h, /<ol><li>un<\/li><li>deux<\/li><\/ol>/);
});

test('markdown : le HTML et les liens dangereux ne passent jamais', () => {
  const h = renderMarkdown('<img src=x onerror=alert(1)> [clic](javascript:alert(1)) [ok](https://a.fr/?a=1&b=2) **<script>**');
  assert.doesNotMatch(h, /<img|<script|href="javascript/i);
  assert.match(h, /&lt;img/);
  assert.match(h, /<a href="https:\/\/a\.fr\/\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">ok<\/a>/);
  assert.doesNotMatch(renderMarkdown('```\n<b>x</b>\n```'), /<b>/);
});

test('évolutions : découpage en fiches avec effort', () => {
  const e = parseEvolutions(EVOS);
  assert.equal(e.length, 2);
  assert.deepEqual([e[0].n, e[0].title, e[0].effort], [1, 'Export CSV des clients', 'S']);
  assert.equal(e[1].effort, 'L');
  assert.equal(e[1].effortNote, 'fournisseur à intégrer');
  assert.doesNotMatch(e[0].body, /Effort/, 'l\'effort passe en pastille, pas dans le corps');
  const h = evolutionHtml(EVOS);
  assert.match(h, /<span class="effort e-S">S · Rapide<\/span>/);
  assert.match(h, /<li><strong>Pistes techniques<\/strong> :<ul><li>route <code>GET \/export<\/code>/);
  assert.match(evolutionHtml('Pas de titres ici'), /<div class="md"><p>Pas de titres ici<\/p><\/div>/, 'format inconnu : rendu simple');
});

test('mails HTML : évolutions en cartes, prospection sobre avec désinscription', () => {
  const m = evolutionMail({ markdown: EVOS, projectName: 'MonEspacePro', count: 2, appUrl: 'https://ai.test' });
  assert.match(m, /2 évolutions pour MonEspacePro/);
  assert.match(m, /S · Rapide/);
  assert.match(m, /href="https:\/\/ai\.test"/);
  const p = prospectHtml({ body: 'Bonjour <b>Fournil</b>,\n\nVoir https://monespacepro.fr.\nÀ bientôt', notice: 'Adresse publique.', unsubUrl: 'https://ai.test/u/x/y' });
  assert.match(p, /Bonjour &lt;b&gt;Fournil&lt;\/b&gt;,/);
  assert.match(p, /<a href="https:\/\/monespacepro\.fr" [^>]*>https:\/\/monespacepro\.fr<\/a>\.<br>À bientôt/);
  assert.match(p, /href="https:\/\/ai\.test\/u\/x\/y"/);
});

test('barre de progression Discord', () => {
  assert.equal(bar(7, 10, 10), '▰▰▰▰▰▰▰▱▱▱ 70 %');
  assert.equal(bar(0, 0, 4), '▱▱▱▱ 0 %');
});
