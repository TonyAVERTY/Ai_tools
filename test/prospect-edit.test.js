// Prospects : ajout manuel, modification, suppression, et aperçu du mail. Accès, validation, doublons, liste d'opposition, plafond du plan, isolation des comptes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject, testTokenLink } from './helpers/users.js';
import { now } from '../src/db.js';
import { PLAN_LIMITS } from '../src/limits.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

async function setup(opts = {}) {
  const u = await s.newUser(opts);
  const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/fidelio.git' });
  return { u, pid };
}
const add = (u, pid, body) => u.post(`/api/projects/${pid}/prospects`, body);
const row = (id) => s.db.prepare('SELECT * FROM prospects WHERE id = ?').get(id);
const mk = async (pid, o = {}) => Number((await s.db.prepare('INSERT INTO prospects(project_id, company, email, status, created_at, hook, city) VALUES(?, ?, ?, ?, ?, ?, ?)')
  .run(pid, o.company || 'Boulangerie', o.email || `b${Math.random().toString(36).slice(2, 8)}@exemple.fr`, o.status || 'new', now(), o.hook ?? null, o.city ?? null)).lastInsertRowid);

test('ajout manuel : champs nettoyés, origine renseignée, nom par défaut = domaine de l\'adresse', async () => {
  const { u, pid } = await setup();
  const r = await add(u, pid, { company: '  Le  Fournil ', email: ' Contact@LeFournil.FR ', website: 'lefournil.fr', city: 'Rennes', sector: 'boulangerie', score: '8', hook: 'Pain au levain.' });
  assert.equal(r.status, 200);
  const p = await row((await r.json()).id);
  assert.deepEqual([p.company, p.email, p.website, p.city, p.sector, p.score, p.hook, p.status, Number(p.project_id)], ['Le Fournil', 'contact@lefournil.fr', 'https://lefournil.fr', 'Rennes', 'boulangerie', 8, 'Pain au levain.', 'new', pid]);
  assert.match(p.source, /^Ajout manuel du \d{2}\/\d{2}\/\d{4}$/, 'RGPD : l\'origine de la donnée est toujours renseignée');
  const min = await row((await (await add(u, pid, { email: 'hello@atelier.example' })).json()).id);
  assert.deepEqual([min.company, min.website, min.score], ['atelier.example', null, null]);
  const withSource = await row((await (await add(u, pid, { email: 'a@b.fr', source: 'https://b.fr/contact' })).json()).id);
  assert.equal(withSource.source, 'https://b.fr/contact');
  assert.equal((await (await u.get(`/api/projects/${pid}/prospects`)).json()).rows.length, 3, 'le prospect apparaît dans la liste');
});

test('ajout manuel : refus clairs (email, site, score), doublon et liste d\'opposition sans rien révéler', async () => {
  const { u, pid } = await setup();
  const bad = async (body, re) => { const r = await add(u, pid, body); assert.equal(r.status, 400, JSON.stringify(body)); assert.match((await r.json()).error, re); };
  await bad({ company: 'X' }, /email invalide/i);
  await bad({ email: 'pas-un-email' }, /email invalide/i);
  await bad({ email: 'a@b.fr', score: '11' }, /Score : un nombre de 1 à 10/);
  await bad({ email: 'a@b.fr', score: 'beaucoup' }, /Score/);
  await bad({ email: 'a@b.fr', website: 'javascript:alert(1)' }, /Adresse du site invalide/);
  assert.equal((await add(u, pid, { email: 'ok@b.fr' })).status, 200);
  const dup = await add(u, pid, { email: 'OK@b.fr' });
  assert.equal(dup.status, 409);
  const dupMsg = (await dup.json()).error;
  await s.db.prepare("INSERT INTO blacklist(email, reason, created_at) VALUES('refus@b.fr', 'refused', ?)").run(now());
  const opt = await add(u, pid, { email: 'refus@b.fr' });
  assert.equal(opt.status, 409);
  assert.equal((await opt.json()).error, dupMsg, 'même message : la liste d\'opposition commune ne révèle aucune adresse');
  // même adresse dans un autre projet du même compte : permise (un prospect par projet)
  const other = await addProject(s.db, u.id, { name: 'Autre', gitUrl: 'https://github.com/u/autre.git' });
  assert.equal((await add(u, other, { email: 'ok@b.fr' })).status, 200);
});

test('ajout manuel : plafond de prospects du plan, accès réservé au projet (autre compte = introuvable), membre d\'équipe autorisé', async () => {
  const { u, pid } = await setup({ admin: false, link: testTokenLink() }); // offre gratuite (plafonds réels), liaison Claude valide
  await s.db.prepare("UPDATE users SET plan = 'free' WHERE id = ?").run(u.id);
  for (let i = 0; i < PLAN_LIMITS.free.prospects; i++) await mk(pid, { email: `p${i}@lim.fr` });
  const full = await add(u, pid, { email: 'un-de-trop@lim.fr' });
  assert.equal(full.status, 403);
  assert.match((await full.json()).error, /Le prospect n'a pas été ajouté/);
  const stranger = await s.newUser();
  assert.equal((await add(stranger, pid, { email: 'x@y.fr' })).status, 404);
  assert.equal((await s.anon.post(`/api/projects/${pid}/prospects`, { email: 'x@y.fr' })).status, 401);
  // équipe : un membre ajoute des contacts sur un projet partagé
  const owner = await s.newUser(), member = await s.newUser({ admin: false });
  const shared = await addProject(s.db, owner.id, { name: 'Partagé', gitUrl: 'https://github.com/u/partage.git' });
  const team = Number((await s.db.prepare("INSERT INTO teams(owner_id, name, created_at) VALUES(?, 'T', ?)").run(owner.id, now())).lastInsertRowid);
  await s.db.prepare("INSERT INTO team_members(team_id, user_id, role, created_at) VALUES(?, ?, 'member', ?)").run(team, member.id, now());
  await s.db.prepare('UPDATE projects SET team_id = ? WHERE id = ?').run(team, shared);
  assert.equal((await add(member, shared, { email: 'equipe@y.fr' })).status, 200);
});

test('modification : champs modifiables, effacer un champ, email seulement tant que personne n\'a été contacté', async () => {
  const { u, pid } = await setup();
  const id = await mk(pid, { company: 'Ancien', email: 'ancien@x.fr', city: 'Nantes' });
  const up = (b, who = u, pid2 = id) => who.post(`/api/prospects/${pid2}/update`, b);
  assert.equal((await up({ company: ' Nouveau  nom ', city: '', sector: 'coiffure', score: 6, website: 'https://nouveau.fr', hook: 'Nouvelle accroche', source: 'Page contact' })).status, 200);
  let p = await row(id);
  assert.deepEqual([p.company, p.city, p.sector, p.score, p.website, p.hook, p.source, p.email], ['Nouveau nom', null, 'coiffure', 6, 'https://nouveau.fr', 'Nouvelle accroche', 'Page contact', 'ancien@x.fr']);
  assert.equal((await up({ email: 'Nouveau@X.fr' })).status, 200);
  assert.equal((await row(id)).email, 'nouveau@x.fr', 'adresse modifiable tant que le prospect est « À contacter »');
  const other = await mk(pid, { email: 'pris@x.fr' });
  assert.equal((await up({ email: 'pris@x.fr' })).status, 409);
  assert.equal((await up({ company: '' })).status, 400);
  assert.equal((await up({})).status, 400);
  assert.equal((await up({ score: 99 })).status, 400);
  await s.db.prepare("UPDATE prospects SET status = 'sent' WHERE id = ?").run(other);
  const locked = await up({ email: 'autre@x.fr' }, u, other);
  assert.equal(locked.status, 400);
  assert.match((await locked.json()).error, /ne peut plus être modifiée une fois le prospect contacté/);
  assert.equal((await up({ company: 'Renommé' }, u, other)).status, 200, 'les autres champs restent modifiables après contact');
  const stranger = await s.newUser();
  assert.equal((await up({ company: 'Piraté' }, stranger)).status, 404);
  assert.equal((await row(id)).company, 'Nouveau nom');
});

test('suppression : le prospect et ses notes disparaissent, le journal d\'envoi reste (détaché) ; un autre compte ne peut rien supprimer', async () => {
  const { u, pid } = await setup();
  const id = await mk(pid, { email: 'a-supprimer@x.fr', status: 'sent' });
  await s.db.prepare("INSERT INTO prospect_notes(prospect_id, body, created_at) VALUES(?, 'une note', ?)").run(id, now());
  await s.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject) VALUES(?, ?, 'a-supprimer@x.fr', ?, 'initial', 'Objet')").run(pid, id, now());
  const stranger = await s.newUser();
  assert.equal((await stranger.post(`/api/prospects/${id}/delete`, {})).status, 404);
  assert.ok(await row(id));
  assert.equal((await u.post(`/api/prospects/${id}/delete`, {})).status, 200);
  assert.equal(await row(id), undefined);
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM prospect_notes WHERE prospect_id = ?').get(id)).n), 0);
  const log = await s.db.prepare("SELECT prospect_id FROM mail_log WHERE email = 'a-supprimer@x.fr'").get();
  assert.equal(log.prospect_id, null, 'le mail envoyé reste dans le journal');
  assert.equal((await u.post(`/api/prospects/${id}/delete`, {})).status, 404, 'déjà supprimé');
});

// ---------- aperçu ----------
const prev = (u, pid, b) => u.post(`/api/projects/${pid}/template/preview`, b);

test('aperçu : le mail tel qu\'il part (De, À, objet, corps HTML et texte), exemple fictif sans prospect, rien n\'est envoyé ni enregistré', async () => {
  const { u, pid } = await setup();
  const plain = await (await prev(u, pid, { kind: 'initial', subject: 'S', body: 'Bonjour {{entreprise}}.' })).json();
  assert.equal(plain.html, false, 'texte simple par défaut : pas de version HTML');
  assert.equal(plain.url, null);
  const r = await prev(u, pid, { kind: 'initial', subject: 'Idée pour {{entreprise}}', body: 'Bonjour {{entreprise}} à {{ville}}.\n\n{{accroche}}\n\n{{expediteur}}', html: 'on' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.sample, true);
  assert.equal(d.subject, 'Idée pour Boulangerie Le Fournil');
  assert.match(d.text, /Bonjour Boulangerie Le Fournil à Rennes\./);
  assert.match(d.text, /Vous recevez ce message car l'adresse contact@lefournil\.exemple est publiée publiquement/);
  assert.match(d.text, /Pour ne plus être contacté : https:\/\/ai\.tony-averty\.dev\/u\/exemple/);
  assert.match(d.note, /Exemple fictif/);
  assert.ok(d.warnings.some((w) => /Aucune adresse d'envoi/.test(w)));
  // le HTML est servi dans un cadre isolé, à son auteur seulement
  const h = await u.get(d.url, { headers: { accept: 'text/html' } });
  assert.equal(h.status, 200);
  assert.equal(h.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(h.headers.get('content-security-policy'), /default-src 'none'; style-src 'unsafe-inline'[^;]*; img-src data:; frame-ancestors 'self'/);
  assert.match(await h.text(), /Bonjour Boulangerie Le Fournil à Rennes\.[\s\S]*Ne plus recevoir de messages/);
  const stranger = await s.newUser();
  assert.equal((await stranger.get(d.url, { headers: { accept: 'text/html' } })).status, 404, 'un autre compte ne lit pas l\'aperçu');
  assert.equal((await s.anon.get(d.url)).status, 401);
  assert.equal((await stranger.post(`/api/projects/${pid}/template/preview`, { body: 'x' })).status, 404, 'ni sur le projet d\'un autre');
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM mail_log WHERE project_id = ?').get(pid)).n), 0, 'aucun envoi');
});

test('aperçu avec un vrai prospect : ses données, son lien de désinscription ; objet B ; relance ; avertissements', async () => {
  const { u, pid } = await setup();
  const id = await mk(pid, { company: 'Coiffure Zen', email: 'zen@coiffure.fr', city: 'Vern', hook: null });
  const d = await (await prev(u, pid, { kind: 'initial', subject: 'A : {{entreprise}}', subjectB: 'B : {{entreprise}}', variant: 'B', prospectId: id, body: 'Salut {{entreprise}} {{accroche}} {{inconnue}}' })).json();
  assert.equal(d.sample, false);
  assert.equal(d.variant, 'B');
  assert.equal(d.hasB, true);
  assert.equal(d.subject, 'B : Coiffure Zen');
  assert.equal(d.to, 'zen@coiffure.fr');
  assert.match(d.text, /\/u\/zen%40coiffure\.fr\/[\w-]+/, 'lien de désinscription réel de CE prospect');
  assert.ok(d.warnings.some((w) => /\{\{inconnue\}\} n'existe pas/.test(w)));
  assert.ok(d.warnings.some((w) => /n'a pas d'accroche/.test(w)));
  // objet A par défaut
  assert.equal((await (await prev(u, pid, { subject: 'A : {{entreprise}}', subjectB: 'B', prospectId: id, body: 'x' })).json()).subject, 'A : Coiffure Zen');
  // relance : objet vide = « Re: » + objet du premier mail
  await s.db.prepare("INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'initial', 'Idée pour {{entreprise}}', 'corps', 'validated', ?)").run(pid, now());
  const f = await (await prev(u, pid, { kind: 'followup', subject: '', body: 'Petite relance {{entreprise}}', prospectId: id })).json();
  assert.equal(f.subject, 'Re: Idée pour Coiffure Zen');
  assert.equal(f.hasB, false);
  // refus
  assert.equal((await prev(u, pid, { body: '   ' })).status, 400);
  const other = await addProject(s.db, u.id, { name: 'Autre', gitUrl: 'https://github.com/u/autre.git' });
  assert.equal((await prev(u, other, { body: 'x', prospectId: id })).status, 404, 'un prospect d\'un autre projet n\'est pas prévisualisable ici');
});
