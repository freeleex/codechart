export const CLIENT_JS = `
(function () {
  var data = JSON.parse(document.getElementById('spec-data').textContent);
  var canvases = [].slice.call(document.querySelectorAll('.canvas'));
  var vps = [].slice.call(document.querySelectorAll('.viewport'));
  var panel = document.getElementById('panel');
  var info = document.getElementById('page-info');
  var infoBtn = document.getElementById('info-toggle');
  // One transform per pane; while linked, a move in one is copied to all so Now and After stay aligned.
  var ts = canvases.map(function () { return { x: 0, y: 0, k: 1 }; });
  var linked = true, last = 0;
  function apply() {
    vps.forEach(function (vp, i) { var t = ts[i]; vp.setAttribute('transform', 'translate(' + t.x + ',' + t.y + ') scale(' + t.k + ')'); });
  }
  function move(i, t) {
    last = i;
    ts = ts.map(function (old, j) { return linked || j === i ? { x: t.x, y: t.y, k: t.k } : old; });
    apply();
  }
  function fit() {
    var r = canvases[0].querySelector('svg').getBoundingClientRect();
    var k = Math.min(r.width / data.width, r.height / data.height, 1) || 1;
    var t = { k: k, x: (r.width - data.width * k) / 2, y: (r.height - data.height * k) / 2 };
    ts = ts.map(function () { return { x: t.x, y: t.y, k: t.k }; });
    apply();
  }
  var drag = null, moved = false;
  canvases.forEach(function (canvas, i) {
    var svg = canvas.querySelector('svg');
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var t = ts[i];
      var r = svg.getBoundingClientRect();
      var px = e.clientX - r.left, py = e.clientY - r.top;
      var k = Math.min(4, Math.max(0.1, t.k * Math.exp(-e.deltaY * 0.0015)));
      move(i, { x: px - ((px - t.x) / t.k) * k, y: py - ((py - t.y) / t.k) * k, k: k });
    }, { passive: false });
    canvas.addEventListener('pointerdown', function (e) {
      drag = { i: i, x: e.clientX - ts[i].x, y: e.clientY - ts[i].y, sx: e.clientX, sy: e.clientY, canvas: canvas };
      moved = false;
    });
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) { moved = true; drag.canvas.classList.add('drag'); }
    if (!moved) return;
    move(drag.i, { x: e.clientX - drag.x, y: e.clientY - drag.y, k: ts[drag.i].k });
  });
  var linkBtn = document.getElementById('link-toggle');
  function setLinked(on, save) {
    linked = on;
    linkBtn.textContent = 'Panes: ' + (on ? 'linked' : 'separate');
    linkBtn.setAttribute('aria-pressed', String(on));
    if (on) move(last, ts[last]);
    if (save) { try { localStorage.setItem('codechart.panes.linked', on ? '1' : '0'); } catch (e) {} }
  }
  if (linkBtn) {
    var savedLink = null;
    try { savedLink = localStorage.getItem('codechart.panes.linked'); } catch (e) {}
    setLinked(savedLink !== '0', false);
    linkBtn.addEventListener('click', function () { setLinked(!linked, true); });
  }
  function endDrag() {
    if (drag) drag.canvas.classList.remove('drag');
    drag = null;
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  function select(id) {
    document.querySelectorAll('.node.selected').forEach(function (g) { g.classList.remove('selected'); });
    if (id == null) return;
    document.querySelectorAll('.node[data-id="' + CSS.escape(id) + '"]').forEach(function (g) { g.classList.add('selected'); });
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
  var aside = document.querySelector('aside');
  var handle = document.getElementById('resize');
  var width = 0;
  // Two panes need the room, so their panel starts at half width and remembers its own size.
  var panes = !!document.getElementById('panes');
  var widthKey = panes ? 'codechart.panel.panes' : 'codechart.panel';
  var minWidth = panes ? 200 : 300;
  function setWidth(w, save) {
    width = Math.round(Math.max(minWidth, Math.min(w, window.innerWidth * 0.8)));
    aside.style.width = width + 'px';
    if (save) { try { localStorage.setItem(widthKey, String(width)); } catch (e) {} }
  }
  function currentWidth() { return width || aside.getBoundingClientRect().width; }
  var savedWidth = null;
  try { savedWidth = Number(localStorage.getItem(widthKey)); } catch (e) {}
  if (savedWidth > 0) setWidth(savedWidth, false);
  var sizing = false;
  handle.addEventListener('pointerdown', function (e) {
    sizing = true;
    handle.classList.add('drag');
    if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', function (e) {
    if (sizing) setWidth(window.innerWidth - e.clientX, false);
  });
  function endSize() {
    if (!sizing) return;
    sizing = false;
    handle.classList.remove('drag');
    setWidth(currentWidth(), true);
  }
  handle.addEventListener('pointerup', endSize);
  handle.addEventListener('pointercancel', endSize);
  handle.addEventListener('keydown', function (e) {
    var step = e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0;
    if (!step) return;
    e.preventDefault();
    setWidth(currentWidth() + step, true);
  });
  window.addEventListener('resize', fit);
  fit();
})();
`;
