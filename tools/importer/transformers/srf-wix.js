/* eslint-disable */
/* global WebImporter */

/**
 * Helpers that turn the rendered Wix DOM of srf-frankfurt.de into clean,
 * Edge Delivery friendly markup. They run inside the live source page, so
 * computed styles are available.
 */

export const ORANGE = 'rgb(222, 107, 47)';
const SITE_HOST = 'srf-frankfurt.de';
const EMPTY_RE = /^[\s​ ﻿]*$/;

export function getLang(url) {
  const u = new URL(url);
  return u.searchParams.get('lang') === 'de' ? 'de' : 'en';
}

export function getSlug(url) {
  const u = new URL(url);
  return u.pathname.replace(/^\/+|\/+$/g, '') || 'index';
}

/** Maps a source link to the migrated site (language folders) */
export function mapHref(href, lang) {
  if (!href) return href;
  let u;
  try {
    u = new URL(href, 'https://www.srf-frankfurt.de/');
  } catch (e) {
    return href;
  }
  if (u.protocol === 'mailto:' || u.protocol === 'tel:') return href;
  if (u.hostname.endsWith(SITE_HOST)) {
    const param = u.searchParams.get('lang');
    const linkLang = param === 'de' || param === 'en' ? param : lang;
    const path = u.pathname.replace(/\/+$/, '');
    return path ? `/${linkLang}${path}${u.hash}` : `/${linkLang}/${u.hash}`;
  }
  // drop analytics tracking parameters
  ['_ga', '_gl', 'fbclid'].forEach((p) => u.searchParams.delete(p));
  return u.href;
}

export function isEmptyText(text) {
  return EMPTY_RE.test(text || '');
}

function cleanText(text) {
  return text.replace(/[​﻿]/g, '');
}

/** Returns a clean Wix image URL (no AVIF/blur/LQIP params), optionally scaled */
export function cleanImageUrl(src, scale = 1, maxWidth = 2880) {
  if (!src) return src;
  let url = src
    .replace(/,enc_[a-z]+/g, '')
    .replace(/,quality_auto/g, '')
    .replace(/,blur_\d+/g, '')
    .replace(/,lg_\d+/g, '');
  if (scale !== 1) {
    url = url.replace(/\/fill\/w_(\d+),h_(\d+)/, (m, w, h) => {
      const s = Math.min(scale, maxWidth / w);
      return `/fill/w_${Math.round(w * s)},h_${Math.round(h * s)}`;
    });
  }
  return url;
}

/** Cleans Wix alt texts which are often file names */
export function cleanAlt(alt) {
  let a = (alt || '').trim();
  a = a.replace(/\.(png|jpe?g|gif|webp)$/i, '').replace(/_edited$/i, '').trim();
  if (/^(noun_|img[-_]|unbenannt|shutterstock|\d+$)/i.test(a)) return '';
  return a;
}

/** Creates an image element for a Wix image */
export function createImage(document, img, { scale = 1, alt } = {}) {
  const el = document.createElement('img');
  el.src = cleanImageUrl(img.currentSrc || img.src, scale);
  el.alt = alt !== undefined ? alt : cleanAlt(img.alt);
  return el;
}

function styleOf(el) {
  return el.ownerDocument.defaultView.getComputedStyle(el);
}

/** Converts inline content, keeping bold/italic/links relative to the block style */
function convertInline(document, node, lang, base) {
  const frag = document.createDocumentFragment();
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      const text = cleanText(child.textContent);
      if (text) frag.append(document.createTextNode(text));
      return;
    }
    if (child.nodeType !== 1) return;
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') {
      frag.append(document.createElement('br'));
      return;
    }
    if (['script', 'style', 'svg', 'button'].includes(tag)) return;
    const inner = convertInline(document, child, lang, base);
    if (tag === 'a') {
      const href = child.getAttribute('href');
      if (!inner.textContent.trim()) return;
      const a = document.createElement('a');
      a.href = mapHref(href, lang);
      a.append(inner);
      frag.append(a);
      return;
    }
    let wrapped = inner;
    // formatting is added where it starts, i.e. relative to the parent element
    const cs = styleOf(child);
    const ps = styleOf(child.parentElement);
    const bold = Number(cs.fontWeight) >= 600 && Number(ps.fontWeight) < 600;
    const italic = cs.fontStyle === 'italic' && ps.fontStyle !== 'italic';
    const colored = base.highlight && cs.color === ORANGE && ps.color !== ORANGE;
    if ((bold || colored) && inner.textContent.trim()) {
      const s = document.createElement('strong');
      s.append(wrapped);
      wrapped = s;
    }
    if (italic && inner.textContent.trim()) {
      const e = document.createElement('em');
      e.append(wrapped);
      wrapped = e;
    }
    frag.append(wrapped);
  });
  return frag;
}

/** Style of the first visible text inside an element */
function textStyle(el) {
  const walker = el.ownerDocument.createTreeWalker(el, 4);
  let n = walker.nextNode();
  while (n && isEmptyText(n.textContent)) n = walker.nextNode();
  return styleOf(n ? n.parentElement : el);
}

/** Heading level from the rendered style, or null for body text */
function headingLevel(el) {
  const cs = textStyle(el);
  if (cs.color !== ORANGE) return null;
  const size = parseFloat(cs.fontSize);
  const italic = cs.fontStyle === 'italic';
  const bold = Number(cs.fontWeight) >= 600;
  if (italic && size >= 30) return 2;
  if (italic && size >= 22) return 3;
  if (italic) return 6;
  if (bold && size >= 19) return 4;
  if (bold || size >= 17) return 5;
  return null;
}

/**
 * Converts a Wix rich text element into clean block nodes.
 * Consecutive Wix paragraphs are joined with line breaks; empty Wix paragraphs
 * separate paragraphs.
 */
export function convertRichText(document, el, lang, { highlight = false, allowHeadings = true } = {}) {
  const out = [];
  let current = null;
  const flush = () => { current = null; };
  const blocks = [...el.children].flatMap((c) => (['div', 'section'].includes(c.tagName.toLowerCase()) ? [...c.children] : [c]));
  blocks.forEach((child) => {
    const tag = child.tagName.toLowerCase();
    const text = child.textContent;
    if (tag === 'ul' || tag === 'ol') {
      flush();
      const list = document.createElement(tag);
      child.querySelectorAll(':scope > li').forEach((li) => {
        if (isEmptyText(li.textContent)) return;
        const item = document.createElement('li');
        const base = styleOf(li);
        item.append(convertInline(document, li, lang, { fontWeight: base.fontWeight, fontStyle: base.fontStyle, color: base.color, highlight }));
        list.append(item);
      });
      if (list.children.length) out.push(list);
      return;
    }
    if (isEmptyText(text) && !child.querySelector('img')) {
      flush();
      return;
    }
    const level = allowHeadings ? headingLevel(child) : null;
    const base = styleOf(child);
    const inline = convertInline(document, child, lang, {
      fontWeight: base.fontWeight, fontStyle: base.fontStyle, color: base.color, highlight,
    });
    if (level) {
      flush();
      const h = document.createElement(`h${level}`);
      h.append(inline);
      // headings do not need emphasis markup
      h.querySelectorAll('strong, em').forEach((e) => e.replaceWith(...e.childNodes));
      out.push(h);
      return;
    }
    if (current) {
      current.append(document.createElement('br'), inline);
    } else {
      current = document.createElement('p');
      current.append(inline);
      out.push(current);
    }
  });
  // trim trailing line breaks
  out.forEach((node) => {
    while (node.lastChild && node.lastChild.nodeName === 'BR') node.lastChild.remove();
    while (node.firstChild && node.firstChild.nodeName === 'BR') node.firstChild.remove();
  });
  return out.filter((n) => n.textContent.trim() || n.querySelector('img'));
}

/** Wix button to an EDS button paragraph (bold link) */
export function convertButton(document, a, lang) {
  const p = document.createElement('p');
  const strong = document.createElement('strong');
  const link = document.createElement('a');
  link.href = mapHref(a.getAttribute('href'), lang);
  link.textContent = a.textContent.trim();
  strong.append(link);
  p.append(strong);
  return p;
}

export function imageParagraph(document, img, options) {
  const p = document.createElement('p');
  const image = createImage(document, img, options);
  const link = img.closest('a[href]');
  if (link && !link.classList.contains('wixui-button')) {
    const a = document.createElement('a');
    a.href = mapHref(link.getAttribute('href'), options?.lang);
    a.append(image);
    p.append(a);
  } else {
    p.append(image);
  }
  return p;
}

function top(el) {
  const r = el.getBoundingClientRect();
  return [r.top + el.ownerDocument.defaultView.scrollY, r.left];
}

function byPosition(a, b) {
  const [ta, la] = top(a);
  const [tb, lb] = top(b);
  return Math.abs(ta - tb) > 4 ? ta - tb : la - lb;
}

const COMPONENTS = '[data-testid="richTextElement"], .wixui-image, a.wixui-button, .wixui-google-map, .wixui-slideshow, .wixui-column-strip';

/** Visible components directly inside a container (not nested in another component) */
export function componentsOf(container) {
  const all = [...container.querySelectorAll(COMPONENTS)];
  return all
    .filter((el) => {
      const parent = el.parentElement.closest(COMPONENTS);
      return !parent || !container.contains(parent) || parent === container;
    })
    .filter((el) => el !== container)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .sort(byPosition);
}

/** Converts the components of a column into content nodes */
export function convertComponents(document, comps, lang, options = {}) {
  const nodes = [];
  comps.forEach((comp) => {
    if (comp.matches('[data-testid="richTextElement"]')) {
      nodes.push(...convertRichText(document, comp, lang, options));
    } else if (comp.matches('.wixui-image')) {
      const img = comp.querySelector('img');
      if (img) nodes.push(imageParagraph(document, img, { lang }));
    } else if (comp.matches('a.wixui-button')) {
      nodes.push(convertButton(document, comp, lang));
    }
  });
  return nodes;
}

/** Background image of a Wix column/strip, if any */
export function backgroundImage(el) {
  const layer = el.querySelector(`:scope > [data-hook="bgLayers"], #bgLayers_${el.id}`);
  return layer ? layer.querySelector('img') : null;
}

/** Parses a Wix column strip into cells */
export function parseStrip(strip) {
  const columns = [...strip.querySelectorAll('.wixui-column-strip__column')]
    .filter((c) => c.closest('.wixui-column-strip') === strip);
  return columns.map((col) => ({
    col,
    bg: backgroundImage(col),
    comps: componentsOf(col),
  }));
}

export function hr(document) {
  return document.createElement('hr');
}

export function sectionMetadata(document, style) {
  return WebImporter.DOMUtils.createTable([['Section Metadata'], ['Style', style]], document);
}

export function block(document, name, rows) {
  return WebImporter.DOMUtils.createTable([[name], ...rows], document);
}

export function cell(document, nodes) {
  const div = document.createElement('div');
  nodes.forEach((n) => div.append(n));
  return div;
}
