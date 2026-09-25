const STORAGE_KEY = 'srfffm-consent';

/**
 * Returns the visitor's consent choice.
 * A `?consent=accept|decline` query parameter overrides the stored choice (for testing).
 * @returns {boolean|null} true if accepted, false if declined, null if not decided yet
 */
export function getConsent() {
  const param = new URLSearchParams(window.location.search).get('consent');
  if (param !== null) return ['accept', 'true', '1', 'yes'].includes(param.toLowerCase());
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'accept') return true;
    if (stored === 'decline') return false;
  } catch (e) {
    // storage not available
  }
  return null;
}

/**
 * Stores the visitor's consent choice and notifies listeners via `consent.update`.
 * @param {boolean} consented Whether consent was granted
 */
export function setConsent(consented) {
  try {
    localStorage.setItem(STORAGE_KEY, consented ? 'accept' : 'decline');
  } catch (e) {
    // storage not available
  }
  window.dispatchEvent(new CustomEvent('consent.update', { detail: { consented } }));
}
