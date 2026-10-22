// Routes du site public : toutes accessibles sans compte.
import { html, send } from '../http.js';
import { homePage, howPage, pricingPage } from './pages.js';
import { mentionsPage, privacyPage, termsPage } from './legal.js';
import { robotsTxt, sitemapXml } from './seo.js';

export function registerSiteRoutes(router, { cfg }) {
  const apple = !!cfg.apple;
  const ctx = { appUrl: cfg.appUrl, apple, captcha: !!cfg.recaptcha };
  const open = { public: true };

  router.get('/fonctionnement', async ({ res }) => html(res, howPage(ctx)), open);
  router.get('/tarifs', async ({ res }) => html(res, pricingPage(ctx)), open);
  router.get('/mentions-legales', async ({ res }) => html(res, mentionsPage(ctx)), open);
  router.get('/confidentialite', async ({ res }) => html(res, privacyPage(ctx)), open);
  router.get('/cgu', async ({ res }) => html(res, termsPage(ctx)), open);

  router.get('/robots.txt', async ({ res }) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    send(res, 200, robotsTxt(cfg.appUrl), 'text/plain; charset=utf-8');
  }, open);
  router.get('/sitemap.xml', async ({ res }) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    send(res, 200, sitemapXml(cfg.appUrl), 'application/xml; charset=utf-8');
  }, open);
}
