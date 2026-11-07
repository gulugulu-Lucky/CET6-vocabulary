/* CET-6 shared favorites: additive only; existing unit progress is untouched. */
(function () {
  'use strict';
  const STORAGE_KEY = 'cet6_favorite_words_v1';
  function normalize(word) {
    return String(word || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  }
  function read() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (_) { return {}; }
  }
  function has(word) { return Boolean(read()[normalize(word)]); }
  function count() { const favorites=read(); return Object.keys(favorites).filter(key => Boolean(favorites[key])).length; }
  function toggle(word) {
    const key = normalize(word);
    if (!key) return false;
    const favorites = read();
    const enabled = !favorites[key];
    if (enabled) favorites[key] = { addedAt: Date.now() };
    else delete favorites[key];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites)); }
    catch (error) {
      console.warn('收藏无法写入本地存储', error);
      return !enabled;
    }
    window.dispatchEvent(new CustomEvent('cet6:favorites-change', { detail: { key, enabled } }));
    return enabled;
  }
  const api = Object.freeze({ STORAGE_KEY, normalize, read, has, count, toggle });
  window.CET6Favorites = api;

  // When used on a regular library, decorate the existing card without
  // changing its meaning/IPA click handlers or the existing progress keys.
  const card = document.getElementById('card');
  if (!card || typeof currentItem !== 'function') return;
  const style = document.createElement('style');
  style.textContent = `
    .cet6-favorite-star {
      position:absolute;top:9px;right:10px;z-index:12;
      display:flex;justify-content:center;align-items:center;
      width:48px;height:48px;padding:0;border:none;
      border-radius:15px;background:rgba(255,251,244,.66);
      box-shadow:none;color:#b7b3c1;
      font:normal 34px/1 Arial,sans-serif;cursor:pointer;
      -webkit-tap-highlight-color:transparent;touch-action:manipulation;
    }
    .cet6-favorite-star[data-active="true"] {
      color:#dba748;background:rgba(255,247,226,.80);
      text-shadow:0 2px 9px rgba(217,166,71,.2);
    }
    .cet6-favorite-star:focus-visible {outline:2px solid #b7a4e8;outline-offset:2px}
    .cet6-favorite-star:active {transform:scale(.94)}
    .cet6-favorite-star[hidden] {display:none!important}
    @media(max-width:720px) {
      .cet6-favorite-star {top:7px;right:7px;width:44px;height:44px;font-size:30px}
    }
  `;
  document.head.appendChild(style);
  const star = document.createElement('button');
  star.type = 'button';
  star.className = 'cet6-favorite-star';
  star.id = 'cet6FavoriteStar';
  star.textContent = '☆';
  star.setAttribute('aria-label', '收藏单词');
  star.setAttribute('aria-pressed', 'false');
  star.title = '收藏 / 取消收藏';
  card.appendChild(star);
  function refresh() {
    const item = currentItem();
    const valid = Boolean(item && item.word);
    star.hidden = !valid;
    if (!valid) return;
    const enabled = api.has(item.word);
    star.textContent = enabled ? '★' : '☆';
    star.dataset.active = String(enabled);
    star.setAttribute('aria-pressed', String(enabled));
    star.setAttribute('aria-label', enabled ? '取消收藏 ' + item.word : '收藏 ' + item.word);
  }
  star.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const item = currentItem();
    if (!item || !item.word) return;
    api.toggle(item.word);
    refresh();
  });
  if (typeof render === 'function') {
    const originalRender = render;
    render = function () {
      const result = originalRender.apply(this, arguments);
      refresh();
      return result;
    };
  }
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) refresh();
  });
  window.addEventListener('pageshow', refresh);
  refresh();
})();