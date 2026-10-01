// Card motion engine for the HRMS redesign.
// [data-fx="tilt"]  clickable tiles: lift, cursor spotlight, 3D tilt, light running round the border
// [data-fx="spot"]  data cards: spotlight + hairline highlight only
// [data-rise] entrance, [data-count] count-up, [data-draw] stroke draw, [data-arc="a b"] ring draw,
// [data-grow="x|y"] bar grow, [data-float] idle float, [data-pop] popover in.
// Level comes from <html data-ufx="full|subtle|off">.
(() => {
  if (window.UTFX) return;
  const R = document.documentElement;
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const lvl = () => R.getAttribute('data-ufx') || 'full';
  const still = () => reduced() || lvl() === 'off';
  const sv = (el, k, v) => el.style.setProperty(k, v);
  let cur = null, raf = 0, last = 0, ang = 0;

  function spin(t) {
    if (!cur) { raf = 0; return; }
    const dt = last ? Math.min(40, t - last) : 16; last = t; ang = (ang + dt * 0.16) % 360;
    sv(cur, '--ang', ang.toFixed(1) + 'deg');
    raf = requestAnimationFrame(spin);
  }
  function enter(el) {
    cur = el;
    if (lvl() === 'off') return;
    sv(el, '--fx', '1');
    if (lvl() === 'full' && el.getAttribute('data-fx') === 'tilt' && !reduced()) { sv(el, '--fxr', '1'); last = 0; if (!raf) raf = requestAnimationFrame(spin); }
    if (!reduced()) el.querySelectorAll('[data-draw]').forEach(p => draw(p, 60));
  }
  function leave(el) {
    sv(el, '--fx', '0'); sv(el, '--fxr', '0'); sv(el, '--rx', '0deg'); sv(el, '--ry', '0deg');
    if (cur === el) cur = null;
  }
  document.addEventListener('pointerover', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-fx]') : null;
    if (el === cur) return;
    if (cur) leave(cur);
    if (el) enter(el);
  }, { passive: true });
  document.addEventListener('pointerout', e => { if (!e.relatedTarget && cur) leave(cur); }, { passive: true });
  document.addEventListener('pointermove', e => {
    if (!cur || lvl() === 'off') return;
    const r = cur.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    sv(cur, '--mx', Math.round(x) + 'px'); sv(cur, '--my', Math.round(y) + 'px');
    if (lvl() === 'full' && cur.getAttribute('data-fx') === 'tilt' && !reduced()) {
      const m = Math.min(4.5, 640 / Math.max(r.width, 120));
      sv(cur, '--rx', (((y / r.height) - 0.5) * -m).toFixed(2) + 'deg');
      sv(cur, '--ry', (((x / r.width) - 0.5) * m).toFixed(2) + 'deg');
    }
  }, { passive: true });

  function draw(p, delay) {
    if (still()) return;
    p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 1100, delay: delay || 0, easing: EASE, fill: 'backwards' });
  }
  function arc(p, i) {
    const to = p.getAttribute('data-arc'); if (!to || still()) return;
    p.animate([{ strokeDasharray: '0 100' }, { strokeDasharray: to }], { duration: 1000, delay: 150 + i * 90, easing: EASE, fill: 'backwards' });
  }
  function grow(el, i) {
    if (still()) return;
    const ax = el.getAttribute('data-grow') === 'x' ? 'scaleX' : 'scaleY';
    el.animate([{ transform: ax + '(0)' }, { transform: ax + '(1)' }], { duration: 750, delay: 120 + Math.min(i, 16) * 35, easing: EASE, fill: 'backwards' });
  }
  function rise(el, i) {
    if (still()) return;
    el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: Math.min(i, 14) * 40, easing: EASE, fill: 'backwards' });
  }
  function pop(el) {
    if (still()) return;
    const k = el.getAttribute('data-pop');
    const from = k === 'left' ? 'translateX(-18px)' : k === 'up' ? 'translateY(12px) scale(.98)' : 'translateY(-6px) scale(.98)';
    el.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE, fill: 'backwards' });
  }
  function float(el) {
    if (reduced()) return;
    el.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-7px)' }], { duration: 2800, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
  }
  function count(el) {
    const tn = el.firstChild;
    if (!tn || tn.nodeType !== 3 || el.childNodes.length !== 1) return false;
    const src = tn.nodeValue || '', m = src.match(/(\d[\d,]*)(\.\d+)?/);
    if (!m) return false;
    if (still()) return true;
    const ip = m[1], dec = m[2] ? m[2].length - 1 : 0, target = parseFloat((ip + (m[2] || '')).replace(/,/g, ''));
    if (!isFinite(target) || target === 0) return true;
    const grouped = ip.indexOf(',') >= 0, indian = /\d,\d\d,\d{3}/.test(ip);
    const fmt = v => { const s = v.toFixed(dec); if (!grouped) return s; const parts = s.split('.'); const n = Number(parts[0]).toLocaleString(indian ? 'en-IN' : 'en-US'); return parts[1] ? n + '.' + parts[1] : n; };
    const pre = src.slice(0, m.index), post = src.slice(m.index + m[0].length), t0 = performance.now(), D = 950;
    let wrote = src;
    const step = t => {
      if (tn.nodeValue !== wrote) return;
      const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3);
      wrote = k < 1 ? pre + fmt(target * e) + post : src; tn.nodeValue = wrote;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return true;
  }

  function ticker(el) {
    const n = el.children.length; if (n < 2 || reduced()) return;
    let i = 0;
    const id = setInterval(() => {
      if (!el.isConnected) { clearInterval(id); return; }
      const h = el.children[0].getBoundingClientRect().height || 20;
      i++; el.style.transition = 'transform .55s cubic-bezier(.2,.8,.2,1)'; el.style.transform = 'translateY(' + (-i * h) + 'px)';
      if (i >= n - 1) setTimeout(() => { el.style.transition = 'none'; el.style.transform = 'translateY(0)'; i = 0; }, 620);
    }, 2600);
  }
  const seen = new WeakSet();
  function scan(nodes) {
    const all = sel => { const out = []; nodes.forEach(n => { if (n.matches && n.matches(sel)) out.push(n); if (n.querySelectorAll) n.querySelectorAll(sel).forEach(x => out.push(x)); }); return out.filter(x => { if (seen.has(x)) return false; return true; }); };
    all('[data-rise]').forEach((el, i) => { seen.add(el); rise(el, i); });
    all('[data-pop]').forEach(el => { seen.add(el); pop(el); });
    all('[data-float]').forEach(el => { seen.add(el); float(el); });
    all('[data-grow]').forEach((el, i) => { seen.add(el); grow(el, i); });
    all('[data-draw]').forEach((el, i) => { seen.add(el); draw(el, 150 + i * 60); });
    all('[data-arc]').forEach((el, i) => { seen.add(el); arc(el, i); });
    all('[data-count]').forEach(el => { if (count(el)) seen.add(el); });
    all('[data-ticker]').forEach(el => { seen.add(el); ticker(el); });
  }
  const mo = new MutationObserver(ms => {
    const nodes = [];
    ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType === 1) nodes.push(n);
      else if (n.nodeType === 3 && n.parentElement && n.parentElement.hasAttribute('data-count') && !seen.has(n.parentElement)) nodes.push(n.parentElement);
    }));
    if (nodes.length) scan(nodes);
  });
  const boot = () => { mo.observe(document.body, { childList: true, subtree: true }); scan([document.body]); };
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
  window.UTFX = { setLevel: l => R.setAttribute('data-ufx', l) };
})();
