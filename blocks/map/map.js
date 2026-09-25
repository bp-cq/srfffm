import { getConsent } from '../../scripts/consent.js';
import { getLanguage } from '../../scripts/i18n.js';

const LABELS = {
  de: {
    notice: 'Beim Anzeigen der Karte werden Daten an Google übertragen.',
    show: 'Karte anzeigen',
    title: 'Karte',
  },
  en: {
    notice: 'Showing the map transfers data to Google.',
    show: 'Show map',
    title: 'Map',
  },
};

/**
 * Builds the Google Maps embed URL from an authored Google Maps link.
 * @param {string} href The authored link
 * @returns {string} The embed URL
 */
function embedUrl(href) {
  const url = new URL(href);
  const query = url.searchParams.get('query') || url.searchParams.get('q')
    || decodeURIComponent(url.pathname.split('/place/')[1]?.split('/')[0] || '').replace(/\+/g, ' ');
  const embed = new URL('https://maps.google.com/maps');
  embed.searchParams.set('q', query);
  embed.searchParams.set('z', url.searchParams.get('zoom') || '15');
  embed.searchParams.set('hl', getLanguage());
  embed.searchParams.set('output', 'embed');
  return embed.href;
}

/**
 * Replaces the placeholder with the map iframe.
 * @param {Element} block The map block
 * @param {string} src The embed URL
 * @param {string} title The iframe title
 */
function loadMap(block, src, title) {
  if (block.querySelector('iframe')) return;
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = title;
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'no-referrer-when-downgrade';
  iframe.setAttribute('allowfullscreen', '');
  block.querySelector('.map-frame').replaceChildren(iframe);
}

/**
 * Google Maps embed that only loads after consent (cookie banner) or an explicit click.
 * @param {Element} block The map block
 */
export default function decorate(block) {
  const link = block.querySelector('a[href]');
  if (!link) return;
  const labels = LABELS[getLanguage()];
  const src = embedUrl(link.href);
  const title = link.textContent.trim() || labels.title;

  const frame = document.createElement('div');
  frame.className = 'map-frame';
  const placeholder = document.createElement('div');
  placeholder.className = 'map-placeholder';
  const notice = document.createElement('p');
  notice.textContent = labels.notice;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button';
  button.textContent = labels.show;
  button.addEventListener('click', () => loadMap(block, src, title));
  const external = document.createElement('p');
  link.className = '';
  external.append(link);
  placeholder.append(notice, button, external);
  frame.append(placeholder);
  block.replaceChildren(frame);

  if (getConsent() === true) loadMap(block, src, title);
  window.addEventListener('consent.update', (e) => {
    if (e.detail?.consented) loadMap(block, src, title);
  });
}
