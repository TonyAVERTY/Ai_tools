// Vérification anti-robot de la page de connexion (Google reCAPTCHA v3), entièrement automatique :
// le script est chargé dès l'ouverture de la page, les boutons s'activent quand il est prêt, et le jeton est produit
// au moment du clic. Il n'y a rien à cocher ni à résoudre.
(() => {
  const box = document.querySelector('[data-captcha]');
  if (!box) return;
  const key = box.dataset.sitekey;
  const status = box.querySelector('[data-captcha-status]');
  const retry = box.querySelector('[data-captcha-load]');
  const forms = [...document.querySelectorAll('form[data-captcha-form]')];
  let ready = false;
  const say = (text) => { status.textContent = text; };

  function load() {
    retry.hidden = true;
    say('Vérification anti-robot en cours, ça prend une seconde…');
    const s = document.createElement('script');
    s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(key)}`;
    s.async = true;
    s.onload = () => window.grecaptcha.ready(() => {
      ready = true;
      for (const f of forms) f.querySelector('button').disabled = false;
      say('Vérification faite : tu peux te connecter.');
    });
    s.onerror = () => { s.remove(); retry.hidden = false; say("La vérification n'a pas pu se charger (réseau ou bloqueur de pubs ?). Réessaie."); };
    document.head.append(s);
  }

  retry.addEventListener('click', load);
  load();

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
