// Routes du site public : toutes accessibles sans compte.
import { html, send } from '../http.js';
import { getSession } from '../auth.js';
import { withViewer } from './layout.js';
import { homePage, howPage, pricingPage } from './pages.js';
import { mentionsPage, privacyPage, termsPage } from './legal.js';
import { docsHomePage, docsApiPage, docsMcpPage } from './docs.js';
import { robotsTxt, sitemapXml } from './seo.js';

export function registerSiteRoutes(router, { cfg, db }) {
  const apple = !!cfg.apple;
  const ctx = { appUrl: cfg.appUrl, apple, captcha: !!cfg.recaptcha, inactiveMonths: cfg.inactiveMonths ?? 24 };
  const open = { public: true };
  // Les pages dépendent du cookie de connexion : ni cache partagé, ni cache du navigateur sans le cookie
  const show = async (req, res, page) => {
    res.setHeader('Vary', 'Cookie');
    html(res, withViewer(page, !!(await getSession(db, req))));
  };

  // Le site d'accueil pour un compte connecté (sa racine « / » mène au tableau de bord) ; même page, adresse canonique « / »
  router.get('/accueil', async ({ req, res }) => show(req, res, homePage(ctx)), open);
  router.get('/fonctionnement', async ({ req, res }) => show(req, res, howPage(ctx)), open);
  router.get('/tarifs', async ({ req, res }) => show(req, res, pricingPage(ctx)), open);
  router.get('/mentions-legales', async ({ req, res }) => show(req, res, mentionsPage(ctx)), open);
  router.get('/confidentialite', async ({ req, res }) => show(req, res, privacyPage(ctx)), open);
  router.get('/cgu', async ({ req, res }) => show(req, res, termsPage(ctx)), open);
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
