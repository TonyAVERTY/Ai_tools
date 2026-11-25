// Routes du site public : toutes accessibles sans compte.
import { html, send } from '../http.js';
import { getSession } from '../auth.js';
import { countView } from '../services/audience.js';
import { withViewer } from './layout.js';
import { homePage, howPage, pricingPage } from './pages.js';
import { mentionsPage, privacyPage, termsPage } from './legal.js';
import { docsHomePage, docsApiPage, docsMcpPage } from './docs.js';
import { robotsTxt, sitemapXml } from './seo.js';
import { contactFormPage } from './contact.js';
import { formToken } from '../services/contact.js';

export function registerSiteRoutes(router, { cfg, db }) {
  const apple = !!cfg.apple;
  const ctx = { appUrl: cfg.appUrl, apple, captcha: !!cfg.recaptcha, inactiveMonths: cfg.inactiveMonths ?? 24, billing: !!cfg.stripe };
  const open = { public: true };
  // Les pages dépendent du cookie de connexion : ni cache partagé, ni cache du navigateur sans le cookie
  const show = async (req, res, page) => {
    res.setHeader('Vary', 'Cookie');
    countView(db, req, new URL(req.url, cfg.appUrl).pathname, cfg.appUrl); // mesure sans cookie ni identifiant : voir services/audience.js
    html(res, withViewer(page, !!(await getSession(db, req))));
  };

  // Le site d'accueil pour un compte connecté (sa racine « / » mène au tableau de bord) ; même page, adresse canonique « / »
  router.get('/accueil', async ({ req, res }) => show(req, res, homePage(ctx)), open);
  router.get('/fonctionnement', async ({ req, res }) => show(req, res, howPage(ctx)), open);
  router.get('/tarifs', async ({ req, res }) => show(req, res, pricingPage(ctx)), open);
  router.get('/mentions-legales', async ({ req, res }) => show(req, res, mentionsPage(ctx)), open);
  router.get('/confidentialite', async ({ req, res }) => show(req, res, privacyPage(ctx)), open);
  router.get('/cgu', async ({ req, res }) => show(req, res, termsPage(ctx)), open);
  router.get('/contact', async ({ req, res, url }) => {
    const plan = url.searchParams.get('plan');
    const values = plan === null ? {} : { topic: 'plan', message: `Prévenez-moi à l'ouverture de l'offre ${String(plan).replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 30)}.` };
    res.setHeader('Cache-Control', 'no-store');
    await show(req, res, contactFormPage({ appUrl: cfg.appUrl, token: formToken(cfg.secretKey), values }));
  }, open);
  router.get('/docs', async ({ req, res }) => show(req, res, docsHomePage(ctx)), open);
  router.get('/docs/api', async ({ req, res }) => show(req, res, docsApiPage(ctx)), open);
  router.get('/docs/mcp', async ({ req, res }) => show(req, res, docsMcpPage(ctx)), open);

  router.get('/robots.txt', async ({ res }) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    send(res, 200, robotsTxt(cfg.appUrl), 'text/plain; charset=utf-8');
  }, open);
  router.get('/sitemap.xml', async ({ res }) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    send(res, 200, sitemapXml(cfg.appUrl), 'application/xml; charset=utf-8');
  }, open);
}
