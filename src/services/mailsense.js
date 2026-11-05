// Contrôle du sens d'un mail une fois rempli : l'aperçu et l'envoi demandent à l'IA de la personne si le texte veut dire quelque chose
// (« Pour Boulangerie Fanet, un client qui revient… » : un nom d'entreprise collé dans une phrase qui ne le porte pas).
//  - Aperçu : un mail, avec une version corrigée du MODÈLE proposée (jamais appliquée sans la personne).
//  - Envoi : par lots de SENSE_BATCH mails. Un mail jugé sans sens ne part pas ; si l'IA ne peut pas répondre, rien ne part.
import { extractJson } from './claude.js';
import { senseMailPrompt, rephrasePrompt } from './prompts.js';
import { readyMadeAnswers } from './mailcheck.js';

export const SENSE_BATCH = 10;
const clip = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const countVars = (t) => { const m = new Map(); for (const [, k] of String(t ?? '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)) m.set(k, (m.get(k) || 0) + 1); return m; };
const words = (t) => (String(t ?? '').match(/\S+/g) || []).length;
const urls = (t) => (String(t ?? '').match(/https?:\/\/\S+/g) || []).sort().join('|');

/**
 * Une correction du modèle n'est retenue que si elle ne change pas le fond : aucune variable ajoutée (en retirer une est permis : le défaut vient parfois
 * d'elle, « Bonjour {{entreprise}}, »), mêmes adresses web, longueur voisine, aucune ligne commençant par une virgule, aucune variable mal fermée.
 */
export function acceptSenseFix(original, fixed, { slack = 0 } = {}) {
  if (typeof fixed !== 'string' || !fixed.trim() || fixed.trim() === String(original).trim()) return false;
  const before = countVars(original);
  for (const [k, n] of countVars(fixed)) if (n > (before.get(k) || 0)) return false;
  if (urls(original) !== urls(fixed)) return false;
  const a = words(original), b = words(fixed);
  if (b < a * 0.6 || b > a * 1.4 + slack) return false; // `slack` : mots que la correction peut ajouter en plus (appel, politesse)
  if (fixed.split('\n').some((l) => /^[ \t]*[,;]/.test(l)) || /\{\{[^}]*$|^[^{]*\}\}/m.test(fixed)) return false;
  return true;
}

const norm = (t) => String(t ?? '').toLowerCase().replace(/[^\p{L}\p{N}{}]+/gu, '');

/**
 * Une autre phrase n'est retenue que si elle remplit le même office : aucune variable de plus que l'originale, mêmes adresses web, longueur voisine,
 * différente de l'originale et des propositions déjà refusées, sans virgule en tête de ligne ni variable mal fermée.
 */
export function acceptRephrase(original, proposal, avoid = []) {
  if (typeof proposal !== 'string') return false;
  const p = proposal.trim();
  if (!p || p.length > Math.max(300, String(original).length * 2.5)) return false;
  if (norm(p) === norm(original) || avoid.some((a) => norm(a) === norm(p))) return false;
  const before = countVars(original);
  for (const [k, n] of countVars(p)) if (n > (before.get(k) || 0)) return false;
  if (urls(original) !== urls(p)) return false;
  const a = words(original), b = words(p);
  if (b < a * 0.4 || b > a * 2.2 + 3) return false;
  if (p.split('\n').some((l) => /^[ \t]*[,;]/.test(l)) || /\{\{[^}]*$|^[^{]*\}\}/m.test(p)) return false;
  if (readyMadeAnswers(p)) return false; // une proposition qui énumère des réponses à choisir n'est jamais montrée
  return true;
}

/**
 * Demande à l'IA une autre phrase à la place de `sentence` (écrite avec ses variables, comme dans le modèle).
 * @returns {Promise<{sentence:string, run:object}>}
 */
export async function proposeSentence({ claude, userId, model, signal, kind = 'initial', template, sentence, avoid = [], facts = '' }) {
  let refused = [...avoid];
  // Une proposition refusée par acceptRephrase (énumère des réponses, trop longue, identique…) est redemandée UNE fois, en la mettant dans la liste des refus
  for (let attempt = 0; attempt < 2; attempt++) {
    const { prompt, system } = rephrasePrompt({ kind, template, sentence, avoid: refused, facts });
    let run;
    try {
      run = await claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new SenseUnavailable(e.expose || (e.status && e.status < 500) ? String(e.message) : "l'IA n'a pas pu répondre");
    }
    if (run?.ok === false) throw new SenseUnavailable(clip(run.text, 160) || "l'IA n'a pas pu répondre");
    let data;
    try { data = extractJson(run?.text); } catch { throw new SenseUnavailable("l'IA n'a pas renvoyé une réponse lisible"); }
    const proposal = typeof data?.sentence === 'string' ? data.sentence.trim() : '';
    if (acceptRephrase(sentence, proposal, refused)) return { sentence: proposal, run };
    if (proposal) refused = [...refused, proposal].slice(-6);
  }
  throw new SenseUnavailable("l'IA n'a pas proposé de phrase utilisable");
}

/** Erreur « la vérification n'a pas pu se faire » : l'appelant n'envoie rien et le dit à la personne. */
export class SenseUnavailable extends Error {
  constructor(message) { super(message); this.name = 'SenseUnavailable'; }
}

/**
 * Lit la réponse de l'IA. Chaque id demandé doit avoir une réponse : sinon la vérification est jugée impossible (un mail non vérifié ne part pas).
 * `fix_body` n'est gardé que s'il passe acceptSenseFix (aucune variable ajoutée, mêmes adresses, longueur voisine).
 * @returns {Map<number, {ok:boolean, problem?:string, fixBody?:string}>}
 */
export function parseSense(text, ids, templateBody) {
  let data;
  try { data = extractJson(text); } catch { throw new SenseUnavailable("l'IA n'a pas renvoyé une réponse lisible"); }
  const results = new Map();
  for (const r of Array.isArray(data?.results) ? data.results : []) if (Number.isFinite(Number(r?.id))) results.set(Number(r.id), r);
  const out = new Map();
  for (const id of ids) {
    const r = results.get(Number(id));
    if (!r || typeof r.ok !== 'boolean') throw new SenseUnavailable("l'IA n'a pas répondu pour tous les mails");
    if (r.ok) { out.set(id, { ok: true }); continue; }
    const fix = typeof r.fix_body === 'string' ? r.fix_body.trim() : '';
    const accepted = acceptSenseFix(templateBody, fix);
    out.set(id, { ok: false, problem: clip(r.problem, 300) || 'une phrase ne veut rien dire', ...(accepted ? { fixBody: fix } : {}) });
  }
  return out;
}

/**
 * Demande à l'IA si les mails ont un sens. `claude(userId, options)` est le lanceur habituel du compte (makeClaude).
 * @param {{claude:Function, userId:number, model:string, signal?:AbortSignal, kind?:string, template:string, items:{id:number,subject?:string,body:string}[]}} o
 * @returns {Promise<{verdicts:Map, run:object}>} `run` : la réponse brute du lanceur, pour compter les tokens et le coût.
 */
export async function checkSense({ claude, userId, model, signal, kind = 'initial', template, items }) {
  const { prompt, system } = senseMailPrompt({ kind, template, items });
  let run;
  try {
    run = await claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal });
  } catch (e) {
    if (signal?.aborted) throw e; // annulation : pas une indisponibilité
    throw new SenseUnavailable(e.expose || (e.status && e.status < 500) ? String(e.message) : "l'IA n'a pas pu répondre");
  }
  if (run?.ok === false) throw new SenseUnavailable(clip(run.text, 160) || "l'IA n'a pas pu répondre");
  return { verdicts: parseSense(run?.text, items.map((i) => i.id), template), run };
}
