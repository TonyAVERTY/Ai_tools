// Vérification anti-robot de la page de connexion (Google reCAPTCHA v3), chargée seulement APRÈS le clic de l'utilisateur.
// Tant qu'il n'a pas cliqué sur « Charger la vérification anti-robot », aucune requête ne part vers Google.
(() => {
  const box = document.querySelector('[data-captcha]');
  if (!box) return;
  const key = box.dataset.sitekey;
  const status = box.querySelector('[data-captcha-status]');
  const load = box.querySelector('[data-captcha-load]');
  const forms = [...document.querySelectorAll('form[data-captcha-form]')];
  let ready = false;
  const say = (text) => { status.textContent = text; };

  load.addEventListener('click', () => {
    load.disabled = true;
    say('Chargement de la vérification…');
    const s = document.createElement('script');
    s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(key)}`;
    s.async = true;
    s.onload = () => window.grecaptcha.ready(() => {
      ready = true;
      for (const f of forms) f.querySelector('button').disabled = false;
      load.hidden = true;
      say('Vérification chargée : tu peux te connecter.');
    });
    s.onerror = () => { load.disabled = false; say('La vérification n\'a pas pu être chargée (réseau ou bloqueur de contenu). Réessaie.'); };
    document.head.append(s);
  });

  for (const f of forms) {
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!ready) return;
      window.grecaptcha.execute(key, { action: 'login' }).then((token) => {
        f.querySelector('input[name="captcha"]').value = token;
        f.submit();
      }, () => say('La vérification a échoué : réessaie.'));
    });
  }
})();
