import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';

// Cookie de préférence « theme » : posé par la personne, lu par le serveur pour écrire <html data-theme>, effacé par « Automatique ».

const html = { headers: { accept: 'text/html' } };
const form = { form: true };

test('le thème choisi est retenu dans un cookie et appliqué à toutes les pages, connexion comprise', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    const r = await u.post('/account/theme', { theme: 'dark' }, form);
    assert.equal(r.status, 303);
    const c = r.headers.getSetCookie().find((x) => x.startsWith('theme='));
    assert.match(c, /^theme=dark;.*Max-Age=31536000/);
    const withCookie = (cookie) => s.client(`${u.cookie}; ${cookie}`);
    assert.match(await (await withCookie('theme=dark').get('/account', html)).text(), /<html lang="fr" data-theme="dark">/);
    assert.match(await (await s.client('theme=light').get('/login', html)).text(), /<html lang="fr" data-theme="light">/);
    assert.doesNotMatch(await (await s.client('theme=pourpre').get('/login', html)).text(), /data-theme/); // valeur inconnue : le système décide
    assert.doesNotMatch(await (await u.get('/account', html)).text(), /data-theme/);
    const page = await (await withCookie('theme=dark').get('/account', html)).text();
    assert.match(page, /id="affichage"[\s\S]*aria-pressed="true"[^>]*>[^<]*(<svg[\s\S]*?<\/svg>)?Sombre/);
    const auto = await u.post('/account/theme', { theme: 'auto' }, form);
    assert.match(auto.headers.getSetCookie().find((x) => x.startsWith('theme=')), /Max-Age=0/);
  } finally { await s.close(); }
});
