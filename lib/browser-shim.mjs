/**
 * Expose l'API `browser.*` sur Chromium (Chrome, Edge, etc.).
 * Sans effet sur Firefox où `browser` est déjà défini nativement.
 */
if (typeof globalThis.browser === 'undefined') {
  globalThis.browser = globalThis.chrome;
}
