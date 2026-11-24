// Champs de code (A2F) : un code de 6 chiffres n'accepte JAMAIS plus de 6 caractères, ni autre chose que des chiffres, à la frappe comme au collage.
// Un lien « Utiliser un code de secours » passe le champ en mode secours (11 caractères : 5 + tiret + 5, chiffres et lettres a-f).
// Délégué sur `document` : marche pour les champs rendus par le serveur, ajoutés plus tard ou arrivés par navigation. Sans JavaScript, le lien mène à la page
// rendue par le serveur dans l'autre mode (?mode=secours), et la limite du champ (maxlength) reste posée par le serveur.
(() => {
  const MODES = {
    totp: { max: 6, pattern: '[0-9]{6}', inputmode: 'numeric', clean: (v) => v.replace(/\D/g, '').slice(0, 6), label: 'Code à 6 chiffres', toggle: 'Utiliser un code de secours' },
    secours: { max: 11, pattern: '[0-9a-fA-F]{5}-?[0-9a-fA-F]{5}', inputmode: 'text', clean: (v) => v.replace(/[^0-9a-fA-F-]/g, '').slice(0, 11), label: 'Code de secours', toggle: 'Utiliser le code de mon application' },
  };
  const modeOf = (input) => (input.dataset.mode === 'secours' ? 'secours' : 'totp');

  document.addEventListener('input', (e) => {
    const input = e.target.closest?.('[data-code-input]');
    if (!input) return;
    const clean = MODES[modeOf(input)].clean(input.value);
    if (clean !== input.value) input.value = clean;
  });

  // Collage : le navigateur couperait « 123 456 » à 6 caractères AVANT tout nettoyage (l'espace compte) et on perdrait un chiffre. On nettoie le texte collé d'abord.
  document.addEventListener('paste', (e) => {
    const input = e.target.closest?.('[data-code-input]');
    if (!input) return;
    e.preventDefault();
    input.value = MODES[modeOf(input)].clean(e.clipboardData?.getData('text') || '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  document.addEventListener('click', (e) => {
    const toggle = e.target.closest?.('[data-code-toggle]');
    if (!toggle) return;
    const box = toggle.closest('[data-code-field]');
    const input = box?.querySelector('[data-code-input]');
    if (!input) return;
    e.preventDefault();
    const next = modeOf(input) === 'totp' ? 'secours' : 'totp';
    const m = MODES[next];
    input.dataset.mode = next;
    input.maxLength = m.max;
    input.setAttribute('pattern', m.pattern);
    input.setAttribute('inputmode', m.inputmode);
    input.setAttribute('aria-label', m.label);
    input.value = '';
    const lbl = box.querySelector('[data-code-label]');
    if (lbl) lbl.textContent = m.label;
    toggle.textContent = MODES[next === 'totp' ? 'secours' : 'totp'].toggle;
    toggle.setAttribute('href', (next === 'secours' ? toggle.dataset.toTotp : toggle.dataset.toSecours) || '#');
    input.focus();
  });
})();
