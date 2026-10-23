// Équipes : un propriétaire partage des projets, les membres y travaillent comme lui, sans jamais voir autre chose.
// Isolation (aucun accès hors équipe), rôles, invitations liées à l'adresse, places selon l'offre, retrait immédiat.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { now } from '../src/db.js';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { getProject } from '../src/projects.js';
import { ownedTeam } from '../src/teams.js';
import { PLAN_LIMITS } from '../src/limits.js';

const LINK = { v: 1, mode: 'api_key', valid: true };
const HTML = { headers: { accept: 'text/html' } };
let s;
const sent = []; // mails d'invitation : le lien n'existe que là, jamais dans la page du propriétaire
const SYSTEM_SMTP = { host: 'smtp.test', port: 587, user: 'u', pass: 'p', fromEmail: 'noreply@aitools.test' };
before(async () => { s = await startApp({ cfg: { systemSmtp: SYSTEM_SMTP }, createTransport: () => ({ sendMail: async (m) => { sent.push(m); }, close() {} }) }); });
after(async () => { await s.close(); });

const setPlan = (u, plan) => s.db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, u.id);
const form = (u, path, body = {}) => u.post(path, body, { form: true, headers: { accept: 'text/html' } });
const plain = (h) => h.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = async (u, path) => plain(await (await u.get(path, HTML)).text());
const body = async (r) => plain(await r.text());
// Accès refusé : introuvable (404), ou « liaison Claude requise » (403) pour un ancien membre qui n'a pas la sienne. Jamais de données.
const denied = (status) => status === 404 || status === 403;
const row = (sql, ...a) => s.db.prepare(sql).get(...a);

// Un propriétaire (offre Croissance : 3 places) avec une équipe et un projet partagé, plus un membre et un étranger
async function world({ plan = 'growth' } = {}) {
  const owner = await s.newUser({ admin: false, link: LINK });
  await setPlan(owner, plan);
  const member = await s.newUser({ admin: false, link: null });
  const stranger = await s.newUser({ admin: false, link: LINK });
  assert.equal((await form(owner, '/team/create', { name: 'Atelier' })).status, 303);
  const team = await ownedTeam(s.db, owner.id);
  const shared = await addProject(s.db, owner.id, { name: 'Partagé' });
  const priv = await addProject(s.db, owner.id, { name: 'Privé' });
  const other = await addProject(s.db, stranger.id, { name: 'Autre compte' });
  await form(owner, `/team/projects/${shared}/share`, { shared: '1' });
  return { owner, member, stranger, team, shared, priv, other };
}
const invite = async (w, email, role = 'member') => {
  const r = await form(w.owner, '/team/invite', { email, role });
  assert.equal(r.status, 200);
  assert.doesNotMatch(await r.text(), /\/team\/join\//, 'le propriétaire ne voit jamais le lien');
  const mail = sent.at(-1);
  assert.equal(mail.to, email.toLowerCase());
  return /\/team\/join\/([\w-]+)/.exec(mail.text)?.[1];
};
const join = async (u, token) => form(u, `/team/join/${token}`);

test('création : refusée sans place d\'équipe, acceptée avec, une seule par propriétaire', async () => {
  const free = await s.newUser({ admin: false, link: LINK });
  let r = await form(free, '/team/create', { name: 'X' });
  assert.equal(r.status, 400);
  assert.match(await body(r), /ne comprend pas d'équipe/);
  assert.equal(await ownedTeam(s.db, free.id), null);
  assert.match(await text(free, '/team'), /ne comprend pas de place d'équipe/);

  const paid = await s.newUser({ admin: false, link: LINK });
  await setPlan(paid, 'starter');
  assert.equal((await form(paid, '/team/create', { name: 'Mon équipe' })).status, 303);
  r = await form(paid, '/team/create', { name: 'Autre' });
  assert.equal(r.status, 400);
  assert.match(await body(r), /déjà une équipe/);
  assert.equal((await form(paid, '/team/create', { name: '  ' })).status, 400, 'nom requis');
});

test('invitation : le jeton n\'est jamais stocké, il n\'ouvre que pour la bonne adresse et sert une seule fois', async () => {
  const w = await world();
  const token = await invite(w, w.member.email);
  assert.ok(token && token.length >= 20);
  const stored = await row('SELECT * FROM team_invites WHERE email = ?', w.member.email);
  assert.equal(stored.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.ok(!JSON.stringify(await s.db.prepare('SELECT * FROM team_invites').all()).includes(token), 'jamais en clair en base');

  // Quelqu'un d'autre ouvre le lien : refus, aucun accès, l'invitation reste valable pour la bonne personne
  assert.match(await text(w.stranger, `/team/join/${token}`), /destinée à/);
  let r = await join(w.stranger, token);
  assert.equal(r.status, 403);
  assert.equal(await row('SELECT 1 x FROM team_members WHERE user_id = ?', w.stranger.id), undefined);
  assert.ok(denied((await w.stranger.get(`/api/projects/${w.shared}/status`)).status));

  // La page de confirmation (GET) n'accepte rien
  assert.match(await text(w.member, `/team/join/${token}`), /Rejoindre l'équipe/);
  assert.equal(await row('SELECT 1 x FROM team_members WHERE user_id = ?', w.member.id), undefined, 'un simple GET n\'accepte pas');
  r = await join(w.member, token);
  assert.equal(r.status, 303);
  assert.equal((await row('SELECT role FROM team_members WHERE user_id = ?', w.member.id)).role, 'member');
  // Usage unique
  r = await join(w.member, token);
  assert.equal(r.status, 404, 'déjà accepté : l\'invitation n\'existe plus (la page le dit)');
  assert.match(await body(r), /introuvable ou expirée/);
  // Jeton inventé ou expiré
  assert.match(await text(w.member, '/team/join/nimportequoi'), /introuvable ou expirée/);
  const t2 = await invite(w, 'autre@exemple.fr');
  await s.db.prepare('UPDATE team_invites SET expires_at = ? WHERE email = ?').run(now() - 5, 'autre@exemple.fr');
  assert.match(await text(await s.newUser({ admin: false, email: 'autre@exemple.fr', link: null }), `/team/join/${t2}`), /introuvable ou expirée/);
});

test('places : propriétaire + membres + invitations en attente ne dépassent pas l\'offre', async () => {
  const w = await world({ plan: 'starter' }); // 2 places
  assert.equal(PLAN_LIMITS.starter.seats, 2);
  assert.ok(await invite(w, w.member.email));
  const r = await form(w.owner, '/team/invite', { email: 'troisieme@exemple.fr', role: 'member' });
  assert.equal(r.status, 400);
  assert.match(await body(r), /place d'équipe|places d'équipe/);
  assert.equal(await row('SELECT 1 x FROM team_invites WHERE email = ?', 'troisieme@exemple.fr'), undefined);
  // Inviter son propre email, ou quelqu'un déjà membre, est refusé
  assert.equal((await form(w.owner, '/team/invite', { email: w.owner.email })).status, 400);
  assert.equal((await form(w.owner, '/team/invite', { email: 'pas-un-email' })).status, 400);
  assert.equal((await form(w.owner, '/team/invite', { email: w.member.email, role: 'chef' })).status, 400, 'rôle inconnu');
});

test('un membre travaille sur les projets partagés, et sur eux seulement', async () => {
  const w = await world();
  await join(w.member, await invite(w, w.member.email));

  // Tableau de bord : sans liaison Claude propre, le membre n'est pas renvoyé vers /link ; il voit le projet partagé uniquement
  const r = await w.member.get('/', HTML);
  assert.equal(r.status, 200);
  const dash = await r.text();
  assert.match(dash, /Partagé/);
  assert.match(dash, new RegExp(`équipe de ${w.owner.email.replace('.', '\\.')}`));
  assert.doesNotMatch(dash, /Privé|Autre compte/);
  assert.doesNotMatch(dash, /Configuration du projet/, 'pas de configuration pour un membre');
  assert.doesNotMatch(dash, /Supprimer le projet/);

  assert.equal((await w.member.get(`/api/projects/${w.shared}/status`)).status, 200);
  assert.equal((await w.member.get(`/api/projects/${w.shared}/prospects`)).status, 200);
  for (const p of [w.priv, w.other]) {
    assert.equal((await w.member.get(`/api/projects/${p}/status`)).status, 404, `projet ${p} : introuvable`);
    assert.equal((await w.member.post(`/api/projects/${p}/analyze`, {})).status, 404);
    assert.equal((await w.member.get(`/api/projects/${p}/prospects`)).status, 404);
  }
  // Et l'étranger ne voit rien du projet partagé
  assert.equal((await w.stranger.get(`/api/projects/${w.shared}/status`)).status, 404);
  assert.equal((await w.stranger.get(`/api/projects/${w.shared}/prospects.csv`)).status, 404);
  assert.doesNotMatch(await text(w.stranger, '/'), /Partagé/);

  // Le job part au nom du propriétaire : son accès Claude, son plan, son compteur d'usage
  const job = await w.member.post(`/api/projects/${w.shared}/analyze`, {});
  assert.equal(job.status, 200, 'le membre n\'a pas de liaison Claude, celle du propriétaire sert');
  const { id } = await job.json();
  assert.equal(Number((await row('SELECT user_id FROM jobs WHERE id = ?', id)).user_id), w.owner.id);
  assert.equal(Number((await row("SELECT COUNT(*) n FROM usage_events WHERE kind = 'ai_job' AND user_id = ?", w.owner.id)).n), 1);
  assert.equal(Number((await row("SELECT COUNT(*) n FROM usage_events WHERE user_id = ?", w.member.id)).n), 0, 'rien n\'est compté chez le membre');
  assert.ok(((await (await w.member.get('/api/system')).json()).jobs || []).some((j) => j.id === id), 'le job apparaît dans la barre du membre');
  // Il peut l'annuler ; un étranger ne le voit même pas
  assert.equal((await w.stranger.post(`/api/jobs/${id}/cancel`, {})).status, 404);
  assert.equal((await w.member.post(`/api/jobs/${id}/cancel`, {})).status, 200);
  assert.equal((await row('SELECT status FROM jobs WHERE id = ?', id)).status, 'cancelled');
});

test('rôles : un membre ne règle rien, un administrateur règle sans supprimer, le propriétaire seul supprime', async () => {
  const w = await world();
  const admin = await s.newUser({ admin: false, link: null });
  await join(w.member, await invite(w, w.member.email, 'member'));
  await join(admin, await invite(w, admin.email, 'admin'));

  const smtp = { host: 'smtp.exemple.fr', port: 587, user: 'u', pass: 'p', fromEmail: 'a@exemple.fr' };
  assert.equal((await w.member.post(`/api/projects/${w.shared}/smtp`, smtp)).status, 403);
  assert.equal((await w.member.post(`/api/projects/${w.shared}/imap`, { host: 'imap.exemple.fr' })).status, 403);
  assert.equal((await w.member.post(`/api/projects/${w.shared}/db`, {})).status, 403);
  assert.equal((await w.member.get(`/api/projects/${w.shared}/recap`)).status, 403);
  assert.equal((await w.member.post(`/api/projects/${w.shared}/delete`, {})).status, 403);

  assert.equal((await admin.post(`/api/projects/${w.shared}/smtp`, smtp)).status, 200);
  assert.equal((await admin.post(`/api/projects/${w.shared}/delete`, {})).status, 403, 'l\'administrateur ne supprime pas');
  assert.match(await text(admin, '/'), /Configuration du projet/);
  // Le mot de passe saisi n'est jamais relu par l'administrateur
  assert.doesNotMatch(await text(admin, '/'), /value="p"/);

  // Ni l'un ni l'autre ne gère l'équipe
  assert.equal((await form(admin, '/team/invite', { email: 'x@exemple.fr' })).status, 404);
  assert.equal((await form(w.member, '/team/delete')).status, 404);
  assert.equal((await form(admin, `/team/projects/${w.priv}/share`, { shared: '1' })).status, 404);

  assert.equal((await w.owner.post(`/api/projects/${w.shared}/delete`, {})).status, 200);
});

test('retrait, départ, départage et suppression d\'équipe coupent l\'accès tout de suite', async () => {
  const w = await world();
  const second = await s.newUser({ admin: false, link: null });
  await join(w.member, await invite(w, w.member.email));
  await join(second, await invite(w, second.email, 'admin'));
  const ok = async (u) => { const st = (await u.get(`/api/projects/${w.shared}/status`)).status; return st === 200 ? 200 : (assert.ok(denied(st), `statut ${st}`), 404); };
  assert.equal(await ok(w.member), 200);

  // Retirer un membre
  await form(w.owner, `/team/member/${w.member.id}/remove`);
  assert.equal(await ok(w.member), 404);
  assert.equal(await ok(second), 200, 'les autres gardent l\'accès');
  // Quitter l'équipe
  const mine = await row('SELECT team_id FROM team_members WHERE user_id = ?', second.id);
  await form(second, `/team/${mine.team_id}/leave`);
  assert.equal(await ok(second), 404);
  // Une équipe qui n'est pas la sienne ne se quitte pas
  assert.equal((await form(w.stranger, `/team/${mine.team_id}/leave`)).status, 404);

  // Ne plus partager le projet, puis supprimer l'équipe
  await join(w.member, await invite(w, w.member.email));
  assert.equal(await ok(w.member), 200);
  await form(w.owner, `/team/projects/${w.shared}/share`, { shared: '0' });
  assert.equal(await ok(w.member), 404);
  await form(w.owner, `/team/projects/${w.shared}/share`, { shared: '1' });
  assert.equal(await ok(w.member), 200);
  await form(w.owner, '/team/delete');
  assert.equal(await ok(w.member), 404);
  assert.equal(await row('SELECT 1 x FROM team_members WHERE user_id = ?', w.member.id), undefined, 'membres effacés avec l\'équipe');
  assert.equal(await ok(w.owner), 200, 'le propriétaire garde son projet');
  assert.equal((await getProject(s.app, w.shared, { userId: w.owner.id })).teamId, null);
});

test('changement de rôle, et jamais de passe-droit entre équipes', async () => {
  const w = await world();
  await join(w.member, await invite(w, w.member.email));
  const smtp = { host: 'smtp.exemple.fr', port: 587, user: 'u', pass: 'p', fromEmail: 'a@exemple.fr' };
  assert.equal((await w.member.post(`/api/projects/${w.shared}/smtp`, smtp)).status, 403);
  await form(w.owner, `/team/member/${w.member.id}/role`, { role: 'admin' });
  assert.equal((await w.member.post(`/api/projects/${w.shared}/smtp`, smtp)).status, 200);
  assert.equal((await form(w.owner, `/team/member/${w.member.id}/role`, { role: 'roi' })).status, 400);

  // Un membre de l'équipe A ne gagne rien sur l'équipe B
  const ownerB = await s.newUser({ admin: false, link: LINK });
  await setPlan(ownerB, 'starter');
  await form(ownerB, '/team/create', { name: 'B' });
  const pb = await addProject(s.db, ownerB.id, { name: 'Projet B' });
  await form(ownerB, `/team/projects/${pb}/share`, { shared: '1' });
  assert.equal((await w.member.get(`/api/projects/${pb}/status`)).status, 404, 'membre de A : rien sur B');
  // Le propriétaire de B ne peut pas partager le projet de quelqu'un d'autre
  assert.equal((await form(ownerB, `/team/projects/${w.shared}/share`, { shared: '1' })).status, 404);
  assert.equal((await row('SELECT team_id FROM projects WHERE id = ?', w.shared)).team_id, w.team.id, 'inchangé');
});

test('fiches prospects : visibles par l\'équipe, introuvables ailleurs', async () => {
  const w = await world();
  await join(w.member, await invite(w, w.member.email));
  const p = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, 'Acme', 'a@acme.fr', ?)").run(w.shared, now())).lastInsertRowid);
  const q = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, 'Privée', 'b@acme.fr', ?)").run(w.priv, now())).lastInsertRowid);
  assert.equal((await w.member.get(`/api/prospects/${p}`)).status, 200);
  assert.equal((await w.member.post(`/api/prospects/${p}/notes`, { body: 'Rappeler jeudi' })).status, 200);
  assert.equal((await w.member.get(`/api/prospects/${q}`)).status, 404);
  assert.equal((await w.stranger.get(`/api/prospects/${p}`)).status, 404);
  assert.equal((await w.stranger.post(`/api/prospects/${p}/status`, { status: 'refused' })).status, 404);
});

test('supprimer son compte efface l\'équipe, les adhésions et les invitations', async () => {
  const w = await world();
  await join(w.member, await invite(w, w.member.email));
  await invite(w, 'attente@exemple.fr');
  assert.equal((await w.owner.post('/account/delete', { confirm: w.owner.email }, { form: true })).status, 303);
  assert.equal(await row('SELECT 1 x FROM teams WHERE id = ?', w.team.id), undefined);
  assert.equal(await row('SELECT 1 x FROM team_members WHERE team_id = ?', w.team.id), undefined);
  assert.equal(await row('SELECT 1 x FROM team_invites WHERE team_id = ?', w.team.id), undefined);
  assert.ok(denied((await w.member.get(`/api/projects/${w.shared}/status`)).status));
});

test('SMTP du projet : le sien ou rien, et la page l\'explique ; hôte vide = on l\'efface', async () => {
  const u = await s.newUser({ admin: false, link: LINK });
  const p = await addProject(s.db, u.id, { name: 'Boîte propre' });
  const src = async () => (await (await u.get(`/api/projects/${p}/status`)).json()).smtpSource;
  assert.equal(await src(), null);
  assert.match(await text(u, '/'), /Aucun SMTP/);
  assert.doesNotMatch(await text(u, '/'), /SMTP des Réglages|Laisse l'hôte vide/);

  // Il n'y a plus de SMTP « global » dans les Réglages : la page n'en propose plus, et un envoi de formulaire le recevant l'ignore
  assert.doesNotMatch(await text(u, '/settings'), /SMTP global|name="smtp_host"/);
  assert.equal((await form(u, '/settings', { smtp_host: 'smtp.reglages.fr', smtp_port: '587', global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60' })).status, 303);
  assert.equal(await src(), null);

  const own = { host: 'smtp.projet.fr', port: 587, user: 'u', pass: 'p', fromEmail: 'p@exemple.fr', dailyCap: 20 };
  assert.equal((await u.post(`/api/projects/${p}/smtp`, own)).status, 200);
  assert.equal(await src(), 'project');
  assert.match(await text(u, '/'), /depuis son adresse/);

  const r = await u.post(`/api/projects/${p}/smtp`, { host: '', dailyCap: 25 });
  assert.equal((await r.json()).reset, true);
  assert.equal(await src(), null);
  assert.equal(Number((await row('SELECT daily_mail_cap c FROM projects WHERE id = ?', p)).c), 25, 'le plafond du projet reste réglable');
  assert.equal(await row('SELECT smtp_enc FROM projects WHERE id = ?', p).then((x) => x.smtp_enc), null);
});

test('invitation : mail HTML aux couleurs du site, lien seulement dans le mail ; sans mail, pas d\'invitation', async () => {
  const w = await world();
  const before = sent.length;
  const token = await invite(w, w.member.email);
  assert.equal(sent.length, before + 1);
  const mail = sent.at(-1);
  assert.match(mail.html, /<!doctype html>/i);
  assert.ok(mail.html.includes(`/team/join/${token}`), 'bouton et lien de secours');
  assert.match(mail.html, /Rejoindre l(&#39;|')équipe/);
  assert.match(mail.html, /#1e296a/, 'bandeau indigo du logo');
  assert.match(mail.html, /logo-mark-dark\.png/);
  assert.doesNotMatch(mail.html, /#7c4dff|#2f5bea/, 'plus de violet');
  assert.match(mail.text, /\/team\/join\//, 'version texte conservée');
  const again = await form(w.owner, '/team/invite', { email: 'autre@exemple.fr', role: 'member' });
  assert.match(await again.text(), /Invitation envoyée à autre@exemple\.fr/);

  // SMTP du serveur en panne : l'invitation n'est pas créée, et aucun lien n'est montré au propriétaire
  const down = await startApp({ cfg: { systemSmtp: SYSTEM_SMTP }, createTransport: () => ({ sendMail: async () => { throw new Error('connexion refusée'); }, close() {} }) });
  try {
    const owner = await down.newUser({ admin: false, link: LINK });
    await down.db.prepare('UPDATE users SET plan = ? WHERE id = ?').run('growth', owner.id);
    assert.equal((await owner.post('/team/create', { name: 'T' }, { form: true, headers: { accept: 'text/html' } })).status, 303);
    const r = await owner.post('/team/invite', { email: 'x@exemple.fr', role: 'member' }, { form: true, headers: { accept: 'text/html' } });
    assert.equal(r.status, 400);
    const h = await r.text();
    assert.match(h, /n&#39;a pas pu partir|n'a pas pu partir/);
    assert.doesNotMatch(h, /\/team\/join\//);
    assert.equal(await down.db.prepare('SELECT 1 x FROM team_invites').get(), undefined, 'aucune invitation orpheline');
  } finally { await down.close(); }
});
