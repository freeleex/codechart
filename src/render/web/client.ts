export const CLIENT_JS = `
(function () {
  var data = JSON.parse(document.getElementById('spec-data').textContent);
  var svg = document.querySelector('#canvas svg');
  var vp = document.getElementById('viewport');
  var canvas = document.getElementById('canvas');
  var panel = document.getElementById('panel');
  var info = document.getElementById('page-info');
  var infoBtn = document.getElementById('info-toggle');
  var t = { x: 0, y: 0, k: 1 };
  function apply() { vp.setAttribute('transform', 'translate(' + t.x + ',' + t.y + ') scale(' + t.k + ')'); }
  function fit() {
    var r = svg.getBoundingClientRect();
    var k = Math.min(r.width / data.width, r.height / data.height, 1) || 1;
    t = { k: k, x: (r.width - data.width * k) / 2, y: (r.height - data.height * k) / 2 };
    apply();
  }
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = svg.getBoundingClientRect();
    var px = e.clientX - r.left, py = e.clientY - r.top;
    var k = Math.min(4, Math.max(0.1, t.k * Math.exp(-e.deltaY * 0.0015)));
    t.x = px - ((px - t.x) / t.k) * k;
    t.y = py - ((py - t.y) / t.k) * k;
    t.k = k;
    apply();
  }, { passive: false });
  var drag = null, moved = false;
  canvas.addEventListener('pointerdown', function (e) {
    drag = { x: e.clientX - t.x, y: e.clientY - t.y, sx: e.clientX, sy: e.clientY };
    moved = false;
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) { moved = true; canvas.classList.add('drag'); }
    if (!moved) return;
    t.x = e.clientX - drag.x; t.y = e.clientY - drag.y; apply();
  });
  function endDrag() { drag = null; canvas.classList.remove('drag'); }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  function select(id) {
    document.querySelectorAll('.node.selected').forEach(function (g) { g.classList.remove('selected'); });
    if (id == null) return;
    var g = document.querySelector('.node[data-id="' + CSS.escape(id) + '"]');
    if (g) g.classList.add('selected');
  }
  function setInfo(on) {
    info.hidden = !on;
    panel.hidden = on;
    if (infoBtn) infoBtn.setAttribute('aria-expanded', String(on));
  }
  function show(id) {
    var tpl = document.querySelector('template.card-panel[data-for="' + CSS.escape(id) + '"]');
    if (!tpl) return;
    select(id);
    panel.textContent = '';
    panel.appendChild(tpl.content.cloneNode(true));
    setInfo(false);
  }
  if (infoBtn) infoBtn.addEventListener('click', function () { select(null); setInfo(true); });
  setInfo(true);
  document.querySelectorAll('.node').forEach(function (g) {
    g.addEventListener('click', function () { if (!moved) show(g.getAttribute('data-id')); });
    g.addEventListener('keydown', function (e) {
      if (e.target !== g) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(g.getAttribute('data-id')); }
    });
  });
  var themes = ['auto', 'light', 'dark'];
  var root = document.documentElement;
  var btn = document.getElementById('theme-toggle');
  function setTheme(v, save) {
    root.setAttribute('data-theme', v);
    btn.textContent = 'Theme: ' + v;
    if (save) { try { localStorage.setItem('codechart.theme', v); } catch (e) {} }
  }
  var saved = null;
  try { saved = localStorage.getItem('codechart.theme'); } catch (e) {}
  setTheme(themes.indexOf(saved) >= 0 ? saved : root.getAttribute('data-theme'), false);
  btn.addEventListener('click', function () {
    var i = themes.indexOf(root.getAttribute('data-theme'));
    setTheme(themes[(i + 1) % themes.length], true);
  });
  window.addEventListener('resize', fit);
  fit();
})();
`;
