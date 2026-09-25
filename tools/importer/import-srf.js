/* eslint-disable */
/* global WebImporter */

/**
 * Import script for srf-frankfurt.de (Wix) → AEM Edge Delivery Services (Document Authoring).
 *
 * One script covers all page templates of the site. The target document is chosen by URL:
 *   https://www.srf-frankfurt.de/<page>?lang=de  → /de/<page>   (German, base language)
 *   https://www.srf-frankfurt.de/<page>          → /en/<page>   (English translation)
 *   ...#nav / #footer                            → /<lang>/nav, /<lang>/footer
 *   ...#root                                     → /index (language selection root)
 *   services                                     → /<lang>/fragments/events-intro
 *                                                  (the events page itself is rendered by json2html)
 */

import {
  getLang, getSlug, mapHref, cleanImageUrl, coverImageParagraph, isEmptyText, createImage, imageParagraph, convertRichText,
  convertComponents, componentsOf, parseStrip, backgroundImage, hr, sectionMetadata, block, cell,
} from './transformers/srf-wix.js';

/*
 * Wix pages ship an AMD loader (a non-configurable global `define`), so the injected
 * helix-importer bundle registers itself as an AMD module instead of `window.WebImporter`.
 * Re-evaluate the injected bundle with `define` hidden to expose the global.
 */
(function exposeWebImporter() {
  if (typeof window === 'undefined' || window.WebImporter) return;
  const source = [...document.querySelectorAll('script:not([src])')]
    .find((s) => s.textContent.length > 500000 && s.textContent.includes('WebImporter'));
  if (!source) return;
  const savedDefine = window.define;
  window.define = undefined;
  try {
    const el = document.createElement('script');
    el.textContent = source.textContent;
    document.head.append(el);
  } finally {
    window.define = savedDefine;
  }
}());

const TEXTS = {
  de: {
    root: 'Deutsch', languageLabel: 'Deutsch', decline: 'Ablehnen', accept: 'Akzeptieren',
    mapTitle: 'Karte: Gutenbergstraße 5, 65830 Kriftel', nameImage: 'Name und Telefonnummer des Verantwortlichen',
  },
  en: {
    root: 'English', languageLabel: 'English', decline: 'Decline', accept: 'Accept',
    mapTitle: 'Map: Gutenbergstraße 5, 65830 Kriftel', nameImage: 'Name and phone number of the responsible person',
  },
};

const MAP_URL = 'https://www.google.com/maps/search/?api=1&query=Gutenbergstra%C3%9Fe%205%2C%2065830%20Kriftel';

function pageMain(document) {
  return document.querySelector('#PAGES_CONTAINER') || document.querySelector('main');
}

/** Top-level Wix page sections */
function pageSections(document) {
  return [...pageMain(document).querySelectorAll('section.wixui-section')]
    .filter((s) => !s.parentElement.closest('section.wixui-section'));
}

/** Strips (column sections) with content */
function contentStrips(section) {
  return componentsOf(section).filter((c) => c.matches('.wixui-column-strip'))
    .filter((strip) => parseStrip(strip).some((c) => c.comps.length || c.bg));
}

/** Loose components of a section (outside strips) */
function looseComponents(section) {
  return componentsOf(section).filter((c) => !c.matches('.wixui-column-strip'));
}

const CONTENT = '[data-testid="richTextElement"], .wixui-image, a.wixui-button';

/** All content components anywhere inside an element (Wix often overlays text on strips) */
function allContent(el) {
  return componentsOf(el).length !== undefined
    ? [...el.querySelectorAll(CONTENT)]
      .filter((c) => !c.closest('.wixui-slideshow'))
      .filter((c) => !c.parentElement.closest(CONTENT))
      .filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return Math.abs(ra.top - rb.top) > 4 ? ra.top - rb.top : ra.left - rb.left;
      })
    : [];
}

/** Builds a columns row from a parsed strip */
function columnsRow(document, strip, lang, { coverScale = 2 } = {}) {
  return parseStrip(strip).map(({ col, bg, comps }) => {
    if (!comps.length && bg) {
      if (coverScale > 1) return cell(document, [coverImageParagraph(document, bg, col)]);
      return cell(document, [imageParagraph(document, bg, { scale: coverScale, lang })]);
    }
    return cell(document, convertComponents(document, comps, lang));
  });
}

function metadata(document, meta) {
  return WebImporter.Blocks.getMetadataBlock(document, meta);
}

/* ---------------------------------------------------------------- pages */

function buildHome(document, main, lang) {
  const slides = window.__srfSlides || [];
  if (slides.length) {
    const rows = slides.map((s) => {
      const img = document.createElement('img');
      img.src = s.src;
      img.alt = '';
      const text = document.createElement('div');
      text.innerHTML = s.html;
      return [cell(document, [img]), cell(document, [...text.childNodes])];
    });
    main.append(block(document, 'Slideshow', rows), hr(document));
  }
  const sections = pageSections(document);
  const content = sections.find((s) => contentStrips(s).length);
  const intro = looseComponents(content).filter((c) => c.matches('[data-testid="richTextElement"]'));
  intro.forEach((c) => convertRichText(document, c, lang, { highlight: true }).forEach((n) => main.append(n)));
  main.append(sectionMetadata(document, 'intro'), hr(document));
  const rows = contentStrips(content).map((strip) => columnsRow(document, strip, lang));
  main.append(block(document, 'Columns (tiles)', rows));
}

function buildAbout(document, main, lang) {
  const rows = pageSections(document).flatMap((s) => contentStrips(s))
    .map((strip) => columnsRow(document, strip, lang, { coverScale: 1 }));
  main.append(block(document, 'Columns', rows));
}

function buildNews(document, main, lang) {
  const rows = pageSections(document).flatMap((s) => contentStrips(s))
    .map((strip) => columnsRow(document, strip, lang));
  main.append(block(document, 'Columns (split)', rows));
}

function buildEventsIntro(document, main, lang) {
  const comps = pageSections(document).flatMap((s) => allContent(s))
    .filter((c) => c.matches('[data-testid="richTextElement"]'));
  convertComponents(document, comps, lang).forEach((n) => main.append(n));
}

function buildSrf(document, main, lang) {
  const strips = pageSections(document).flatMap((s) => contentStrips(s));
  let quote = [];
  let first = true;
  strips.forEach((strip) => {
    const cells = parseStrip(strip);
    if (cells.length === 1) {
      // quote strip: hidden behind the next strip on the source desktop layout, shown at the end
      quote = convertComponents(document, cells[0].comps, lang, { allowHeadings: false, accent: true });
      return;
    }
    if (!first) main.append(hr(document));
    main.append(block(document, first ? 'Columns (first-white)' : 'Columns (split)', [columnsRow(document, strip, lang)]));
    first = false;
  });
  if (quote.length) {
    main.append(hr(document));
    quote.forEach((n) => main.append(n));
    main.append(sectionMetadata(document, 'quote'));
  }
}

function buildMeditation(document, main, lang) {
  const sections = pageSections(document);
  const rows = sections.flatMap((s) => contentStrips(s)).filter((s) => parseStrip(s).length > 1)
    .map((strip) => columnsRow(document, strip, lang, { coverScale: 1 }));
  main.append(block(document, 'Columns', rows), sectionMetadata(document, 'white'), hr(document));
  const quoteComps = sections.flatMap((s) => [...looseComponents(s), ...contentStrips(s)
    .filter((st) => parseStrip(st).length === 1).flatMap((st) => parseStrip(st)[0].comps)]);
  convertComponents(document, quoteComps, lang, { allowHeadings: false, accent: true }).forEach((n) => main.append(n));
  main.append(sectionMetadata(document, 'quote'));
}

function buildContact(document, main, lang) {
  const [first, second] = pageSections(document);
  const texts = allContent(first).filter((c) => c.matches('[data-testid="richTextElement"]'));
  const images = allContent(first).filter((c) => c.matches('.wixui-image'));
  const textNodes = texts.flatMap((t) => convertRichText(document, t, lang, { allowHeadings: false }));
  const imageNodes = images.map((i) => imageParagraph(document, i.querySelector('img'), { lang }));
  main.append(block(document, 'Columns (wide)', [[cell(document, textNodes), cell(document, imageNodes)]]));
  main.append(sectionMetadata(document, 'white'), hr(document));
  const link = document.createElement('a');
  link.href = MAP_URL;
  link.textContent = TEXTS[lang].mapTitle;
  main.append(block(document, 'Map', [[link]]));
  allContent(second).filter((c) => c.matches('.wixui-image'))
    .forEach((i) => main.append(imageParagraph(document, i.querySelector('img'), { lang })));
}

function buildPrivacy(document, main, lang) {
  const comps = pageSections(document).flatMap((s) => allContent(s));
  convertComponents(document, comps, lang).forEach((n) => main.append(n));
}

function buildImprint(document, main, lang) {
  const strip = pageSections(document).flatMap((s) => contentStrips(s))[0];
  const [imageCol, textCol] = parseStrip(strip);
  const texts = textCol.comps.filter((c) => c.matches('[data-testid="richTextElement"]'));
  const nameImage = pageSections(document).flatMap((s) => allContent(s))
    .find((c) => c.matches('.wixui-image') && !c.closest('[data-hook="bgLayers"]'));
  const nodes = texts.flatMap((t) => convertRichText(document, t, lang));
  if (nameImage) {
    const p = imageParagraph(document, nameImage.querySelector('img'), { alt: TEXTS[lang].nameImage, lang });
    const anchor = nodes.find((n) => /RStV|TMG/.test(n.textContent));
    nodes.splice(anchor ? nodes.indexOf(anchor) + 1 : nodes.length, 0, p);
  }
  const rows = [[cell(document, [coverImageParagraph(document, imageCol.bg, imageCol.col, { width: 480 })]), cell(document, nodes)]];
  main.append(block(document, 'Columns (aside)', rows));
}

/* ------------------------------------------------------- nav, footer, root */

function buildNav(document, main, lang) {
  const header = document.querySelector('#SITE_HEADER, header');
  const banner = [...header.querySelectorAll('.wixui-image img')].sort((a, b) => b.width - a.width)[0];
  if (banner) main.append(imageParagraph(document, banner, { scale: 1, alt: '', lang }));
  const brand = header.querySelector('[data-testid="richTextElement"]');
  const home = `/${lang}/`;
  // lettering lines grouped by typeface: logo lettering, then the subline
  const lines = [];
  let lastFont = null;
  [...brand.querySelectorAll('a')].filter((a) => !isEmptyText(a.textContent)).forEach((a) => {
    const textEl = [...a.querySelectorAll('*')].find((e) => !e.children.length && !isEmptyText(e.textContent)) || a;
    const font = getComputedStyle(textEl).fontFamily;
    if (font !== lastFont) lines.push([]);
    lastFont = font;
    lines[lines.length - 1].push(a.textContent.trim());
  });
  lines.forEach((parts) => {
    const p = document.createElement('p');
    const a = document.createElement('a');
    a.href = home;
    parts.forEach((part, i) => {
      if (i) a.append(document.createElement('br'));
      a.append(document.createTextNode(part.replace(/\s+/g, ' ')));
    });
    p.append(a);
    main.append(p);
  });
  main.append(hr(document));
  const languages = document.createElement('ul');
  [['de', ':flag-de:', 'Deutsch'], ['en', ':flag-us:', 'English']].forEach(([l, icon, label]) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/${l}/`;
    a.textContent = `${icon} ${label}`;
    li.append(a);
    languages.append(li);
  });
  main.append(languages, hr(document));
  const menu = document.createElement('ul');
  header.querySelectorAll('nav a[data-testid="linkElement"]').forEach((a) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = mapHref(a.getAttribute('href'), lang);
    link.textContent = a.textContent.trim();
    li.append(link);
    menu.append(li);
  });
  main.append(menu);
  main.append(metadata(document, { Robots: 'noindex, nofollow' }));
}

function buildFooter(document, main, lang) {
  const footer = document.querySelector('#SITE_FOOTER, footer');
  const social = footer.querySelector('a[href*="instagram"]');
  if (social) {
    const p = document.createElement('p');
    const a = document.createElement('a');
    a.href = social.href;
    const img = social.querySelector('img');
    a.append(createImage(document, img, { scale: 2, alt: 'Instagram' }));
    p.append(a);
    main.append(p);
  }
  const texts = componentsOf(footer).filter((c) => c.matches('[data-testid="richTextElement"]'));
  const list = document.createElement('ul');
  texts.forEach((t) => {
    const links = [...t.querySelectorAll('a')];
    if (links.length === 1 && links[0].textContent.trim() === t.textContent.trim()) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = mapHref(links[0].getAttribute('href'), lang);
      a.textContent = links[0].textContent.trim();
      li.append(a);
      list.append(li);
    } else {
      convertRichText(document, t, lang, { allowHeadings: false }).forEach((n) => main.append(n));
    }
  });
  main.append(list);

  // cookie notice
  const banner = document.querySelector('[data-hook="consent-banner-root"]') || window.__srfConsent;
  if (banner) {
    main.append(hr(document));
    const desc = banner.querySelector('[data-hook="consent-banner-description"]');
    const p = document.createElement('p');
    desc.childNodes.forEach((n) => {
      if (n.nodeType === 3) p.append(document.createTextNode(n.textContent));
      else if (n.tagName === 'A') {
        const a = document.createElement('a');
        a.href = mapHref(n.getAttribute('href'), lang);
        a.textContent = n.textContent.trim();
        p.append(a);
      } else if (n.tagName === 'BR') p.append(document.createElement('br'));
      else p.append(document.createTextNode(n.textContent));
    });
    main.append(p);
    const choices = document.createElement('p');
    [['#decline', TEXTS[lang].decline], ['#accept', TEXTS[lang].accept]].forEach(([href, label], i) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      if (i) choices.append(document.createTextNode(' '));
      choices.append(a);
    });
    main.append(choices, sectionMetadata(document, 'consent'));
  }
  main.append(metadata(document, { Robots: 'noindex, nofollow' }));
}

function buildRoot(document, main) {
  const h1 = document.createElement('h1');
  h1.textContent = 'Meditationsgruppe Frankfurt Rhein-Main';
  main.append(h1);
  const list = document.createElement('ul');
  [['de', 'Deutsch'], ['en', 'English']].forEach(([l, label]) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/${l}/`;
    a.textContent = label;
    li.append(a);
    list.append(li);
  });
  main.append(list);
  main.append(metadata(document, { Title: 'srf-frankfurt' }));
}

const PAGES = {
  index: buildHome,
  about: buildAbout,
  news: buildNews,
  services: buildEventsIntro,
  'self-realization-fellowship': buildSrf,
  meditation: buildMeditation,
  contact: buildContact,
  'privacy-policy': buildPrivacy,
  imprint: buildImprint,
};

/** Scrolls through the page so lazy content loads and captures all slideshow slides */
async function prepare(document) {
  const win = document.defaultView;
  const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
  const height = document.body.scrollHeight;
  for (let y = 0; y < height + 900; y += 400) {
    win.scrollTo(0, y);
    // eslint-disable-next-line no-await-in-loop
    await wait(150);
  }
  win.scrollTo(0, 0);
  await wait(800);
  // Wix separates paragraphs with empty (nbsp) paragraphs, which the importer would drop
  // before the transform runs; mark them with a zero-width space so they survive.
  document.querySelectorAll('[data-testid="richTextElement"] :is(p, h1, h2, h3, h4, h5, h6)').forEach((p) => {
    if (isEmptyText(p.textContent) && !p.querySelector('img')) p.textContent = '\u200b';
  });
  if (win.location.hash === '#footer' && !document.querySelector('[data-hook="consent-banner-root"]')) {
    // the importer may have accepted the cookie banner; reset consent and load the page in a frame
    document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => /consent/i.test(n))
      .forEach((n) => {
        document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
        document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.srf-frankfurt.de`;
      });
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:-3000px;top:0;width:1440px;height:900px';
    frame.src = win.location.href.split('#')[0];
    document.body.append(frame);
    for (let i = 0; i < 40; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await wait(500);
      const found = frame.contentDocument && frame.contentDocument.querySelector('[data-hook="consent-banner-root"]');
      if (found) {
        win.__srfConsent = document.importNode(found, true);
        break;
      }
    }
    frame.remove();
  }
  const show = document.querySelector('.wixui-slideshow');
  if (show) {
    const slides = [];
    const next = show.querySelector('[data-testid="nextButton"]');
    for (let i = 0; i < 12; i += 1) {
      const img = show.querySelector('img');
      const src = img && (img.currentSrc || img.src);
      if (!src || slides.some((s) => s.key === src.split('/v1/')[0])) break;
      const text = show.querySelector('[data-testid="richTextElement"]');
      const holder = document.createElement('div');
      if (text) {
        const lang = getLang(win.location.href);
        convertRichText(document, text, lang, { allowHeadings: false }).forEach((n) => holder.append(n));
      }
      slides.push({ key: src.split('/v1/')[0], src: cleanImageUrl(src, 2), html: holder.innerHTML });
      if (!next) break;
      next.click();
      // eslint-disable-next-line no-await-in-loop
      await wait(2600);
    }
    win.__srfSlides = slides;
  }
}

export default {
  onLoad: async ({ document }) => {
    await prepare(document);
  },

  transform: ({ document, url, params }) => {
    const originalUrl = params?.originalURL || url;
    const u = new URL(originalUrl);
    const lang = getLang(originalUrl);
    const slug = getSlug(originalUrl);
    const target = u.hash.replace('#', '');
    const main = document.createElement('main');
    let path;

    if (target === 'nav') {
      buildNav(document, main, lang);
      path = `/${lang}/nav`;
    } else if (target === 'footer') {
      buildFooter(document, main, lang);
      path = `/${lang}/footer`;
    } else if (target === 'root') {
      buildRoot(document, main);
      path = '/index';
    } else {
      const build = PAGES[slug];
      if (!build) throw new Error(`No template for ${slug}`);
      build(document, main, lang);
      if (slug === 'services') {
        path = `/${lang}/fragments/events-intro`;
        main.append(metadata(document, { Robots: 'noindex, nofollow' }));
      } else {
        path = `/${lang}/${slug}`;
        main.append(metadata(document, { Title: document.title }));
      }
    }

    return [{
      element: main,
      path,
      report: { lang, slug, target: target || 'page' },
    }];
  },
};
