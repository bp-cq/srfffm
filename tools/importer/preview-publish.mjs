/*
 * Previews (and optionally publishes) the migrated documents via the AEM admin API.
 * usage: node tools/importer/preview-publish.mjs [--publish] [--ref main] [path ...]
 * Requests to admin.hlx.page are authenticated by the environment (no token in this script).
 */
import { execFileSync } from 'child_process';

const ORG = 'bp-cq';
const SITE = 'srfffm';
const args = process.argv.slice(2);
const publish = args.includes('--publish');
const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : 'main';

const PAGES = ['index', 'about', 'news', 'services', 'self-realization-fellowship', 'meditation',
  'contact', 'privacy-policy', 'imprint', 'nav', 'footer', 'fragments/events-intro'];
const DEFAULT_PATHS = ['/', ...['de', 'en'].flatMap((l) => PAGES.map((p) => (p === 'index' ? `/${l}/` : `/${l}/${p}`)))];

function post(route, path) {
  const url = `https://admin.hlx.page/${route}/${ORG}/${SITE}/${ref}${path}`;
  const out = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', url]).toString();
  return Number(out);
}

const paths = args.filter((a) => a.startsWith('/'));
(paths.length ? paths : DEFAULT_PATHS).forEach((path) => {
  const preview = post('preview', path);
  const live = publish && preview < 300 ? post('live', path) : '-';
  console.log(`${path}  preview ${preview}  live ${live}`);
});
