// runs in the page's own JavaScript world so it can see ESPN's in-page navigation
// fires a DOM event the shield (in the extension's world) listens for
(() => {
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function (...args) {
      const result = original.apply(this, args);
      document.dispatchEvent(new Event('nss:navigated'));
      return result;
    };
  }
})();
