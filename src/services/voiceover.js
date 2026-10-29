// Voix off des vidéos de promotion. Claude écrit, avec la scène, un petit script (« voix ») : des phrases avec l'instant où elles commencent.
// Ce module le valide, le fait lire par un fournisseur de synthèse vocale GRATUIT et SANS CLÉ, puis ffmpeg pose les voix sur la bande-son de la vidéo.
//  - edge   : voix neuronales de Microsoft Edge (lecture à voix haute), bonne qualité, plusieurs voix par langue ;
//  - google : voix de Google Traduction, plus simple (une voix par langue).
// Ces deux services ne sont pas des API officielles : ils peuvent changer ou refuser des requêtes. Le texte lu est envoyé au fournisseur choisi.
// Aucun appel réseau n'est fait ailleurs que dans `synthesize` (remplaçable dans les tests).
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SceneError } from './promovideo.js';

export const VOICE = { maxSegments: 20, maxSegmentChars: 240, maxTotalChars: 1500, gap: 0.2, sampleText: 'Bonjour, voici ma voix pour ta vidéo de promotion.', timeoutMs: 20_000 };

const LANGS = { fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien', pt: 'portugais' };
const SAMPLES = {
  fr: 'Bonjour, voici ma voix pour ta vidéo de promotion.', en: 'Hello, this is my voice for your promotion video.', es: 'Hola, esta es mi voz para tu vídeo de promoción.',
  de: 'Hallo, das ist meine Stimme für dein Werbevideo.', it: 'Ciao, questa è la mia voce per il tuo video promozionale.', pt: 'Olá, esta é a minha voz para o teu vídeo de promoção.',
};

const v = (id, label, lang) => ({ id, label, lang });
export const VOICE_PROVIDERS = {
  edge: {
    label: 'Microsoft Edge (gratuit)',
    voices: [
      v('fr-FR-DeniseNeural', 'Denise · français, féminine', 'fr'), v('fr-FR-HenriNeural', 'Henri · français, masculine', 'fr'),
      v('fr-FR-VivienneMultilingualNeural', 'Vivienne · français, féminine', 'fr'), v('fr-FR-RemyMultilingualNeural', 'Rémy · français, masculine', 'fr'),
      v('fr-BE-CharlineNeural', 'Charline · français de Belgique, féminine', 'fr'), v('fr-CA-SylvieNeural', 'Sylvie · français du Canada, féminine', 'fr'),
      v('en-US-JennyNeural', 'Jenny · anglais américain, féminine', 'en'), v('en-US-GuyNeural', 'Guy · anglais américain, masculine', 'en'),
      v('en-GB-SoniaNeural', 'Sonia · anglais britannique, féminine', 'en'), v('en-GB-RyanNeural', 'Ryan · anglais britannique, masculine', 'en'),
      v('es-ES-ElviraNeural', 'Elvira · espagnol, féminine', 'es'), v('es-ES-AlvaroNeural', 'Álvaro · espagnol, masculine', 'es'),
      v('de-DE-KatjaNeural', 'Katja · allemand, féminine', 'de'), v('de-DE-ConradNeural', 'Conrad · allemand, masculine', 'de'),
      v('it-IT-ElsaNeural', 'Elsa · italien, féminine', 'it'), v('it-IT-DiegoNeural', 'Diego · italien, masculine', 'it'),
      v('pt-BR-FranciscaNeural', 'Francisca · portugais, féminine', 'pt'), v('pt-PT-DuarteNeural', 'Duarte · portugais, masculine', 'pt'),
    ],
  },
  google: {
    label: 'Google Traduction (gratuit)',
    voices: [v('fr', 'Français', 'fr'), v('en', 'Anglais', 'en'), v('es', 'Espagnol', 'es'), v('de', 'Allemand', 'de'), v('it', 'Italien', 'it'), v('pt', 'Portugais', 'pt')],
  },
};

export const voiceCatalog = () => Object.entries(VOICE_PROVIDERS).map(([id, p]) => ({ id, label: p.label, voices: p.voices }));
const findVoice = (provider, id) => VOICE_PROVIDERS[provider]?.voices.find((x) => x.id === id) || null;
export const langName = (lang) => LANGS[lang] || 'français';

/** Choix du formulaire → `{ provider, voice, lang }`, `null` (pas de voix), ou une erreur lisible. */
export function parseVoiceParams(b = {}) {
  if (!(b.voice === true || b.voice === 'true' || b.voice === 1 || b.voice === '1' || b.voice === 'on')) return { voice: null };
  const provider = String(b.voiceProvider ?? '');
  if (!VOICE_PROVIDERS[provider]) return { error: 'Voix : choisis un fournisseur dans la liste.' };
  const found = findVoice(provider, String(b.voiceName ?? ''));
  if (!found) return { error: 'Voix : choisis une voix dans la liste.' };
  return { voice: { provider, voice: found.id, lang: found.lang } };
}

// ---------- Le script écrit par Claude ----------

const SCRIPT = /<script[^>]*\bid=["']voix["'][^>]*>([\s\S]*?)<\/script>/i;

/**
 * Document HTML de Claude → phrases à dire `[{ t, text }]` triées par instant. Une erreur de forme est une SceneError : elle est renvoyée à Claude
 * pour correction, comme un défaut de scène.
 */
export function extractVoiceScript(html, seconds) {
  const m = SCRIPT.exec(String(html ?? ''));
  if (!m) throw new SceneError('Il manque le script de la voix : ajoute dans le <body> <script type="application/json" id="voix">[{"t":0.5,"texte":"…"}, …]</script> (une phrase par plan, "t" = seconde où elle commence).');
  let list;
  try { list = JSON.parse(m[1]); } catch { throw new SceneError('Le script de la voix (<script id="voix">) n\'est pas du JSON valide : un tableau de {"t": secondes, "texte": "phrase"}.'); }
  if (!Array.isArray(list) || !list.length) throw new SceneError('Le script de la voix est vide : écris au moins une phrase par plan.');
  const segs = list.map((x) => ({ t: Number(x?.t), text: String(x?.texte ?? x?.text ?? '').replace(/\s+/g, ' ').trim() }));
  if (segs.length > VOICE.maxSegments) throw new SceneError(`Trop de phrases dans la voix (${segs.length}) : ${VOICE.maxSegments} au plus, une par plan.`);
  for (const s of segs) {
    if (!Number.isFinite(s.t) || s.t < 0 || s.t >= seconds) throw new SceneError(`Dans la voix, "t" doit être un nombre de secondes entre 0 et ${seconds} (reçu : ${JSON.stringify(s.t)}).`);
    if (s.text.length < 2) throw new SceneError('Dans la voix, chaque phrase doit avoir un "texte" non vide.');
    if (s.text.length > VOICE.maxSegmentChars) throw new SceneError(`Une phrase de la voix fait ${s.text.length} caractères : ${VOICE.maxSegmentChars} au plus ; coupe-la en deux phrases à deux instants différents.`);
  }
  const total = segs.reduce((n, s) => n + s.text.length, 0);
  if (total > VOICE.maxTotalChars) throw new SceneError(`La voix totalise ${total} caractères : ${VOICE.maxTotalChars} au plus ; raccourcis les phrases.`);
  return segs.sort((a, b) => a.t - b.t);
}

/**
 * Place les phrases : chacune commence à son instant, ou juste après la précédente si celle-ci n'est pas finie (jamais deux voix en même temps).
 * `overflow` : secondes de voix qui dépasseraient la fin de la vidéo.
 */
export function planVoice(parts, seconds) {
  let cursor = 0;
  const placed = parts.map((p) => {
    const start = Math.max(p.t, cursor);
    cursor = start + p.dur + VOICE.gap;
    return { ...p, start, end: start + p.dur };
  });
  const end = placed.length ? placed[placed.length - 1].end : 0;
  return { placed, overflow: Math.max(0, end - seconds) };
}

// ---------- Synthèse ----------

const withTimeout = async (promise, ms, what) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} : délai dépassé`)), ms); })]); } finally { clearTimeout(timer); }
};

const xmlEscape = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// Edge « lecture à voix haute » : WebSocket, jeton de la forme décrite par les clients libres de ce service.
const EDGE = {
  token: '6A5AA1D4EAFF4E9FB37E23D68491D6F4', chrome: '130.0.2849.68',
  url: 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1',
};
export function edgeGec(now = Date.now()) {
  let ticks = Math.floor(now / 1000) + 11644473600; // secondes depuis 1601
  ticks -= ticks % 300;
  return createHash('sha256').update(`${ticks * 1e7}${EDGE.token}`).digest('hex').toUpperCase();
}

export function edgeSsml(text, voice) {
  const lang = voice.split('-').slice(0, 2).join('-');
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${xmlEscape(text)}</prosody></voice></speak>`;
}

function edgeSynth(text, voice, { WS = globalThis.WebSocket } = {}) {
  return new Promise((resolve, reject) => {
    if (!WS) return reject(new Error('Ce Node ne fournit pas WebSocket'));
    const id = randomUUID().replace(/-/g, '');
    const url = `${EDGE.url}?TrustedClientToken=${EDGE.token}&Sec-MS-GEC=${edgeGec()}&Sec-MS-GEC-Version=1-${EDGE.chrome}&ConnectionId=${id}`;
    const chunks = [];
    const ws = new WS(url, { headers: {
      Pragma: 'no-cache', 'Cache-Control': 'no-cache', Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE.chrome.split('.')[0]}.0.0.0 Safari/537.36 Edg/${EDGE.chrome.split('.')[0]}.0.0.0`,
    } });
    ws.binaryType = 'arraybuffer';
    let settled = false;
    const end = (err) => { if (settled) return; settled = true; try { ws.close(); } catch { /* déjà fermée */ } err ? reject(err) : resolve(Buffer.concat(chunks)); };
    ws.onerror = () => end(new Error('Connexion refusée par le service de voix Microsoft Edge'));
    ws.onclose = () => end(chunks.length ? null : new Error('Le service de voix Microsoft Edge a fermé la connexion sans audio'));
    ws.onopen = () => {
      const stamp = new Date().toString();
      ws.send(`X-Timestamp:${stamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
      ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp}Z\r\nPath:ssml\r\n\r\n${edgeSsml(text, voice)}`);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') { if (/Path:turn\.end/.test(ev.data)) end(chunks.length ? null : new Error('Le service de voix Microsoft Edge n\'a renvoyé aucun audio')); return; }
      const buf = Buffer.from(ev.data);
      if (buf.length < 2) return;
      const headLen = buf.readUInt16BE(0);
      if (/Path:audio/.test(buf.subarray(2, 2 + headLen).toString('latin1'))) chunks.push(buf.subarray(2 + headLen));
    };
  });
}

// Google Traduction : une requête GET par morceau d'au plus 180 caractères, les MP3 se mettent bout à bout.
export function googleChunks(text, max = 180) {
  const out = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if ((`${cur} ${word}`).trim().length > max) { if (cur) out.push(cur); cur = word.slice(0, max); } else cur = `${cur} ${word}`.trim();
    if (/[.!?]$/.test(word) && cur.length > max * 0.6) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}

async function googleSynth(text, lang, { fetchImpl = fetch } = {}) {
  const bufs = [];
  for (const q of googleChunks(text)) {
    const res = await fetchImpl(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`Google Traduction a refusé la requête (${res.status})`);
    bufs.push(Buffer.from(await res.arrayBuffer()));
  }
  return Buffer.concat(bufs);
}

/** Texte → MP3 (Buffer). Les erreurs réseau remontent avec le nom du service ; jamais de clé ni de texte dans le message. */
export async function synthesize({ provider, voice, text }, deps = {}) {
  if (!findVoice(provider, voice)) throw new Error('Voix inconnue');
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Texte vide');
  const audio = await withTimeout(provider === 'edge' ? edgeSynth(clean, voice, deps) : googleSynth(clean, voice, deps), VOICE.timeoutMs, `Service de voix ${VOICE_PROVIDERS[provider].label}`);
  if (audio.length < 200) throw new Error('Le service de voix a renvoyé un audio vide');
  return audio;
}

/** Extrait d'écoute : phrase courte dans la langue de la voix. */
export const sampleFor = (provider, voice) => synthesize({ provider, voice, text: SAMPLES[findVoice(provider, voice)?.lang] || VOICE.sampleText });

// ---------- ffmpeg ----------

function run(bin, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], signal });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg a échoué : ${err.trim().split('\n').pop() || `code ${code}`}`))));
  });
}

/** Durée d'un fichier audio en secondes (lue sur la sortie d'ffmpeg, sans dépendre de ffprobe). */
export function audioDuration(cfg, file) {
  return new Promise((resolve, reject) => {
    const p = spawn(cfg.ffmpegBin || 'ffmpeg', ['-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
    p.on('error', reject);
    p.on('close', () => {
      const all = [...err.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
      if (!all) return reject(new Error("Audio illisible : la voix n'a pas pu être mesurée"));
      resolve(Number(all[1]) * 3600 + Number(all[2]) * 60 + Number(all[3]));
    });
  });
}

/**
 * Synthétise chaque phrase, mesure sa durée et la place. Renvoie `{ dir, placed, overflow }` ; `dir` contient les MP3 (à effacer avec `cleanVoice`).
 */
export async function prepareVoice({ cfg, segments, voice, seconds, synth = synthesize, onProgress = () => {}, signal }) {
  const dir = mkdtempSync(join(tmpdir(), 'aitools-voix-'));
  try {
    const parts = [];
    for (let i = 0; i < segments.length; i++) {
      if (signal?.aborted) throw new Error('Annulé');
      onProgress({ done: i, total: segments.length });
      const file = join(dir, `${i}.mp3`);
      writeFileSync(file, await synth({ provider: voice.provider, voice: voice.voice, text: segments[i].text }));
      parts.push({ t: segments[i].t, text: segments[i].text, file, dur: await audioDuration(cfg, file) });
    }
    onProgress({ done: segments.length, total: segments.length });
    return { dir, ...planVoice(parts, seconds) };
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
}

export const cleanVoice = (prepared) => { if (prepared?.dir) rmSync(prepared.dir, { recursive: true, force: true }); };

/** Pose les voix sur la vidéo (déjà encodée, sans son) : l'image n'est pas ré-encodée, la bande-son est coupée à la durée de la vidéo. */
export async function mixVoice({ cfg, videoPath, placed, seconds, signal }) {
  if (!placed.length) return;
  const tmp = `${videoPath}.voix.mp4`;
  const inputs = placed.flatMap((p) => ['-i', p.file]);
  const delays = placed.map((p, i) => { const ms = Math.round(p.start * 1000); return `[${i + 1}:a]adelay=${ms}|${ms},volume=1.0[a${i}]`; });
  const mixed = placed.length > 1 ? `${placed.map((_, i) => `[a${i}]`).join('')}amix=inputs=${placed.length}:normalize=0:dropout_transition=0[m]` : '[a0]anull[m]';
  const fade = Math.max(0, seconds - 0.4);
  const filter = `${delays.join(';')};${mixed};[m]apad,atrim=0:${seconds},afade=t=out:st=${fade}:d=0.4[a]`;
  try {
    await run(cfg.ffmpegBin || 'ffmpeg', ['-v', 'error', '-y', '-i', videoPath, ...inputs, '-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-t', String(seconds), '-movflags', '+faststart', tmp], { signal });
    renameSync(tmp, videoPath);
  } catch (e) { rmSync(tmp, { force: true }); throw e; }
}
