// Page « Raccourcis clavier » (la liste est dans src/shortcutdata.js).
import { esc, html } from './http.js';
import { layout } from './views.js';
import { GO, OTHERS } from './shortcutdata.js';

const kbd = (k) => `<kbd>${esc(k)}</kbd>`;

export function shortcutsPage({ email }) {
  const body = `<div class="bill-page sc-page">
  <section class="card"><h1>Raccourcis clavier</h1>
    <p class="muted">Pour aller plus vite sans la souris. Les raccourcis ne se déclenchent pas quand tu écris dans un champ.</p></section>
  <section class="card" aria-labelledby="sc-go"><h2 id="sc-go">Aller à une page</h2>
    <p class="muted small">Tape ${kbd('g')} puis la lettre, dans la seconde qui suit.</p>
    <table class="sc-table"><caption class="sr-only">Raccourcis pour aller à une page</caption><thead><tr><th scope="col">Touches</th><th scope="col">Page</th></tr></thead><tbody>
      ${GO.map(([k, , label]) => `<tr><td>${kbd('g')} ${kbd(k)}</td><td>${esc(label)}</td></tr>`).join('\n      ')}
    </tbody></table></section>
  <section class="card" aria-labelledby="sc-other"><h2 id="sc-other">Partout</h2>
    <table class="sc-table"><caption class="sr-only">Autres raccourcis</caption><thead><tr><th scope="col">Touches</th><th scope="col">Action</th></tr></thead><tbody>
      ${OTHERS.map(([keys, label]) => `<tr><td>${keys.map(kbd).join(' ou ')}</td><td>${esc(label)}</td></tr>`).join('\n      ')}
    </tbody></table></section>
</div>`;
  return layout({ title: 'Raccourcis clavier', email, body });
}

export function registerShortcutRoutes(router) {
  router.get('/raccourcis', async ({ res, session }) => html(res, shortcutsPage({ email: session.email })));
}
