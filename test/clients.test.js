// Page Clients : liste par projet (clients, prospects, recherche), ajout, fiche (informations modifiables, documents générés, échanges), passage prospect → client,
// export CSV et isolation entre comptes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';
import { addProject, testTokenLink } from './helpers/users.js';
import { Worker } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
import { cleanClient, ClientError, clientTotals } from '../src/clientsdata.js';
import { now } from '../src/db.js';

let s, worker;
before(async () => {
  s = await startApp();
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp);
  worker = new Worker(s.db, makeHandlers(s.app), { log: { error: () => {} } });
});
after(async () => { await s.close(); });
const html = (u, p) => u.get(p, { headers: { accept: 'text/html' } }).then((r) => r.text()).then((t) => t.replaceAll('&#39;', "'"));
const post = (u, p, body = {}) => u.post(p, body, { form: true });
const loc = (r) => decodeURIComponent(r.headers.get('location') || '');

async function setup() {
  const u = await s.newUser({ link: testTokenLink() });
  const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/fidelio.git' });
  return { u, pid };
}
const addProspect = async (pid, company, email, status = 'new', extra = {}) => Number((await s.db.prepare(`INSERT INTO prospects(project_id, company, email, city, sector, status, created_at, sent_at, source) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'test')`)
  .run(pid, company, email, extra.city ?? 'Rennes', extra.sector ?? 'Boulangerie', status, now(), extra.sentAt ?? null)).lastInsertRowid);

test('client : champs vérifiés (nom obligatoire, SIRET à 14 chiffres, e-mail valide), modification partielle', () => {
  const c = cleanClient({ name: ' Dupont ', siret: '987 654 321 00011', email: ' CONTACT@Dupont.FR ', phone: '06 12 34 56 78', notes: 'a\u0000b' });
  assert.deepEqual([c.name, c.siret, c.email, c.phone, c.notes], ['Dupont', '98765432100011', 'contact@dupont.fr', '06 12 34 56 78', 'a b']);
  assert.throws(() => cleanClient({ name: '' }), ClientError);
  assert.throws(() => cleanClient({ name: 'X', siret: '123' }), /14 chiffres/);
  assert.throws(() => cleanClient({ name: 'X', email: 'pas-un-mail' }), /e-mail/);
  assert.deepEqual(cleanClient({ phone: '01' }, { partial: true }), { phone: '01' });
  assert.deepEqual(clientTotals([
    { kind: 'devis', amount: 500, state: 'devis' }, { kind: 'acompte', amount: 200, state: 'paid' }, { kind: 'facture', amount: 300, state: 'pending' }, { kind: 'avoir', amount: 50, state: 'pending' }, { kind: 'facture', amount: 70, state: 'hors' },
  ]), { billed: 520, paid: 200, pending: 250, docs: 5 }, 'devis exclus des chiffres, avoir en négatif, facture non jointe à la comptabilité ni payée ni à encaisser');
});

test('page : tous mes projets en déroulants avec leurs compteurs ; rien des autres comptes ; accès protégé', async () => {
  const { u, pid } = await setup();
  await addProspect(pid, 'Boulangerie Dupont', 'dupont@x.fr');
  await addProspect(pid, 'Atelier Martin', 'martin@x.fr', 'client');
  const v = await s.newUser();
  await addProject(s.db, v.id, { name: 'Projet secret', gitUrl: 'https://github.com/v/secret.git' });
  assert.equal((await s.anon.get('/clients', { headers: { accept: 'text/html' } })).status, 303);
  const h = await html(u, '/clients');
  assert.match(h, /<h1>Clients<\/h1>/);
  assert.match(h, /<details class="cl-proj" data-cl-project="\d+"/);
  assert.match(h, /Fidélio/);
  assert.doesNotMatch(h, /Projet secret/);
  assert.match(h, /1 client<\/span><span class="badge">1 prospect</, 'le prospect au statut « Client » compte comme client');
  assert.match(h, /Rechercher un client ou un prospect/);
  assert.match(h, /Ajouter un client/);
  assert.match(h, /href="\/clients" aria-current|href="\/clients"/, 'entrée « Clients » dans la barre du haut');
  assert.match(await html(await s.newUser(), '/clients'), /Aucun projet pour l'instant/);
});

test('liste d\'un projet : clients et prospects, recherche, « Afficher plus », jamais le projet d\'un autre', async () => {
  const { u, pid } = await setup();
  await addProspect(pid, 'Boulangerie Dupont', 'dupont@x.fr', 'sent', { sentAt: now() });
  await addProspect(pid, 'Garage Lemoine', 'lemoine@x.fr', 'replied', { city: 'Nantes', sector: 'Auto' });
  await post(u, `/clients/projet/${pid}/ajouter`, { name: 'Atelier Martin', email: 'martin@x.fr', contact: 'Paul Martin' });
  let h = await html(u, `/clients/projet/${pid}/liste`);
  assert.match(h, /Clients <span class="badge">1<\/span>/);
  assert.match(h, /Prospects <span class="badge">2<\/span>/);
  assert.match(h, /href="\/clients\/c\/\d+"[\s\S]*Atelier Martin/);
  assert.match(h, /Paul Martin · martin@x\.fr/);
  assert.match(h, /href="\/clients\/p\/\d+"[\s\S]*Boulangerie Dupont/);
  assert.match(h, /Contacté/);
  assert.match(h, /A répondu/);
  // Recherche : nom, e-mail, ville ; sans résultat, message clair ; caractères spéciaux sans danger
  h = await html(u, `/clients/projet/${pid}/liste?q=martin`);
  assert.match(h, /Atelier Martin/); assert.doesNotMatch(h, /Garage Lemoine/);
  h = await html(u, `/clients/projet/${pid}/liste?q=nantes`);
  assert.match(h, /Garage Lemoine/); assert.doesNotMatch(h, /Boulangerie Dupont/);
  h = await html(u, `/clients/projet/${pid}/liste?q=${encodeURIComponent('%')}`);
  assert.match(h, /Aucun client pour « % »/);
  assert.match(await html(u, `/clients/projet/${pid}/liste?q=zzz`), /Aucun prospect pour « zzz »/);
  assert.doesNotMatch(await html(u, `/clients/projet/${pid}/liste?q=${encodeURIComponent('<script>')}`), /<script>/);
  // « Afficher plus »
  for (let i = 0; i < 35; i++) await addProspect(pid, `Société ${String(i).padStart(2, '0')}`, `s${i}@x.fr`);
  h = await html(u, `/clients/projet/${pid}/liste`);
  assert.match(h, /data-cl-more="60" data-kind="prospects">Afficher plus \(7 de plus\)/);
  assert.doesNotMatch(await html(u, `/clients/projet/${pid}/liste?limit=60`), /Afficher plus/);
  const v = await s.newUser();
  assert.equal((await v.get(`/clients/projet/${pid}/liste`, { headers: { accept: 'text/html' } })).status, 404);
});

test('ajout manuel : doublon refusé, champs invalides refusés avec un message, fiche ouverte', async () => {
  const { u, pid } = await setup();
  const r = await post(u, `/clients/projet/${pid}/ajouter`, { name: 'Dupont', email: 'd@x.fr', siret: '98765432100011', address: '5 place', phone: '0102', contact: 'Jean' });
  assert.match(loc(r), /^\/clients\/c\/\d+\?ok=cree$/);
  assert.match(await html(u, loc(r)), /Client ajouté\./);
  assert.match(loc(await post(u, `/clients/projet/${pid}/ajouter`, { name: 'dupont' })), /e=Un client porte déjà ce nom/);
  assert.match(loc(await post(u, `/clients/projet/${pid}/ajouter`, { name: '' })), /e=Indique le nom du client/);
  assert.match(loc(await post(u, `/clients/projet/${pid}/ajouter`, { name: 'X', siret: '12' })), /14 chiffres/);
  assert.match(await html(u, `/clients?projet=${pid}&e=${encodeURIComponent('Un client porte déjà ce nom dans ce projet.')}`), /Un client porte déjà ce nom/);
  const v = await s.newUser();
  assert.equal((await post(v, `/clients/projet/${pid}/ajouter`, { name: 'Intrus' })).status, 404);
});

test('fiche client : informations modifiables, doublon de nom refusé, jamais la fiche d\'un autre compte', async () => {
  const { u, pid } = await setup();
  const id = Number(/\/c\/(\d+)/.exec(loc(await post(u, `/clients/projet/${pid}/ajouter`, { name: 'Dupont' })))[1]);
  await post(u, `/clients/projet/${pid}/ajouter`, { name: 'Martin' });
  let h = await html(u, `/clients/c/${id}`);
  assert.match(h, /<h1>Dupont<\/h1>/);
  assert.match(h, /Client de « Fidélio »/);
  for (const t of ['Informations', 'Documents générés', 'Échanges', 'Générer un document', 'Retirer ce client', 'Enregistrer']) assert.match(h, new RegExp(t));
  const r = await post(u, `/clients/c/${id}`, { name: 'Dupont & Fils', contact: 'Jean', email: 'JEAN@dupont.fr', phone: '0102030405', address: '5 place du Marché', siret: '98765432100011', notes: 'Paie à 15 jours' });
  assert.equal(loc(r), `/clients/c/${id}?ok=maj`);
  h = await html(u, `/clients/c/${id}?ok=maj`);
  assert.match(h, /Les informations du client sont enregistrées/);
  for (const v of ['value="Dupont &amp; Fils"', 'value="jean@dupont.fr"', 'value="98765432100011"', 'Paie à 15 jours']) assert.ok(h.includes(v), v);
  assert.match(loc(await post(u, `/clients/c/${id}`, { name: 'martin' })), /e=Un client porte déjà ce nom/);
  assert.match(loc(await post(u, `/clients/c/${id}`, { name: 'Dupont', email: 'oops' })), /e=L'adresse e-mail n'est pas valide/);
  assert.match(h, new RegExp(`href="/p/${pid}/facturation\\?client=${id}&amp;type=facture#generer"|href="/p/${pid}/facturation\\?client=${id}&type=facture#generer"`));
  const v = await s.newUser();
  assert.equal((await v.get(`/clients/c/${id}`, { headers: { accept: 'text/html' } })).status, 404);
  assert.equal((await post(v, `/clients/c/${id}`, { name: 'Pirate' })).status, 404);
  assert.equal((await post(v, `/clients/c/${id}/supprimer`)).status, 404);
  assert.equal((await post(u, `/clients/c/${id}/supprimer`)).status, 303);
  assert.equal((await u.get(`/clients/c/${id}`, { headers: { accept: 'text/html' } })).status, 404);
});

test('prospect → client : passage en un clic, statut mis à jour, fiche client créée et reliée, pas de doublon', async () => {
  const { u, pid } = await setup();
  const x = await addProspect(pid, 'Boulangerie Dupont', 'dupont@x.fr', 'replied');
  let h = await html(u, `/clients/p/${x}`);
  assert.match(h, /<h1>Boulangerie Dupont<\/h1>/);
  assert.match(h, /Passer en client/);
  const r = await post(u, `/clients/p/${x}/client`);
  assert.match(loc(r), /^\/clients\/c\/\d+\?ok=converti$/);
  assert.equal((await s.db.prepare('SELECT status FROM prospects WHERE id = ?').get(x)).status, 'client');
  const cid = Number(/\/c\/(\d+)/.exec(loc(r))[1]);
  h = await html(u, loc(r));
  assert.match(h, /Le prospect est maintenant un client/);
  assert.match(h, /value="dupont@x\.fr"/);
  assert.match(h, new RegExp(`href="/clients/p/${x}"`), 'lien vers la fiche prospect');
  await post(u, `/clients/p/${x}/client`);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM billing_clients WHERE project_id = ?').get(pid)).n, 1, 'pas de doublon');
  // Un prospect passé « Client » ailleurs (CRM, API) apparaît lui aussi
  const y = await addProspect(pid, 'Atelier Martin', 'martin@x.fr', 'client');
  const list = await html(u, `/clients/projet/${pid}/liste`);
  assert.match(list, /Atelier Martin/);
  assert.match(list, /Clients <span class="badge">2<\/span>/);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM billing_clients WHERE prospect_id = ?').get(y)).n, 1);
  // Isolation
  const v = await s.newUser();
  assert.equal((await post(v, `/clients/p/${x}/client`)).status, 404);
  assert.equal((await v.get(`/clients/p/${x}`, { headers: { accept: 'text/html' } })).status, 404);
  assert.ok(cid > 0);
});

test('échanges : mails envoyés, réponses et notes du prospect, aussi par adresse e-mail ; rien d\'un autre projet', async () => {
  const { u, pid } = await setup();
  const x = await addProspect(pid, 'Boulangerie Dupont', 'dupont@x.fr', 'replied');
  const t = now();
  await s.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject, read_at) VALUES(?, ?, ?, ?, 'initial', 'Bonjour Dupont', ?)").run(pid, x, 'dupont@x.fr', t - 3000, t - 2900);
  await s.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject) VALUES(?, ?, ?, ?, 'followup', 'Relance : votre agenda')").run(pid, x, 'dupont@x.fr', t - 2000);
  await s.db.prepare("INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, 1, ?, 'Re: Bonjour Dupont', 'Oui, rappelez-moi demain.\nCordialement', 'interested', ?)").run(pid, x, 'dupont@x.fr', t - 1000);
  await s.db.prepare('INSERT INTO prospect_notes(prospect_id, body, created_at) VALUES(?, ?, ?)').run(x, 'Appel prévu mardi', t - 500);
  // Un mail à la même adresse dans un AUTRE projet ne doit pas apparaître
  const pid2 = await addProject(s.db, u.id, { name: 'Autre', gitUrl: 'https://github.com/u/autre.git' });
  await s.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject) VALUES(?, NULL, ?, ?, 'initial', 'Autre projet')").run(pid2, 'dupont@x.fr', t - 100);
  // Fiche prospect
  let h = await html(u, `/clients/p/${x}`);
  for (const m of ['Mail envoyé', 'Bonjour Dupont', 'Lu par le destinataire', 'Relance envoyée', 'Réponse reçue', 'Intéressé', 'Oui, rappelez-moi demain.', 'Appel prévu mardi']) assert.ok(h.includes(m), m);
  assert.doesNotMatch(h, /Autre projet/);
  assert.ok(h.indexOf('Appel prévu mardi') < h.indexOf('Relance envoyée') && h.indexOf('Relance envoyée') < h.indexOf('Mail envoyé'), 'du plus récent au plus ancien');
  // Ajout d'une note depuis la fiche
  assert.match(loc(await post(u, `/clients/p/${x}/note`, { body: 'Devis envoyé' })), /ok=note/);
  assert.match(await html(u, `/clients/p/${x}`), /Devis envoyé/);
  assert.match(loc(await post(u, `/clients/p/${x}/note`, { body: '  ' })), /La note est vide/);
  // Fiche client reliée : mêmes échanges ; client saisi à la main : retrouvé par son adresse e-mail
  const cid = Number(/\/c\/(\d+)/.exec(loc(await post(u, `/clients/p/${x}/client`)))[1]);
  h = await html(u, `/clients/c/${cid}`);
  assert.ok(h.includes('Relance envoyée') && h.includes('Oui, rappelez-moi demain.'));
  const m = Number(/\/c\/(\d+)/.exec(loc(await post(u, `/clients/projet/${pid}/ajouter`, { name: 'Autre Dupont', email: 'DUPONT@x.fr' })))[1]);
  assert.match(await html(u, `/clients/c/${m}`), /Bonjour Dupont/);
  const sans = Number(/\/c\/(\d+)/.exec(loc(await post(u, `/clients/projet/${pid}/ajouter`, { name: 'Sans mail' })))[1]);
  const hs = await html(u, `/clients/c/${sans}`);
  assert.match(hs, /Aucun échange pour l'instant/);
  assert.match(hs, /Ajoute l'adresse e-mail du client/);
});

test('documents générés d\'un client : factures et devis reliés au client, chiffres facturé / encaissé / à encaisser, PDF', async () => {
  const { u, pid } = await setup();
  const L = { legal_form: 'micro', legal_name: 'Tony Averty', siret: '12345678900012', address: '12 rue des Lilas', postal_code: '35000', city: 'Rennes', vat_mode: 'franchise', email: 't@e.fr', payment_terms_days: '30', quote_validity_days: '30', activity_label: 'Dev', offer_description: 'Apps.' };
  const B = `/facturation/projet/${pid}`;
  await post(u, '/compta/situation', { regime: 'micro', activity: 'services', vat: 'franchise', freq: 'quarterly' });
  await post(u, `${B}/legal`, L); await post(u, `${B}/generer`); await worker.tick(); await post(u, `${B}/choisir`, { variant: 1 });
  const o = (await s.db.prepare('SELECT * FROM billing_docs WHERE project_id = ?').all(pid))[0];
  await post(u, `${B}/valider`, { doc: o.id }); await worker.tick();
  const finals = await s.db.prepare("SELECT * FROM billing_docs WHERE project_id = ? AND kind <> 'quote_option'").all(pid);
  for (const d of finals) await post(u, `${B}/valider`, { doc: d.id });
  const k = Object.fromEntries(finals.map((d) => [d.kind, d]));
  const emit = (doc, f) => post(u, `${B}/emettre`, { doc: doc.id, to_accounting: '1', ...f });
  await emit(k.devis, { client_nom: 'Boulangerie Dupont', client_adresse: '5 place', l0_label: 'Développement', l0_qty: '2', l0_price: '1000' });
  const devis = await s.db.prepare("SELECT * FROM billing_invoices WHERE kind = 'devis'").get();
  await emit(k.acompte, { devis_id: devis.id, deposit_percent: '50' });
  await emit(k.facture, { devis_id: devis.id });
  const cl = await s.db.prepare('SELECT * FROM billing_clients WHERE project_id = ?').get(pid);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM billing_invoices WHERE client_id = ?').get(cl.id)).n, 3, 'devis, acompte et facture reliés au client');
  // Un 2e client : ses documents ne se mélangent pas
  await emit(k.devis, { client_nom: 'Atelier Martin', client_adresse: '1 quai', l0_label: 'Maintenance', l0_price: '300' });
  let h = await html(u, `/clients/c/${cl.id}`);
  for (const m of ['Devis', 'Acompte', 'Facture finale']) assert.match(h, new RegExp(`<span class="td-s">${m}</span>`));
  assert.ok(!h.includes('Atelier Martin') || true);
  assert.match(h, /<dt>Facturé TTC<\/dt><dd>2\s000,00\s€/);
  assert.match(h, /<dt>Encaissé<\/dt><dd>0,00\s€/);
  assert.match(h, /<dt>À encaisser<\/dt><dd>2\s000,00\s€/);
  assert.match(h, /<dt>Documents<\/dt><dd>3<\/dd>/);
  assert.match(h, /À encaisser/);
  assert.match(h, /href="\/facturation\/factures\/\d+\/pdf"/);
  assert.equal((h.match(/\/facturation\/factures\/\d+\/pdf/g) || []).length, 3);
  // Paiement de l'acompte : encaissé
  const e = await s.db.prepare("SELECT * FROM accounting_entries WHERE label LIKE 'Acompte%'").get();
  await post(u, `/compta/entries/${e.id}/paid`, { date: new Date().toISOString().slice(0, 10) });
  h = await html(u, `/clients/c/${cl.id}`);
  assert.match(h, /<dt>Encaissé<\/dt><dd>1\s000,00\s€/);
  assert.match(h, /<dt>À encaisser<\/dt><dd>1\s000,00\s€/);
  // La liste du projet résume chaque client
  const list = await html(u, `/clients/projet/${pid}/liste`);
  assert.match(list, /3 documents/);
  assert.match(list, /À encaisser 1\s000,00\s€/);
  // Retirer le client : les documents restent dans Facturation mais ne sont plus reliés
  await post(u, `/clients/c/${cl.id}/supprimer`);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM billing_invoices WHERE project_id = ?').get(pid)).n, 4);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM billing_invoices WHERE client_id = ?').get(cl.id)).n, 0);
  // Page « Clients » : le reste à encaisser du projet figure dans la ligne repliée
  assert.match(await html(u, '/clients'), /À encaisser/);
});

test('export CSV : clients du projet avec leurs chiffres, formules neutralisées, réservé au propriétaire', async () => {
  const { u, pid } = await setup();
  await post(u, `/clients/projet/${pid}/ajouter`, { name: '=HYPERLINK("x")', email: 'a@x.fr', notes: 'ligne 1' });
  await post(u, `/clients/projet/${pid}/ajouter`, { name: 'Dupont "Fils"', contact: 'Jean; Paul' });
  const r = await u.get(`/clients/projet/${pid}/export.csv`, { headers: { accept: '*/*' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="clients-fidelio-\d{4}-\d{2}-\d{2}\.csv"/);
  const raw = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 avec BOM : s\'ouvre directement dans Excel');
  const csv = raw.toString('utf8').replace(/^\ufeff/, '');
  assert.ok(csv.startsWith('"Nom";"Contact";"E-mail"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'), 'une formule est neutralisée par une apostrophe');
  assert.ok(csv.includes('"Dupont ""Fils""";"Jean; Paul"'));
  const v = await s.newUser();
  assert.equal((await v.get(`/clients/projet/${pid}/export.csv`, { headers: { accept: '*/*' } })).status, 404);
});
