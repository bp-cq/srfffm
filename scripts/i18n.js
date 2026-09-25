/**
 * Language handling. German is the base language, English its translation; both live in
 * language folders (/de/..., /en/...) with identical page paths.
 */
export const LANGUAGES = ['de', 'en'];
export const DEFAULT_LANGUAGE = 'de';

/**
 * Returns the language of a path, based on its first folder.
 * @param {string} [pathname] The path, defaults to the current page
 * @returns {string} The language code
 */
export function getLanguage(pathname = window.location.pathname) {
  const [, first] = pathname.split('/');
  return LANGUAGES.includes(first) ? first : DEFAULT_LANGUAGE;
}

/**
 * Whether the path lives inside a language folder.
 * @param {string} [pathname] The path, defaults to the current page
 * @returns {boolean}
 */
export function isLocalizedPath(pathname = window.location.pathname) {
  return LANGUAGES.includes(pathname.split('/')[1]);
}

/**
 * Returns the equivalent path in another language.
 * @param {string} lang The target language
 * @param {string} [pathname] The path, defaults to the current page
 * @returns {string} The path in the target language
 */
export function getLocalizedPath(lang, pathname = window.location.pathname) {
  if (!isLocalizedPath(pathname)) return `/${lang}/`;
  const rest = pathname.split('/').slice(2).join('/');
  return `/${lang}/${rest}`;
}

/**
 * Picks the site language from the browser preferences: the first preferred language that
 * is German or English wins, German otherwise.
 * @param {readonly string[]} [preferences] Browser language preferences
 * @returns {string} The language code
 */
export function getPreferredLanguage(preferences = navigator.languages || [navigator.language]) {
  const match = (preferences || [])
    .map((pref) => (pref || '').toLowerCase().split('-')[0])
    .find((code) => LANGUAGES.includes(code));
  return match || DEFAULT_LANGUAGE;
}
