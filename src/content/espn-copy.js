// shared by the scripts that rewrite copies of ESPN's own elements with synced data
// runs as a content script (exposes globalThis.NSSCopy)
(function () {
  // a copy of an ESPN element, marked as ours and without ids that would clash
  function prepare(original) {
    const copy = original.cloneNode(true);
    copy.setAttribute('data-nss-copy', '');
    for (const el of [copy, ...copy.querySelectorAll('[id]')]) el.removeAttribute('id');
    return copy;
  }

  // writes text into a copy and remembers what it wrote
  // clearRest() then blanks all other text containing a digit (or any text, with allText)
  // so anything we couldn't match shows blank, never ESPN's live value
  // text inside `keepSelector` (labels like "3PT", team names) stays
  function writer() {
    const written = new WeakSet();
    return {
      set(el, text) {
        el.textContent = text;
        written.add(el);
        for (const n of el.childNodes) written.add(n);
      },
      // just one text node, leaving the element's other children (like a "Home" label)
      setNode(node, text) {
        node.nodeValue = text;
        written.add(node);
      },
      clearRest(root, keepSelector, { allText = false } = {}) {
        const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
        const stale = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          // pure punctuation (the brackets around a record) carries nothing, so it stays
          const clear = allText ? /[\p{L}\p{N}]/u.test(n.nodeValue) : /\d/.test(n.nodeValue);
          if (clear && !written.has(n) && !(keepSelector && n.parentElement?.closest(keepSelector))) stale.push(n);
        }
        for (const n of stale) n.nodeValue = '';
        return stale.length;
      },
    };
  }

  // text directly inside an element, not counting its children
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim();

  // point a <picture> or <img> (or the first one inside `container`) at src
  // ESPN loads images lazily, only once they're on screen, so hidden originals (and their
  // copies) are often still empty placeholders
  function setImage(container, src, alt) {
    const target = container?.matches?.('picture, img') ? container : container?.querySelector('picture, img');
    if (!target) return;
    const isImg = target.tagName.toLowerCase() === 'img';
    const img = isImg ? target : target.querySelector('img') || target.appendChild(target.ownerDocument.createElement('img'));
    if (!isImg) for (const source of target.querySelectorAll('source')) source.remove();
    for (const a of [...img.attributes]) if (a.name === 'srcset' || a.name === 'loading' || a.name.startsWith('data-')) img.removeAttribute(a.name);
    if (src) img.setAttribute('src', src);
    img.style.visibility = src ? '' : 'hidden';
    img.setAttribute('alt', alt ?? '');
  }

  globalThis.NSSCopy = { prepare, writer, ownText, setImage };
})();
