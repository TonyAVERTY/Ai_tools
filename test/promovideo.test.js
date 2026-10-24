// Vidéo de promotion : paramètres, extraction et contrôle de la scène écrite par Claude, rendu réel (Chromium + ffmpeg) quand ils sont installés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROMO, FORMATS, SceneError, parsePromoParams, extractScene, prepareScene, findChromium, promoSupported, renderPromo, leftovers } from '../src/services/promovideo.js';

const SCENE = `<!doctype html><html><head><style>body{margin:0;background:#0b1020;overflow:hidden}#t{position:absolute;top:40%;left:50%;font:700 60px sans-serif;color:#fff}</style></head><body><div id="t">AiTools</div><script>window.renderFrame=function(t){var e=document.getElementById('t');e.style.opacity=Math.min(1,t);e.style.left=(30+t*10)+'%';};</script></body></html>`;

test('paramètres : valeurs par défaut, bornes, nombre d\'images maximal, format et sujet nettoyés', () => {
  assert.deepEqual(parsePromoParams({}), { fps: PROMO.fps.def, seconds: PROMO.seconds.def, format: 'paysage', subject: '' });
  assert.deepEqual(parsePromoParams({ fps: '24', seconds: '10', format: 'vertical', subject: '  Le  \n nouveau   devis  ' }), { fps: 24, seconds: 10, format: 'vertical', subject: 'Le nouveau devis' });
  assert.equal(parsePromoParams({ format: 'imax' }).format, 'paysage', 'format inconnu : paysage');
  for (const b of [{ fps: 9 }, { fps: 61 }, { fps: 'abc' }, { seconds: 2 }, { seconds: 61 }]) assert.match(parsePromoParams(b).error, /entre \d+ et \d+/, JSON.stringify(b));
  assert.match(parsePromoParams({ fps: 60, seconds: 60 }).error, /Trop d'images à produire \(3600\)/);
  assert.equal(parsePromoParams({ fps: 30, seconds: 60 }).fps, 30, '1800 images : à la limite');
  assert.equal(parsePromoParams({ subject: 'x'.repeat(900) }).subject.length, PROMO.maxSubject);
  for (const f of Object.values(FORMATS)) assert.ok(f.width % 2 === 0 && f.height % 2 === 0, 'dimensions paires (H.264)');
});

test('extractScene : retire les ``` et le texte autour du document', () => {
  assert.equal(extractScene('Voici :\n```html\n' + SCENE + '\n```\nVoilà.'), SCENE);
  assert.equal(extractScene('blabla ' + SCENE + ' fin'), SCENE);
  assert.equal(extractScene('pas de html ici'), '');
  assert.equal(extractScene(null), '');
});

test('prepareScene : renderFrame obligatoire, ressources externes interdites, CSP posée avant tout le reste', () => {
  const doc = prepareScene(SCENE);
  assert.match(doc, /<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'/);
  assert.match(prepareScene('<html><body><script>window.renderFrame=function(t){}</script></body></html>'), /<html><head><meta http-equiv/);
  const bad = (html, re) => assert.throws(() => prepareScene(html), (e) => e instanceof SceneError && re.test(e.message), re.source);
  bad('', /Aucun document/);
  bad('<html><body>x</body></html>', /window\.renderFrame/);
  bad(SCENE.replace('<body>', '<body><img src="https://x.test/a.png">'), /adresse http/);
  bad(SCENE.replace('<body>', '<body><iframe src="about:blank"></iframe>'), /iframe/);
  bad(SCENE.replace('<head>', '<head><link rel="stylesheet" href="a.css">'), /<link>/);
  bad(SCENE.replace('<script>', '<script src="a.js"></script><script>'), /script externe/);
  bad(SCENE + ' '.repeat(PROMO.maxHtml), /trop longue/);
});

const cfg = { chromiumBin: process.env.CHROMIUM_BIN || (existsSync('/opt/pw-browsers') ? spawnSync('sh', ['-c', 'ls /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1']).stdout.toString().trim() : '') || undefined, sandbox: { enabled: false } };
const supported = promoSupported(cfg);

test('findChromium : réglage explicite d\'abord, rien si introuvable', () => {
  assert.equal(findChromium({ chromiumBin: '/x/chrome' }, {}), '/x/chrome');
  assert.equal(findChromium({}, { CHROMIUM_BIN: '/y/chrome' }), '/y/chrome');
  assert.equal(findChromium({}, { PATH: '/nulle/part' }), null);
  assert.match(promoSupported({ chromiumBin: '/inexistant/chrome' }).reason, /Chromium/);
});

test('rendu réel : MP4 H.264 de la bonne durée, progression, scènes fautives refusées', { skip: !supported.ok && supported.reason }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'promo-test-'));
  const realTmp = process.env.TMPDIR;
  process.env.TMPDIR = dir; // profils de Chromium dans un dossier à part : le contrôle de fuite ne voit pas les rendus des autres fichiers de test, lancés en parallèle
  try {
    const out = join(dir, 'a.mp4');
    const profilesBefore = leftovers().length;
    const steps = [];
    const r = await renderPromo({ cfg, html: SCENE, fps: 10, seconds: 3, width: 320, height: 320, out, onProgress: (p) => steps.push(p) });
    assert.equal(r.frames, 30);
    assert.equal(leftovers().length, profilesBefore, 'le profil de Chromium est effacé après le rendu');
    assert.ok(r.bytes > 1000 && existsSync(out));
    assert.deepEqual(steps.at(-1), { done: 30, total: 30 });
    const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames:format=duration', '-of', 'json', out]).stdout.toString());
    assert.equal(probe.streams[0].codec_name, 'h264');
    assert.equal(probe.streams[0].nb_frames, '30');
    assert.equal(Math.round(Number(probe.format.duration)), 3);

    const refused = async (html, re) => {
      const o = join(dir, 'b.mp4');
      await assert.rejects(renderPromo({ cfg, html, fps: 10, seconds: 3, width: 160, height: 160, out: o }), (e) => e instanceof SceneError && re.test(e.message));
      assert.equal(existsSync(o), false, 'aucun fichier laissé');
    };
    await refused(SCENE.replace(/e\.style[^;]*;/g, ''), /ne bouge pas/);
    await refused(SCENE.replace('var e=', "throw new Error('boum');var e="), /renderFrame\(0\.00\) a échoué : Error: boum/);
    await refused(SCENE.replace('var e=', "location.href='data:text/html,x';var e="), /quitté la page|bloque l'affichage/);
    // annulation : le rendu s'arrête et ne laisse rien
    const ctl = new AbortController();
    const p = renderPromo({ cfg, html: SCENE, fps: 30, seconds: 30, width: 160, height: 160, out: join(dir, 'c.mp4'), signal: ctl.signal, onProgress: ({ done }) => { if (done > 3) ctl.abort(); } });
    await assert.rejects(p);
    assert.equal(existsSync(join(dir, 'c.mp4')), false);
  } finally { if (realTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = realTmp; rmSync(dir, { recursive: true, force: true }); }
});
