import { getMetadata } from '../../scripts/aem.js';
import { getConsent, setConsent } from '../../scripts/consent.js';
import { getLanguage } from '../../scripts/i18n.js';
import { loadFragment } from '../fragment/fragment.js';

const LABELS = {
  de: { close: 'Schließen', banner: 'Cookie-Hinweis' },
  en: { close: 'Close', banner: 'Cookie notice' },
};

/**
 * Builds the cookie banner from the authored consent section.
 * Links to `#accept` / `#decline` become the banner buttons.
 * @param {Element} section The consent section of the footer fragment
 * @returns {Element} The banner
 */
function buildConsentBanner(section) {
  const labels = LABELS[getLanguage()];
  const banner = document.createElement('div');
  banner.className = 'consent-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', labels.banner);

  const text = document.createElement('div');
  text.className = 'consent-banner-text';
  const actions = document.createElement('div');
  actions.className = 'consent-banner-actions';

  const hide = () => { banner.hidden = true; };
  section.querySelectorAll('.default-content-wrapper > *').forEach((el) => {
    const choices = [...el.querySelectorAll('a[href*="#accept"], a[href*="#decline"]')];
    if (!choices.length) {
      text.append(el);
      return;
    }
    choices.forEach((a) => {
      const accept = a.getAttribute('href').includes('#accept');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = accept ? 'consent-accept' : 'consent-decline';
      button.textContent = a.textContent.trim();
      button.addEventListener('click', () => {
        setConsent(accept);
        hide();
      });
      actions.append(button);
    });
  });

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'consent-close';
  close.setAttribute('aria-label', labels.close);
  close.addEventListener('click', hide);

  banner.append(text, actions, close);
  banner.hidden = getConsent() !== null;

  // links to #consent (re)open the banner
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href$="#consent"]');
    if (!link) return;
    e.preventDefault();
    banner.hidden = false;
  });
  return banner;
}

/**
 * loads and decorates the footer
 * @param {Element} block The footer block element
 */
export default async function decorate(block) {
  // load footer as fragment of the current language
  const footerMeta = getMetadata('footer');
  const footerPath = footerMeta ? new URL(footerMeta, window.location).pathname : `/${getLanguage()}/footer`;
  const fragment = await loadFragment(footerPath);
  if (!fragment) return;

  // decorate footer DOM
  block.textContent = '';
  const footer = document.createElement('div');
  const consent = fragment.querySelector(':scope > .section.consent');
  if (consent) consent.remove();
  while (fragment.firstElementChild) footer.append(fragment.firstElementChild);

  footer.querySelectorAll('a[href*="instagram.com"]').forEach((a) => {
    a.classList.add('footer-social');
    a.closest('p')?.classList.add('footer-social-wrapper');
    if (!a.getAttribute('aria-label')) a.setAttribute('aria-label', 'Instagram');
  });
  footer.querySelectorAll('.button').forEach((a) => { a.className = ''; });
  footer.querySelectorAll('.button-wrapper').forEach((p) => { p.className = ''; });

  block.append(footer);
  if (consent) block.append(buildConsentBanner(consent));
}
