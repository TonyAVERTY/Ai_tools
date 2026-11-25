// Langue des contenus d'un projet (celle dans laquelle l'IA s'adresse aux prospects et aux clients) et consignes dans la langue du site.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { withLang } from '../src/i18n/index.js';
import { withContentLang } from '../src/services/contentlang.js';
import { defaultText, instructions, linkedinPostPrompt, templatePrompt, promptsView, parseCustomPrompts, PROMPT_DEFS } from '../src/services/prompts.js';
import { buildProspectMail } from '../src/services/mailer.js';
import { styleProblems } from '../src/services/mailcheck.js';
import { unsubToken } from '../src/crypto.js';
import { testTokenLink } from './helpers/users.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const profile = { resume: 'Cartes de fidélité', cibles: ['Commerces'] };

test('création d\'un projet : la langue des contenus est choisie, français par défaut, une langue inconnue est refusée', async () => {
  const u = await s.newUser({ admin: false, link: testTokenLink() });
  const mk = (name, extra) => u.post('/api/projects', { name, gitUrl: `https://github.com/o/${name}.git`, ...extra });
  const a = await (await mk('un')).json();
  const b = await (await mk('deux', { content_lang: 'en' })).json();
  assert.equal((await s.db.prepare('SELECT content_lang l FROM projects WHERE id = ?').get(a.id)).l, 'fr');
  assert.equal((await s.db.prepare('SELECT content_lang l FROM projects WHERE id = ?').get(b.id)).l, 'en');
  assert.equal((await mk('trois', { content_lang: 'de' })).status, 400);
});

test('changer la langue des contenus : le propriétaire peut, un autre compte reçoit 404, une valeur inconnue 400', async () => {
  const u = await s.newUser({ admin: false, link: testTokenLink() });
  const other = await s.newUser({ admin: false, link: testTokenLink() });
  const id = (await (await u.post('/api/projects', { name: 'p', gitUrl: 'https://github.com/o/p.git' })).json()).id;
  assert.equal((await u.post(`/api/projects/${id}/content-lang`, { content_lang: 'es' })).status, 200);
  assert.equal((await s.db.prepare('SELECT content_lang l FROM projects WHERE id = ?').get(id)).l, 'es');
  assert.equal((await u.post(`/api/projects/${id}/content-lang`, { content_lang: 'xx' })).status, 400);
  assert.equal((await other.post(`/api/projects/${id}/content-lang`, { content_lang: 'en' })).status, 404);
  const page = await (await fetch(`${s.base}/p/${id}/reglages`, { headers: { cookie: u.cookie, accept: 'text/html' } })).text();
  assert.match(page, /name="content_lang"[\s\S]*<option value="es" selected>Español<\/option>/);
});

test('consignes : écrites dans la langue du site ; la langue de la RÉPONSE suit le projet pour ce qui s\'adresse aux clients', () => {
  for (const k of Object.keys(PROMPT_DEFS)) {
    assert.notEqual(defaultText(k, null, 'en'), defaultText(k, null, 'fr'), `${k} : version anglaise`);
    assert.notEqual(defaultText(k, null, 'es'), defaultText(k, null, 'fr'), `${k} : version espagnole`);
    for (const fam of ['haiku', 'sonnet', 'opus', 'fable']) if (PROMPT_DEFS[k].byModel?.[fam]) assert.notEqual(defaultText(k, fam, 'en'), defaultText(k, fam, 'fr'));
  }
  // même [[valeurs]] dans les trois langues : un texte traduit ne perd aucune valeur calculée
  const vars = (t) => [...new Set(t.match(/\[\[\w+\]\]/g) || [])].sort().join();
  for (const k of Object.keys(PROMPT_DEFS)) for (const l of ['en', 'es']) assert.equal(vars(defaultText(k, null, l)), vars(defaultText(k, null, 'fr')), `${k} ${l}`);
  // site en anglais, contenus du projet en espagnol : consignes anglaises, réponse demandée en espagnol
  withLang('en', () => withContentLang('es', () => {
    const p = linkedinPostPrompt({ profile, target: {}, author: 'Tony', custom: {} });
    assert.match(p.system, /^You work for an internal tool\. Answer in Spanish\./);
    assert.match(p.prompt, /Write ONE LinkedIn post, in Spanish, published by Tony/);
    const t = templatePrompt({ profile, target: {}, senderName: 'Tony', custom: {} });
    assert.match(t.prompt, /Hola,/, 'la salutation est celle de la langue des contenus');
  }));
  // site en français, contenus en anglais : consignes françaises, réponse en anglais
  withLang('fr', () => withContentLang('en', () => {
    const p = linkedinPostPrompt({ profile, target: {}, author: 'Tony', custom: {} });
    assert.match(p.system, /^Tu travailles pour un outil interne\. Réponds en anglais\./);
    assert.match(p.prompt, /Rédige UN post LinkedIn, en anglais, publié par Tony/);
    assert.match(templatePrompt({ profile, target: {}, senderName: 'Tony', custom: {} }).prompt, /Hello,/);
  }));
});

test('Réglages → Prompts : le texte affiché est dans la langue du site ; un texte par défaut n\'est jamais enregistré comme personnalisé', () => {
  const view = (lang) => withLang(lang, () => promptsView(parseCustomPrompts('{}'), {}, 'claude'));
  assert.match(view('en').tasks.find((t) => t.key === 'hook').scopes['*'].text, /^Write ONE personalised hook/);
  assert.match(view('es').tasks.find((t) => t.key === 'hook').scopes['*'].text, /^Redacta UN gancho personalizado/);
  assert.match(view('fr').tasks.find((t) => t.key === 'hook').scopes['*'].text, /^Rédige UNE accroche personnalisée/);
  // la personne enregistre sans rien changer, depuis un site en anglais : rien n'est « personnalisé »
  const en = withLang('en', () => defaultText('hook'));
  assert.deepEqual(withLang('en', () => parseCustomPrompts({ '*': { hook: en } })), {});
  assert.deepEqual(withLang('fr', () => parseCustomPrompts({ '*': { hook: en } })), {}, 'le texte par défaut anglais reste un défaut, même vu depuis le français');
  // un texte écrit par la personne est gardé tel quel
  assert.deepEqual(parseCustomPrompts({ '*': { hook: 'Mon propre prompt' } }), { '*': { hook: 'Mon propre prompt' } });
  assert.equal(withLang('es', () => instructions('hook', { '*': { hook: 'Mon propre prompt' } }, { entreprise: 'X', site: 'y' })), 'Mon propre prompt');
});

test('mails : pied de page et lien de désinscription dans la langue du projet (celle du destinataire)', () => {
  const base = { template: { subject: 'S', body: 'Hello,\n\nText\n\nKind regards,\nTony' }, prospect: { email: 'a@b.fr', company: 'C', source: 'https://b.fr' }, smtp: { fromEmail: 'x@y.fr', fromName: 'Tony' }, unsubUrl: 'https://app.test/u/a/b?l=en', html: true };
  const en = buildProspectMail({ ...base, lang: 'en' });
  assert.match(en.text, /You are receiving this message because the address a@b\.fr is publicly published \(https:\/\/b\.fr\)\./);
  assert.match(en.text, /To stop being contacted : https:\/\/app\.test\/u\/a\/b\?l=en/);
  assert.match(en.html, /<html lang="en">/); assert.match(en.html, />Stop receiving messages</);
  assert.match(buildProspectMail({ ...base, lang: 'es' }).text, /Recibes este mensaje porque la dirección a@b\.fr está publicada públicamente/);
  assert.match(buildProspectMail({ ...base }).text, /Vous recevez ce message car l'adresse a@b\.fr est publiée publiquement/);
});

test('contrôle de forme d\'un mail : la formule d\'appel et la politesse sont celles de la langue du projet', () => {
  assert.deepEqual(styleProblems('Hello,\n\nA text.\n\nKind regards,\nTony', 'en'), []);
  assert.deepEqual(styleProblems('Hola,\n\nUn texto.\n\nUn saludo,\nTony', 'es'), []);
  assert.deepEqual(styleProblems('Bonjour,\n\nUn texte.\n\nBien cordialement,\nTony', 'fr'), []);
  assert.match(styleProblems('Hello,\n\nA text.\n\nKind regards,\nTony', 'fr').join(' '), /formule de politesse/, 'une politesse anglaise n\'est pas celle d\'un projet français');
  assert.match(styleProblems('Bonjour,\n\nUn texte.\n\nBien cordialement,\nTony', 'en').join(' '), /formule de politesse|formule d'appel/, 'et inversement');
  assert.match(styleProblems('Text only.\n\nBye', 'en').join(' '), /« Hello, »/);
});

test('page de désinscription : dans la langue du mail reçu (?l=), français sinon, valeur inconnue ignorée', async () => {
  const email = 'cible@exemple.fr';
  const token = unsubToken(s.app.cfg.secretKey, email);
  const get = async (q) => (await fetch(`${s.base}/u/${encodeURIComponent(email)}/${token}${q}`, { headers: { accept: 'text/html' } })).text();
  assert.match(await get(''), /Ne plus recevoir de messages à/);
  assert.match(await get('?l=en'), /Stop receiving messages at/);
  assert.match(await get('?l=es'), /¿Dejar de recibir mensajes en/);
  assert.match(await get('?l=<script>'), /Ne plus recevoir de messages à/);
});
