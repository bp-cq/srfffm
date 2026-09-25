import { getConsent } from './consent.js';

let consentedLoaded = false;

/**
 * Consent check.
 *
 * Consent is declined until the visitor accepts it in the cookie banner (see the footer
 * block), so consented scripts (analytics, martech, etc.) are not loaded by default.
 * This stands in for a real CMP (OneTrust, etc.) and can be swapped out later.
 *
 * The stored choice can be overridden with a query parameter for testing:
 *   ?consent=accept   grant consent (loads consented.js)
 *   ?consent=decline  decline consent (default behavior)
 *
 * @returns {boolean} true if the user has consented
 */
function hasConsent() {
  return getConsent() === true;
}

/**
 * Loads consented scripts once consent is available.
 */
function loadConsented() {
  if (consentedLoaded) return;
  consentedLoaded = true;
  import('./consented.js');
}

/**
 * Notifies listeners of the current consent state and loads consented
 * scripts if consent has been granted.
 */
function onConsentUpdate() {
  const consented = hasConsent();
  window.dispatchEvent(new CustomEvent('consent.update', { detail: { consented } }));
  if (consented) {
    loadConsented();
  }
}

// consent granted later via the cookie banner
window.addEventListener('consent.update', (e) => {
  if (e.detail?.consented) loadConsented();
});

onConsentUpdate();
