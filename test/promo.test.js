// Onglet Promotion : état, validation, production d'une vidéo (faux Claude + vrai rendu Chromium/ffmpeg), lecture, suppression, prompt modifiable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync, utimesSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';
import { addProject } from './helpers/users.js';
import { Worker, latestJobs } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
import { setSetting, now } from '../src/db.js';
import { userPromoRoot, deleteUser } from '../src/users.js';
import { PROMO, promoSupported, renderPromo, SceneError } from '../src/services/promovideo.js';
import { PROMPT_DEFS } from '../src/services/prompts.js';
import { reserveVideo, finishVideo, removeVideo, keepScene, takeScene } from '../src/promo.js';
import { projectsHtml } from './helpers/pages.js';

const chromium = process.env.CHROMIUM_BIN || spawnSync('sh', ['-c', 'ls /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1']).stdout.toString().trim() || undefined;
let s, spy, worker;
before(async () => {
  s = await startApp({ cfg: { chromiumBin: chromium } });
  spy = join(s.tmp, 'promo.log');
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'spy-claude.js', env: { PROMPT_SPY_FILE: spy } });
  // Les petites scènes factices vérifient le transport MP4 ; la qualité réelle et les agents ont leurs tests dédiés.
  s.app.renderPromo = renderFixture;
  s.app.reviewPromo = async () => ({ reviews: [{ role: 'layout', approved: true }, { role: 'motion', approved: true }] });
  worker = new Worker(s.db, makeHandlers(s.app), { log: { error: () => {} } });
});
after(async () => { await s.close(); });
const supported = promoSupported({ chromiumBin: chromium });
const renderFixture = (options) => renderPromo({ ...options, quality: 'off' });
const isResearch = (c) => c.prompt.includes("Recherche d'inspiration (outils WebSearch"); // la recherche web faite avant la conception : un appel de plus, sans scène
const calls = () => (existsSync(spy) ? readFileSync(spy, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const PROFILE = JSON.stringify({ resume: 'Cartes de fidélité digitales.', proposition_valeur: 'Fidélisez sans carton.', arguments: ['simple'], ton: 'direct' });
async function setup(opts = {}) {
  const u = await s.newUser(opts);
  const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/fidelio.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(PROFILE, pid);
  return { u, pid };
}
const gen = (u, pid, body) => u.post(`/api/projects/${pid}/promo/generate`, body);
const runJob = async (pid) => { await worker.tick(); return (await latestJobs(s.db, pid)).promo_video; };
// Ces tests ciblent les portes de publication, indépendamment du CLI et de la limite de ligne de commande Windows.
const runQualityJob = async (pid) => {
  const html = '<!doctype html><html><body><script type="application/json" id="voix">[{"t":0.5,"texte":"Bonjour"},{"t":3,"texte":"Au revoir"}]</script><script>window.renderFrame=function(t){};</script></body></html>';
  const local = new Worker(s.db, makeHandlers(s.app, { claude: async () => ({ ok: true, text: html }) }), { log: { error: () => {} } });
  await local.tick();
  return (await latestJobs(s.db, pid)).promo_video;
};

test('état de l\'onglet : limites, formats, aucune vidéo ; section présente dans la page du projet ; prompt éditable dans les Réglages', async () => {
  const { u, pid } = await setup();
  const st = await (await u.get(`/api/projects/${pid}/promo`)).json();
  assert.equal(st.supported, supported.ok);
  assert.equal(st.hasProfile, true);
  assert.deepEqual(st.videos, []);
  assert.deepEqual(st.limits.fps, PROMO.fps);
  assert.deepEqual(st.formats.map((f) => f.id), ['paysage', 'vertical', 'carre']);
  const page = await projectsHtml(u);
  assert.match(page, /data-acc="promo"[\s\S]*Promotion[\s\S]*data-promo[\s\S]*data-job="promo_video"/);
  const settings = await (await u.get('/settings', { headers: { accept: 'text/html' } })).text();
  assert.match(settings, /Vidéo de promotion \(design motion\)/);
  assert.match(settings, /name="prompt_promo"/);
  assert.ok(PROMPT_DEFS.promo.text.length > 850);
  assert.equal((await s.anon.get(`/api/projects/${pid}/promo`)).status, 401);
  const other = await s.newUser();
  assert.equal((await other.get(`/api/projects/${pid}/promo`)).status, 404, 'projet d\'un autre compte');
});

test('lancement : images par seconde, durée et nombre d\'images contrôlés ; projet non analysé et outils absents refusés', async () => {
  const { u, pid } = await setup();
  for (const [b, re] of [[{ fps: 5 }, /entre 10 et 60/], [{ fps: 120 }, /entre 10 et 60/], [{ seconds: 1 }, /entre 3 et 60/], [{ seconds: 90 }, /entre 3 et 60/], [{ fps: 60, seconds: 60 }, /Trop d'images à produire \(3600\)/]]) {
    const r = await gen(u, pid, b);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.match((await r.json()).error, re);
  }
  assert.equal(Number((await s.db.prepare("SELECT COUNT(*) n FROM jobs WHERE type = 'promo_video'").get()).n), 0, 'aucun job pour ces refus');
  const raw = await addProject(s.db, u.id, { name: 'Brut', gitUrl: 'https://github.com/u/brut.git' });
  assert.match((await (await gen(u, raw, {})).json()).error, /Analyse le projet d'abord/);
  s.app.promoSupported = () => ({ ok: false, reason: "Chromium n'est pas installé sur ce serveur (variable CHROMIUM_BIN)." });
  try {
    const r = await gen(u, pid, { fps: 10, seconds: 3 });
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /Chromium/);
    const st = await (await u.get(`/api/projects/${pid}/promo`)).json();
    assert.deepEqual([st.supported, /Chromium/.test(st.reason)], [false, true]);
  } finally { delete s.app.promoSupported; }
  for (let i = 0; i < PROMO.maxVideos; i++) await s.db.prepare("INSERT INTO promo_videos(user_id, project_id, subject, fps, seconds, format, width, height, size, file, created_at) VALUES(?, ?, '', 10, 3, 'carre', 720, 720, 1, 'x.mp4', ?)").run(u.id, pid, now());
  assert.equal((await gen(u, pid, { fps: 10, seconds: 3 })).status, 409, 'plafond de vidéos par compte');
});

test('vidéo complète : sujet transmis, MP4 H.264 de la bonne taille et durée, lecture par morceaux, isolation entre comptes, suppression', { skip: !supported.ok && supported.reason }, async () => {
  const { u, pid } = await setup();
  const other = await s.newUser();
  const n0 = calls().length;
  const r = await gen(u, pid, { subject: 'Les cartes de fidélité', fps: 10, seconds: 3, format: 'carre' });
  assert.equal(r.status, 200, await r.clone().text());
  const job = await runJob(pid);
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.result.attempts, 1);
  const all = calls().slice(n0);
  assert.equal(all.filter(isResearch).length, 1, 'une recherche d\'inspiration avant la conception');
  const c = all.filter((x) => !isResearch(x));
  assert.equal(c.length, 1);
  assert.match(c[0].prompt, /Sujet demandé : « Les cartes de fidélité »/);
  assert.match(c[0].prompt, /3 secondes, à 10 images par seconde, au format carre \(720 × 720 pixels\)/);
  assert.match(c[0].prompt, /window\.renderFrame = function \(t\)/);
  assert.equal(c[0].args[c[0].args.indexOf('--allowedTools') + 1], '', 'Claude n\'a aucun outil autorisé : il écrit seulement la scène');
  assert.match(c[0].args[c[0].args.indexOf('--disallowedTools') + 1], /Bash,Edit,Write/);

  const st = await (await u.get(`/api/projects/${pid}/promo`)).json();
  assert.equal(st.videos.length, 1);
  const v = st.videos[0];
  assert.deepEqual([v.subject, v.fps, v.seconds, v.format, v.width, v.height], ['Les cartes de fidélité', 10, 3, 'carre', 720, 720]);
  const file = join(userPromoRoot(s.app.cfg, u.id), `${v.id}.mp4`);
  assert.ok(existsSync(file) && v.size === readFileSync(file).length);
  const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames:format=duration', '-of', 'json', file]).stdout.toString());
  assert.deepEqual([probe.streams[0].codec_name, probe.streams[0].width, probe.streams[0].nb_frames, Math.round(Number(probe.format.duration))], ['h264', 720, '30', 3]);

  const get = (who, extra = {}, q = '') => who.get(`/api/promo/${v.id}/file${q}`, { headers: { accept: '*/*', ...extra } });
  const full = await get(u);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
  assert.match(full.headers.get('content-disposition'), /^inline; filename="les-cartes-de-fidelite-\d+\.mp4"/);
  assert.equal(Buffer.from(await full.arrayBuffer()).subarray(4, 8).toString(), 'ftyp');
  assert.match((await get(u, {}, '?download=1')).headers.get('content-disposition'), /^attachment/);
  const part = await get(u, { range: 'bytes=0-99' });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await get(other)).status, 404, 'un autre compte ne voit pas la vidéo');
  assert.equal((await get(s.anon)).status, 401);
  assert.equal((await other.post(`/api/projects/${pid}/promo/${v.id}/delete`, {})).status, 404, 'ni ne la supprime');

  assert.equal((await u.post(`/api/projects/${pid}/promo/${v.id}/delete`, {})).status, 200);
  assert.equal(existsSync(file), false);
  assert.deepEqual((await (await u.get(`/api/projects/${pid}/promo`)).json()).videos, []);
});

test('sujet vide : Claude présente le projet ; scène fautive renvoyée une fois à Claude avec l\'erreur, puis acceptée', { skip: !supported.ok && supported.reason }, async () => {
  const { u, pid } = await setup();
  const n0 = calls().length;
  await gen(u, pid, { subject: 'SCENEBAD', fps: 10, seconds: 3, format: 'paysage' });
  const job = await runJob(pid);
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.result.attempts, 2);
  const c = calls().slice(n0).filter((x) => !isResearch(x));
  assert.equal(c.length, 2, 'un seul nouvel essai');
  assert.match(c[1].prompt, /Ta version précédente a été refusée au rendu : La scène doit définir window\.renderFrame/);
  assert.doesNotMatch(c[0].prompt, /refusée au rendu/);
  // sans sujet
  const n1 = calls().length;
  await s.db.prepare("DELETE FROM jobs WHERE project_id = ?").run(pid);
  await gen(u, pid, { fps: 10, seconds: 3 });
  assert.equal((await runJob(pid)).status, 'done');
  assert.match(calls().slice(n1)[0].prompt, /Aucun sujet précisé : la vidéo présente le projet/);
});

test('scène toujours fautive : job en erreur lisible, aucune ligne ni fichier laissés', { skip: !supported.ok && supported.reason }, async () => {
  const { u, pid } = await setup();
  await gen(u, pid, { subject: 'SCENEFOREVER', fps: 10, seconds: 3 });
  const job = await runJob(pid);
  assert.equal(job.status, 'error');
  assert.match(job.error, /La scène écrite par Claude ne passe pas au rendu : La scène doit définir window\.renderFrame/);
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM promo_videos WHERE project_id = ?').get(pid)).n), 0);
  const dir = userPromoRoot(s.app.cfg, u.id);
  // seule la dernière scène reste, pour « Corriger »
  assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], [`scene-${job.id}.html`]);
});

test('« Corriger » : le verdict du contrôle repart chez Claude, seule une scène refusée est corrigeable', { skip: !supported.ok && supported.reason }, async () => {
  const { u, pid } = await setup();
  await gen(u, pid, { subject: 'SCENEFOREVER', fps: 10, seconds: 3 });
  const failed = await runJob(pid);
  assert.equal(failed.status, 'error');
  const n0 = calls().length;
  const reply = await u.post(`/api/jobs/${failed.id}/retry`, { fix: true });
  assert.equal(reply.status, 200);
  const { id } = await reply.json();
  const params = JSON.parse((await s.db.prepare('SELECT params_json FROM jobs WHERE id = ?').get(id)).params_json);
  assert.match(params.fix, /^La scène doit définir window\.renderFrame/);
  assert.equal(params.fixScene, failed.id);
  await worker.tick();
  const c = calls().slice(n0);
  assert.match(c[0].prompt, /Ta version précédente a été refusée au rendu : La scène doit définir window\.renderFrame/, 'la première demande contient déjà le verdict');
  assert.equal(c.length, 2, 'deux essais de correction');
  // une autre erreur ne se corrige pas
  await s.db.prepare("UPDATE jobs SET status = 'error', error = 'Analyse le projet d''abord' WHERE id = ?").run(id);
  assert.equal((await u.post(`/api/jobs/${id}/retry`, { fix: true })).status, 409);
});

test('prompt modifiable dans les Réglages : le texte de l\'utilisateur remplace la direction artistique, le contrat technique reste', async () => {
  const { u, pid } = await setup();
  await setSetting(s.db, u.id, 'prompts_json', JSON.stringify({ '*': { promo: 'Fais une vidéo TRÈS sobre : fond blanc, un seul mot par plan, [[duree]] s.' } }));
  s.app.promoSupported = () => ({ ok: true });
  const fake = [];
  s.app.renderPromo = async (o) => { fake.push(o); return { frames: o.fps * o.seconds, bytes: 10 }; };
  try {
    const n0 = calls().length;
    await gen(u, pid, { fps: 12, seconds: 5, format: 'vertical' });
    const job = await runJob(pid);
    assert.equal(job.status, 'done', job.error);
    const p = calls().slice(n0).find((c) => c.prompt.includes('Contrat technique')).prompt;
    assert.match(p, /Fais une vidéo TRÈS sobre : fond blanc, un seul mot par plan, 5 s\./);
    assert.doesNotMatch(p, /Direction artistique :\n- Remplis l'image/, 'le texte de l\'utilisateur remplace les règles par défaut');
    assert.match(p, /Direction artistique imposée : « [^»]+ »[\s\S]*Couleurs exactes : fond en dégradé #[0-9a-f]{6} → #[0-9a-f]{6}/, 'la direction artistique choisie reste imposée');
    assert.match(p, /Scène de référence[\s\S]*window\.renderFrame=function\(t\)/, 'la scène de référence reste fournie');
    assert.match(p, /Contrat technique \(obligatoire[\s\S]*720 × 1280 pixels[\s\S]*window\.renderFrame/);
    assert.deepEqual([fake[0].fps, fake[0].seconds, fake[0].width, fake[0].height], [12, 5, 720, 1280], 'rendu demandé avec les réglages choisis');
  } finally { delete s.app.promoSupported; s.app.renderPromo = renderFixture; }
});

test('contrôle strict à chaque tentative : trois refus, aucune vidéo livrée même si promoQuality est désactivé', async () => {
  const { u, pid } = await setup();
  const attempts = [];
  s.app.promoSupported = () => ({ ok: true });
  s.app.renderPromo = async (options) => { attempts.push(options.quality); throw new SceneError('Texte coupé à 2 s'); };
  try {
    await gen(u, pid, { fps: 10, seconds: 3 });
    const job = await runQualityJob(pid);
    assert.equal(job.status, 'error');
    assert.match(job.error, /Texte coupé/);
    assert.deepEqual(attempts, ['strict', 'strict', 'strict']);
    assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM promo_videos WHERE project_id = ?').get(pid)).n), 0);
  } finally { delete s.app.promoSupported; s.app.renderPromo = renderFixture; }
});

test('agents du MP4 toujours en refus : la première version est corrigée, la deuxième est livrée avec avertissements', async () => {
  const { u, pid } = await setup();
  const originalReview = s.app.reviewPromo;
  const finals = [];
  s.app.promoSupported = () => ({ ok: true });
  s.app.renderPromo = async () => ({ frames: 30, bytes: 10 });
  s.app.reviewPromo = async (o) => {
    finals.push(o.final);
    if (!o.final) throw new SceneError('Agent montage : texte et voix désynchronisés à 0,8 s');
    return { reviews: [], warnings: [{ reviewer: 'motion', issues: [{ severity: 'major', time: 5.2, problem: 'Texte en retard', fix: 'Avancer' }] }] };
  };
  try {
    await gen(u, pid, { fps: 10, seconds: 3 });
    const job = await runQualityJob(pid);
    assert.equal(job.status, 'done', job.error);
    assert.deepEqual(finals, [false, true]);
    assert.equal(job.result.qualityWarnings[0].issues[0].problem, 'Texte en retard');
    assert.equal((await (await u.get(`/api/projects/${pid}/promo`)).json()).videos.length, 1, 'la vidéo est livrée');
    // la page de suivi sait que la tâche terminée porte des avertissements (boutons Réessayer / Corriger)
    assert.equal((await (await u.get(`/api/jobs/${job.id}/log`)).json()).qualityWarnings, 1);
    // la vidéo livrée avec avertissements se corrige ou se relance depuis la tâche terminée
    const reply = await u.post(`/api/jobs/${job.id}/retry`, { fix: true });
    assert.equal(reply.status, 200);
    const newId = (await reply.json()).id;
    const fixed = JSON.parse((await s.db.prepare('SELECT params_json FROM jobs WHERE id = ?').get(newId)).params_json);
    assert.match(fixed.fix, /^Contrôle du MP4 final refusé : motion : 5\.20 s — Texte en retard Correction : Avancer/);
    assert.equal(fixed.fixScene, job.id);
    assert.equal(existsSync(join(userPromoRoot(s.app.cfg, u.id), `scene-${job.id}.html`)), true, 'dernière scène gardée pour Corriger');
    await s.db.prepare("DELETE FROM jobs WHERE id = ?").run(newId);
    // une tâche terminée sans avertissement ne se relance pas
    await s.db.prepare("UPDATE jobs SET result_json = '{}' WHERE id = ?").run(job.id);
    assert.equal((await u.post(`/api/jobs/${job.id}/retry`, {})).status, 409);
  } finally { delete s.app.promoSupported; s.app.renderPromo = renderFixture; s.app.reviewPromo = originalReview; }
});

test('contrôle des agents en erreur à chaque tentative (hors simple refus) : correction bornée, jamais marqué prêt', async () => {
  const { u, pid } = await setup();
  const originalReview = s.app.reviewPromo;
  let reviews = 0;
  s.app.promoSupported = () => ({ ok: true });
  s.app.renderPromo = async () => ({ frames: 30, bytes: 10 });
  s.app.reviewPromo = async () => { reviews++; throw new SceneError('Agent montage : texte et voix désynchronisés à 1 s'); };
  try {
    await gen(u, pid, { fps: 10, seconds: 3 });
    const job = await runQualityJob(pid);
    assert.equal(job.status, 'error');
    assert.equal(reviews, 3);
    assert.match(job.error, /désynchronisés/);
    assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM promo_videos WHERE project_id = ?').get(pid)).n), 0);
  } finally { delete s.app.promoSupported; s.app.renderPromo = renderFixture; s.app.reviewPromo = originalReview; }
});

test('fichier déjà rendu mais pas encore approuvé : absent de la liste et inaccessible', async () => {
  const { u, pid } = await setup();
  const pending = await reserveVideo(s.app, { userId: u.id, projectId: pid, subject: 'Contrôle', fps: 10, seconds: 3, format: 'carre', width: 720, height: 720 });
  writeFileSync(pending.path, Buffer.from('MP4 EN ATTENTE DE CONTROLE'));
  try {
    assert.deepEqual((await (await u.get(`/api/projects/${pid}/promo`)).json()).videos, []);
    assert.equal((await u.get(`/api/promo/${pending.id}/file`)).status, 404);
    assert.equal((await u.get(`/api/promo/${pending.id}/file?download=1`)).status, 404);
    await finishVideo(s.db, pending.id, readFileSync(pending.path).length);
    assert.equal((await (await u.get(`/api/projects/${pid}/promo`)).json()).videos.length, 1);
    assert.equal((await u.get(`/api/promo/${pending.id}/file`)).status, 200);
  } finally { await removeVideo(s.app, { id: pending.id, user_id: u.id }); }
});

for (const failure of ['overflow', 'shift']) test(`voix ${failure} : trois corrections puis refus avant rendu`, async () => {
  const { u, pid } = await setup();
  let prepared = 0;
  let rendered = 0;
  s.app.promoSupported = () => ({ ok: true });
  s.app.prepareVoice = async ({ segments }) => {
    prepared++;
    return { overflow: failure === 'overflow' ? 0.3 : 0, placed: segments.map((part, i) => ({ ...part, dur: 1, start: part.t + (failure === 'shift' && i === 1 ? 0.3 : 0) })) };
  };
  s.app.renderPromo = async () => { rendered++; return { frames: 60, bytes: 10 }; };
  try {
    const response = await gen(u, pid, { fps: 10, seconds: 6, voice: true, voiceProvider: 'google', voiceName: 'fr' });
    assert.equal(response.status, 200, await response.clone().text());
    const job = await runQualityJob(pid);
    assert.equal(job.status, 'error');
    assert.match(job.error, failure === 'overflow' ? /La voix dure/ : /Désynchronisation voix\/texte/);
    assert.equal(prepared, 3);
    assert.equal(rendered, 0);
    assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM promo_videos WHERE project_id = ?').get(pid)).n), 0);
  } finally { delete s.app.promoSupported; delete s.app.prepareVoice; s.app.renderPromo = renderFixture; }
});

test('supprimer le projet efface ses vidéos ; supprimer le compte efface le dossier', { skip: !supported.ok && supported.reason }, async () => {
  const { u, pid } = await setup();
  await gen(u, pid, { subject: 'x', fps: 10, seconds: 3 });
  assert.equal((await runJob(pid)).status, 'done');
  const [v] = (await (await u.get(`/api/projects/${pid}/promo`)).json()).videos;
  const file = join(userPromoRoot(s.app.cfg, u.id), `${v.id}.mp4`);
  assert.ok(existsSync(file));
  assert.equal((await u.post(`/api/projects/${pid}/delete`, {})).status, 200);
  assert.equal(existsSync(file), false, 'fichier supprimé avec le projet');
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM promo_videos WHERE id = ?').get(v.id)).n), 0);
  const p2 = await addProject(s.db, u.id, { name: 'Autre', gitUrl: 'https://github.com/u/autre.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(PROFILE, p2);
  await gen(u, p2, { fps: 10, seconds: 3 });
  assert.equal((await runJob(p2)).status, 'done');
  assert.ok(existsSync(userPromoRoot(s.app.cfg, u.id)));
  await deleteUser(s.app, u.id);
  assert.equal(existsSync(userPromoRoot(s.app.cfg, u.id)), false, 'dossier du compte supprimé');
});

test('scènes gardées pour « Corriger » : relues puis effacées, et celles de plus de 7 jours ne s\'accumulent pas', async () => {
  const { u } = await setup();
  const dir = userPromoRoot(s.app.cfg, u.id);
  mkdirSync(dir, { recursive: true });
  const old = join(dir, 'scene-901.html');
  writeFileSync(old, '<html>ancienne</html>');
  const ancient = (Date.now() - 8 * 86_400_000) / 1000;
  utimesSync(old, ancient, ancient);
  keepScene(s.app.cfg, u.id, 902, '<html>récente</html>');
  assert.equal(existsSync(old), false, 'la scène de plus de 7 jours est effacée');
  assert.equal(takeScene(s.app.cfg, u.id, 902), '<html>récente</html>');
  assert.equal(existsSync(join(dir, 'scene-902.html')), false, 'effacée après lecture');
  assert.equal(takeScene(s.app.cfg, u.id, 902), '', 'rien à relire');
});
