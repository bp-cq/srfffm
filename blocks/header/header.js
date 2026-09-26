import { getMetadata } from '../../scripts/aem.js';
import { getLanguage, getLocalizedPath, LANGUAGES } from '../../scripts/i18n.js';
import { loadFragment } from '../fragment/fragment.js';

// media query match that indicates the desktop layout
const isDesktop = window.matchMedia('(min-width: 768px)');

const LABELS = {
  de: {
    open: 'Navigation öffnen', close: 'Navigation schließen', languages: 'Sprache wählen', top: 'Nach oben',
  },
  en: {
    open: 'Open navigation', close: 'Close navigation', languages: 'Choose language', top: 'Back to top',
  },
};

/**
 * Normalises a path for comparison (drops trailing slash and /index).
 * @param {string} path The path
 * @returns {string} The normalised path
 */
function normalizePath(path) {
  return path.replace(/\/index$/, '/').replace(/(.)\/$/, '$1');
}

/**
 * Opens or closes the mobile menu.
 * @param {Element} nav The nav element
 * @param {boolean} [force] Forces the expanded state
 */
function toggleMenu(nav, force) {
  const expanded = typeof force === 'boolean' ? force : nav.getAttribute('aria-expanded') !== 'true';
  const labels = LABELS[getLanguage()];
  nav.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  const button = nav.querySelector('.nav-hamburger button');
  button.setAttribute('aria-label', expanded ? labels.close : labels.open);
  document.body.style.overflowY = expanded && !isDesktop.matches ? 'hidden' : '';
}

/**
 * Builds the language switch: each link points to the current page in that language.
 * @param {Element} section The authored language section
 * @returns {Element} The language switch
 */
function buildLanguages(section) {
  const current = getLanguage();
  const list = document.createElement('ul');
  list.className = 'nav-languages';
  list.setAttribute('aria-label', LABELS[current].languages);
  section?.querySelectorAll('a[href]').forEach((a) => {
    const lang = LANGUAGES.find((l) => new URL(a.href).pathname.startsWith(`/${l}/`));
    if (!lang) return;
    const li = document.createElement('li');
    a.href = getLocalizedPath(lang);
    a.hreflang = lang;
    a.lang = lang;
    a.setAttribute('aria-label', a.textContent.trim());
    if (lang === current) a.setAttribute('aria-current', 'true');
    li.append(a);
    list.append(li);
  });
  return list;
}

/**
 * loads and decorates the header, mainly the nav
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  // load nav as fragment of the current language
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : `/${getLanguage()}/nav`;
  const fragment = await loadFragment(navPath);
  if (!fragment) return;

  const [brandSection, languageSection, sectionsSection] = fragment.querySelectorAll(':scope > .section');

  block.textContent = '';
  const nav = document.createElement('nav');
  nav.id = 'nav';

  // banner artwork and logo lettering
  const banner = document.createElement('div');
  banner.className = 'nav-banner';
  const bannerPicture = brandSection?.querySelector('picture');
  if (bannerPicture) {
    bannerPicture.closest('p')?.remove();
    bannerPicture.querySelector('img')?.setAttribute('alt', '');
    bannerPicture.querySelector('img')?.setAttribute('loading', 'eager');
    banner.append(bannerPicture);
  }

  const brand = document.createElement('div');
  brand.className = 'nav-brand';
  brandSection?.querySelectorAll('.default-content-wrapper > *').forEach((el) => brand.append(el));
  brand.querySelectorAll('.button').forEach((a) => { a.className = ''; });
  brand.querySelectorAll('.button-wrapper').forEach((p) => { p.className = ''; });

  const tools = document.createElement('div');
  tools.className = 'nav-tools';
  tools.append(buildLanguages(languageSection));

  // main navigation
  const sections = document.createElement('div');
  sections.className = 'nav-sections';
  const list = sectionsSection?.querySelector('ul');
  if (list) {
    const here = normalizePath(window.location.pathname);
    list.querySelectorAll('a[href]').forEach((a) => {
      a.className = '';
      if (normalizePath(new URL(a.href).pathname) === here) a.setAttribute('aria-current', 'page');
    });
    sections.append(list);
  }

  // hamburger for mobile
  const hamburger = document.createElement('div');
  hamburger.className = 'nav-hamburger';
  hamburger.innerHTML = '<button type="button" aria-controls="nav"><span class="nav-hamburger-icon"></span></button>';
  hamburger.querySelector('button').addEventListener('click', () => toggleMenu(nav));

  nav.append(banner, brand, tools, hamburger, sections);
  toggleMenu(nav, false);
  isDesktop.addEventListener('change', () => toggleMenu(nav, false));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && nav.getAttribute('aria-expanded') === 'true') {
      toggleMenu(nav, false);
      hamburger.querySelector('button').focus();
    }
  });

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  block.append(navWrapper);

  // phones: the header slides away on scroll-down and comes back on scroll-up;
  // a back-to-top button appears once the page is scrolled
  const header = block.closest('header');
  const toTop = document.createElement('button');
  toTop.type = 'button';
  toTop.className = 'back-to-top';
  toTop.setAttribute('aria-label', LABELS[getLanguage()].top);
  toTop.innerHTML = '<img src="/icons/back-to-top.svg" alt="" width="50" height="50">';
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.append(toTop);
  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const hide = !isDesktop.matches && y > lastY && y > header.offsetHeight
      && nav.getAttribute('aria-expanded') !== 'true';
    if (y < lastY || y <= header.offsetHeight) header.classList.remove('nav-hidden');
    else if (hide) header.classList.add('nav-hidden');
    toTop.classList.toggle('visible', y > 100);
    lastY = y;
  }, { passive: true });
}
