// Shared by the scripts that rewrite copies of ESPN's own elements (box score, score
// strip) with synced data. Runs as a content script (exposes globalThis.NSSCopy).
(function () {
  // A copy of an ESPN element, marked as ours and without ids that would clash.
  function prepare(original) {
    const copy = original.cloneNode(true);
    copy.setAttribute('data-nss-copy', '');
    for (const el of [copy, ...copy.querySelectorAll('[id]')]) el.removeAttribute('id');
    return copy;
  }

  // Writes text into a copy and remembers what it wrote. clearRest() then blanks every
  // other piece of text that contains a digit (or, with allText, every other piece of
  // text), so anything we couldn't match shows blank, never ESPN's live value. Text inside
  // `keepSelector` (labels like "3PT", team names) stays.
  function writer() {
    const written = new WeakSet();
    return {
      set(el, text) {
        el.textContent = text;
        written.add(el);
        for (const n of el.childNodes) written.add(n);
      },
      // Just one text node, leaving the element's other children (e.g. a "Home" label).
      setNode(node, text) {
        node.nodeValue = text;
        written.add(node);
      },
      clearRest(root, keepSelector, { allText = false } = {}) {
        const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
        const stale = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          // Pure punctuation (the brackets around a record) carries nothing, so it stays.
          const clear = allText ? /[\p{L}\p{N}]/u.test(n.nodeValue) : /\d/.test(n.nodeValue);
          if (clear && !written.has(n) && !(keepSelector && n.parentElement?.closest(keepSelector))) stale.push(n);
        }
        for (const n of stale) n.nodeValue = '';
        return stale.length;
      },
    };
  }

  // Text directly inside an element, not counting its children.
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim();

  globalThis.NSSCopy = { prepare, writer, ownText };
})();
