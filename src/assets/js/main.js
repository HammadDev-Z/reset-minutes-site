/* Reset Minutes: small progressive-enhancement script. The site works without it. */
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  // Mobile navigation
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Close' : 'Menu';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = 'Menu';
        toggle.focus();
      }
    });
  }

  // Back to top
  var top = document.querySelector('.to-top');
  if (top) {
    var onScroll = function () { top.classList.toggle('is-visible', window.scrollY > 900); };
    window.addEventListener('scroll', onScroll, { passive: true });
    top.addEventListener('click', function () {
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
      var h = document.getElementById('main'); if (h) { h.focus({ preventScroll: true }); }
    });
    onScroll();
  }

  // TOC: close the details element on small screens after choosing a link
  var toc = document.querySelector('details.toc');
  if (toc && window.matchMedia('(min-width: 1024px)').matches) { toc.setAttribute('open', ''); }

  // Guides archive filter
  var filterBar = document.querySelector('[data-filter-bar]');
  if (filterBar) {
    var items = document.querySelectorAll('[data-category]');
    var status = document.getElementById('filter-status');
    filterBar.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      var value = btn.getAttribute('data-filter');
      filterBar.querySelectorAll('button[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
      var shown = 0;
      items.forEach(function (it) {
        var match = value === 'all' || it.getAttribute('data-category') === value;
        it.hidden = !match; if (match) shown++;
      });
      if (status) status.textContent = shown === 0 ? 'No guides in this topic yet.' : shown + (shown === 1 ? ' guide shown.' : ' guides shown.');
    });
  }

  // Search page
  var form = document.getElementById('search-form');
  if (form) {
    var input = document.getElementById('q');
    var list = document.getElementById('results');
    var live = document.getElementById('results-status');
    var indexUrl = form.getAttribute('data-index');
    var root = form.getAttribute('data-root') || '';
    var docs = null;
    var norm = function (s) { return String(s || '').toLowerCase(); };
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var render = function (q) {
      if (!docs) return;
      var terms = norm(q).split(/\s+/).filter(Boolean);
      list.innerHTML = '';
      if (!terms.length) { live.textContent = 'Type a word such as "bathroom" or "minimum day".'; return; }
      var scored = docs.map(function (d) {
        var hay = norm(d.title + ' ' + d.description + ' ' + d.category + ' ' + (d.tags || []).join(' ') + ' ' + d.text);
        var score = 0;
        for (var i = 0; i < terms.length; i++) {
          if (hay.indexOf(terms[i]) === -1) return null;
          score += norm(d.title).indexOf(terms[i]) !== -1 ? 5 : 1;
        }
        return { d: d, score: score };
      }).filter(Boolean).sort(function (a, b) { return b.score - a.score; });
      live.textContent = scored.length === 0 ? 'No results for "' + q + '". Try a shorter word, or browse all guides.' : scored.length + (scored.length === 1 ? ' result.' : ' results.');
      scored.forEach(function (r) {
        var li = document.createElement('li');
        li.innerHTML = '<h2><a href="' + esc(root + r.d.url) + '">' + esc(r.d.title) + '</a></h2><p class="meta">' + esc(r.d.category) + '</p><p>' + esc(r.d.description) + '</p>';
        list.appendChild(li);
      });
    };
    fetch(indexUrl).then(function (r) { return r.json(); }).then(function (j) {
      docs = j;
      var q0 = new URLSearchParams(location.search).get('q') || '';
      input.value = q0; render(q0);
    }).catch(function () { live.textContent = 'Search could not load. You can browse all guides instead.'; });
    form.addEventListener('submit', function (e) { e.preventDefault(); history.replaceState(null, '', '?q=' + encodeURIComponent(input.value)); render(input.value); });
    input.addEventListener('input', function () { render(input.value); });
  }
})();
