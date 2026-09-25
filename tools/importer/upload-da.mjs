/*
 * Uploads imported content (content/**.plain.html) to Document Authoring.
 * Images are copied from the Wix CDN into DA next to their document
 * (/<folder>/.<doc>/<image>) and the document references are rewritten.
 *
 * usage: node tools/importer/upload-da.mjs [--dry-run] [path ...]
 *   path: document path without extension, e.g. /de/about (default: all imported documents)
 * Requests to admin.da.live are authenticated by the environment (no token in this script).
 */
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const require = createRequire('/home/node/.excat-marketplaces/excat-marketplace/excat/skills/excat-content-import/scripts/package.json');
const { JSDOM } = require('jsdom');

const ORG = 'bp-cq';
const SITE = 'srfffm';
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const CONTENT = path.join(ROOT, 'content');
const STAGE = path.join(ROOT, 'migration-work', 'da');
const DRY = process.argv.includes('--dry-run');

const DOCS = [
  '/index',
  ...['de', 'en'].flatMap((l) => ['index', 'about', 'news', 'self-realization-fellowship', 'meditation',
    'contact', 'privacy-policy', 'imprint', 'nav', 'footer', 'fragments/events-intro'].map((p) => `/${l}/${p}`)),
];

function curl(args) {
  return execFileSync('curl', ['-s', '--fail-with-body', ...args], { maxBuffer: 64 * 1024 * 1024 });
}

/** File name for an image: readable base name from the Wix URL plus a short hash */
function imageName(src) {
  const u = new URL(src);
  const last = decodeURIComponent(u.pathname.split('/').pop());
  const ext = (last.match(/\.(jpe?g|png|gif|webp)$/i) || ['.jpg'])[0].toLowerCase().replace('.jpeg', '.jpg');
  const base = last.replace(/\.[a-z]+$/i, '').replace(/~mv2$/, '').toLowerCase()
    .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
  const hash = crypto.createHash('sha1').update(src).digest('hex').slice(0, 6);
  return `${base}-${hash}${ext}`;
}

function upload(daPath, file, type) {
  const url = `https://admin.da.live/source/${ORG}/${SITE}${daPath}`;
  if (DRY) {
    console.log(`  [dry-run] ${url}`);
    return;
  }
  curl(['-X', 'POST', '-F', `data=@${file};type=${type}`, url]);
  console.log(`  uploaded ${daPath}`);
}

function processDoc(docPath) {
  const src = path.join(CONTENT, `${docPath}.plain.html`);
  if (!fs.existsSync(src)) {
    console.warn(`missing ${src}`);
    return;
  }
  console.log(docPath);
  const dom = new JSDOM(`<body><main>${fs.readFileSync(src, 'utf8')}</main></body>`);
  const { document } = dom.window;
  const dir = path.posix.dirname(docPath);
  const doc = path.posix.basename(docPath);
  const mediaFolder = `${dir === '/' ? '' : dir}/.${doc}`;

  document.querySelectorAll('img[src^="http"]').forEach((img) => {
    const url = img.getAttribute('src');
    if (!/wixstatic\.com/.test(url)) return;
    const name = imageName(url);
    const local = path.join(STAGE, mediaFolder, name);
    fs.mkdirSync(path.dirname(local), { recursive: true });
    if (!fs.existsSync(local)) fs.writeFileSync(local, curl(['-L', url]));
    const type = name.endsWith('.png') ? 'image/png' : 'image/jpeg';
    upload(`${mediaFolder}/${name}`, local, type);
    img.setAttribute('src', `https://content.da.live/${ORG}/${SITE}${mediaFolder}/${name}`);
  });

  const html = `<body>\n  <header></header>\n  <main>${document.querySelector('main').innerHTML}</main>\n  <footer></footer>\n</body>\n`;
  const out = path.join(STAGE, `${docPath}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  upload(`${docPath}.html`, out, 'text/html');
}

const selected = process.argv.slice(2).filter((a) => a.startsWith('/'));
(selected.length ? selected : DOCS).forEach(processDoc);
