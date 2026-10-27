// Notation contre la vérité terrain de bench/ : une liste de contrôles objectifs, tous éliminatoires pour les tests,
// et un taux de réussite pour le banc d'essai.

/** Décision de l'orchestrateur contre une demande étiquetée de bench/requests.js. */
export function scoreDecision(d, req) {
  const checks = [];
  const check = (name, ok) => checks.push({ name, ok: !!ok });
  if (req.domain) { check(`domaine ${req.domain}`, d.domain === req.domain); return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length }; }
  check('domaine dev', d.domain === 'dev');
  check(`intention principale ${req.primary}`, d.primary === req.primary);
  check(`mode ${req.mode}`, d.mode === req.mode);
  for (const n of req.must || []) check(`retient ${n}`, d.skills.includes(n));
  for (const n of req.never || []) check(`écarte ${n}`, !d.skills.includes(n));
  if (req.maxSkills) check(`au plus ${req.maxSkills} fiche(s)`, d.skills.length <= req.maxSkills);
  return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length };
}

export function scoreProfile(f, expect) {
  const checks = [];
  const check = (name, ok) => checks.push({ name, ok: !!ok });
  const names = (a) => a.map((x) => x.language || x);
  for (const l of expect.languages) check(`langage ${l}`, names(f.languages).includes(l));
  if (expect.languages.length === 0) check('aucun langage inventé', f.languages.length === 0);
  for (const x of expect.frameworks) check(`bibliothèque ${x}`, f.frameworks.includes(x));
  if (expect.frameworks.length === 0) check('aucun framework inventé', f.frameworks.length === 0);
  for (const [kind, cmd] of Object.entries(expect.commands)) check(`commande ${kind} = ${cmd}`, (f.commands[kind] || []).some((c) => c.cmd === cmd));
  if (Object.keys(expect.commands).length === 0) check('aucune commande inventée', Object.keys(f.commands).length === 0);
  if ('tests' in expect) check(expect.tests ? 'tests détectés' : 'aucun test inventé', expect.tests ? f.tests.files > 0 : f.tests.files === 0);
  if ('ci' in expect) check(expect.ci ? 'intégration continue détectée' : 'pas de fausse intégration continue', expect.ci ? f.ci.length > 0 : f.ci.length === 0);
  if ('db' in expect) check(expect.db ? 'base de données détectée' : 'pas de fausse base de données', expect.db ? f.db.length > 0 : f.db.length === 0);
  if ('frontend' in expect) check('front détecté', f.frontend === expect.frontend);
  if ('api' in expect) check('API détectée', f.api === expect.api);
  if ('monorepo' in expect) check('monorepo détecté', f.monorepo === expect.monorepo);
  if ('entry' in expect) check(`point d'entrée ${expect.entry}`, f.entryPoints.some((e) => e.path === expect.entry));
  check('fichiers d\'instructions', JSON.stringify([...f.instructions].sort()) === JSON.stringify([...expect.instructions].sort()));
  for (const p of expect.sensitive || []) check(`zone sensible ${p}`, f.sensitive.some((s) => s.path.startsWith(p)));
  for (const g of expect.gapsInclude || []) check(`lacune « ${g} »`, f.gaps.includes(g));
  for (const g of expect.gapsExclude || []) check(`pas de fausse lacune « ${g} »`, !f.gaps.includes(g));
  return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length };
}
