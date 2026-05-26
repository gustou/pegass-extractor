/**
 * Variante classique pour les content scripts (chargée avant scraper.js).
 */
(function () {
  if (typeof globalThis.browser === 'undefined') {
    globalThis.browser = globalThis.chrome;
  }
})();
