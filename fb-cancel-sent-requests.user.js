// ==UserScript==
// @name         FB Sent Requests Canceller - Yashvir Gaming
// @namespace    yashvir.gaming
// @version      1.1.1
// @description  Cancels all sent Facebook friend requests with randomized delays, batch pauses and block detection
// @match        https://*.facebook.com/*
// @match        https://facebook.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self || document.getElementById('fbsc-panel')) return;

  const DEFAULTS = {
    minDelay: 5,
    maxDelay: 11,
    batchSize: 20,
    batchPauseMin: 60,
    batchPauseMax: 150,
    maxTotal: 0,
    maxFails: 5
  };

  const CANCEL_LABELS = ['cancel request', 'annuler la demande', 'annuler l’invitation', 'cancelar solicitud', 'anular pedido'];
  const OPEN_LABELS = ['view sent requests', 'voir les demandes envoyées', 'ver solicitudes enviadas'];
  const DIALOG_TITLES = ['sent requests', 'demandes envoyées', 'solicitudes enviadas'];
  const BLOCK_PHRASES = [
    'temporarily blocked', 'we limit how often', 'try again later', 'action blocked',
    'temporairement bloqué', 'réessayez plus tard', 'temporalmente bloqueado'
  ];

  const store = {
    get(key, fallback) {
      try {
        if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
        const raw = localStorage.getItem('fbsc_' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (typeof GM_setValue === 'function') GM_setValue(key, value);
        else localStorage.setItem('fbsc_' + key, JSON.stringify(value));
      } catch (e) {}
    }
  };

  const cfg = Object.assign({}, DEFAULTS, store.get('cfg', {}));
  const state = { running: false, stop: false, cancelled: 0, failed: 0, startedAt: 0 };

  const rand = (a, b) => a + Math.random() * (b - a);
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const css = `
    #fbsc-panel{position:fixed;top:70px;left:16px;width:300px;z-index:2147483647;background:#18191a;color:#e4e6eb;font:13px/1.4 Segoe UI,system-ui,sans-serif;border:1px solid #3a3b3c;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.55);user-select:none}
    #fbsc-panel *{box-sizing:border-box}
    #fbsc-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:move;background:#242526;border-radius:12px 12px 0 0;font-weight:600}
    #fbsc-head button{background:none;border:0;color:#b0b3b8;font-size:16px;cursor:pointer;padding:0 4px}
    #fbsc-body{padding:12px}
    #fbsc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}
    .fbsc-stat{background:#242526;border-radius:8px;padding:6px;text-align:center}
    .fbsc-stat b{display:block;font-size:17px;color:#fff}
    .fbsc-stat span{font-size:10px;color:#b0b3b8;text-transform:uppercase;letter-spacing:.04em}
    #fbsc-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;margin-bottom:10px}
    #fbsc-grid label{display:flex;flex-direction:column;font-size:10px;color:#b0b3b8;text-transform:uppercase;letter-spacing:.04em}
    #fbsc-grid input{margin-top:2px;background:#3a3b3c;border:1px solid #4e4f50;color:#fff;border-radius:6px;padding:4px 6px;font-size:13px;width:100%}
    #fbsc-btns{display:flex;gap:8px;margin-bottom:8px}
    #fbsc-btns button{flex:1;border:0;border-radius:8px;padding:8px;font-weight:600;font-size:13px;cursor:pointer;color:#fff}
    #fbsc-open{background:#3a3b3c}
    #fbsc-start{background:#1877f2}
    #fbsc-start:disabled{background:#2d4a7a;cursor:not-allowed}
    #fbsc-stop{background:#e41e3f}
    #fbsc-stop:disabled{background:#6b2a38;cursor:not-allowed}
    #fbsc-status{font-size:12px;color:#8ab4f8;margin-bottom:6px;min-height:17px}
    #fbsc-log{height:110px;overflow:auto;background:#0f1011;border-radius:8px;padding:6px 8px;font:11px/1.45 Consolas,monospace;color:#a8abb0;user-select:text}
    #fbsc-panel.fbsc-min #fbsc-body{display:none}
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  const panel = document.createElement('div');
  panel.id = 'fbsc-panel';
  const h = (tag, attrs, kids) => {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(c => n.appendChild(c));
    return n;
  };
  const stat = (id, label, init) => h('div', { class: 'fbsc-stat' }, [h('b', { id: 'fbsc-' + id, text: init }), h('span', { text: label })]);
  const field = (id, label, extra) => h('label', { text: label }, [h('input', Object.assign({ id: 'fbsc-' + id, type: 'number' }, extra || {}))]);

  panel.appendChild(h('div', { id: 'fbsc-head' }, [
    h('span', { text: 'Sent Requests Canceller' }),
    h('button', { id: 'fbsc-min', title: 'Minimize', text: '–' })
  ]));
  panel.appendChild(h('div', { id: 'fbsc-body' }, [
    h('div', { id: 'fbsc-stats' }, [stat('n-ok', 'Cancelled', '0'), stat('n-fail', 'Failed', '0'), stat('n-time', 'Elapsed', '0:00')]),
    h('div', { id: 'fbsc-grid' }, [
      field('minDelay', 'Min delay (s)', { min: '1', step: '0.5' }),
      field('maxDelay', 'Max delay (s)', { min: '1', step: '0.5' }),
      field('batchSize', 'Batch size', { min: '1' }),
      field('maxTotal', 'Stop after (0 = all)', { min: '0' }),
      field('batchPauseMin', 'Batch pause min (s)', { min: '5' }),
      field('batchPauseMax', 'Batch pause max (s)', { min: '5' })
    ]),
    h('div', { id: 'fbsc-btns' }, [
      h('button', { id: 'fbsc-open', text: 'Open list' }),
      h('button', { id: 'fbsc-start', text: 'Start' }),
      h('button', { id: 'fbsc-stop', text: 'Stop', disabled: '' })
    ]),
    h('div', { id: 'fbsc-status', text: 'Press Open list, then Start.' }),
    h('div', { id: 'fbsc-log' })
  ]));
  document.body.appendChild(panel);

  const $ = id => panel.querySelector('#fbsc-' + id);
  const logEl = $('log');

  const log = msg => {
    const t = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.textContent = `[${t}] ${msg}`;
    logEl.appendChild(line);
    while (logEl.childNodes.length > 200) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  };

  const setStatus = msg => { $('status').textContent = msg; };

  const fmtTime = ms => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const refreshStats = () => {
    $('n-ok').textContent = state.cancelled;
    $('n-fail').textContent = state.failed;
    $('n-time').textContent = state.startedAt ? fmtTime(Date.now() - state.startedAt) : '0:00';
  };

  const numericKeys = ['minDelay', 'maxDelay', 'batchSize', 'maxTotal', 'batchPauseMin', 'batchPauseMax'];

  numericKeys.forEach(k => { $(k).value = cfg[k]; });

  const readCfg = () => {
    numericKeys.forEach(k => {
      const v = parseFloat($(k).value);
      if (!isNaN(v) && v >= 0) cfg[k] = v;
    });
    if (cfg.maxDelay < cfg.minDelay) cfg.maxDelay = cfg.minDelay;
    if (cfg.batchPauseMax < cfg.batchPauseMin) cfg.batchPauseMax = cfg.batchPauseMin;
    if (cfg.batchSize < 1) cfg.batchSize = 1;
    numericKeys.forEach(k => { $(k).value = cfg[k]; });
    store.set('cfg', cfg);
  };

  $('min').addEventListener('click', () => {
    panel.classList.toggle('fbsc-min');
    $('min').textContent = panel.classList.contains('fbsc-min') ? '+' : '–';
  });

  (() => {
    const head = $('head');
    let drag = null;
    head.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      const r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      panel.style.left = Math.max(0, e.clientX - drag.dx) + 'px';
      panel.style.top = Math.max(0, e.clientY - drag.dy) + 'px';
    });
    document.addEventListener('mouseup', () => { drag = null; });
  })();

  const sleep = async (ms, label) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (state.stop) return false;
      if (label) setStatus(`${label} ${Math.ceil((end - Date.now()) / 1000)}s`);
      refreshStats();
      await new Promise(r => setTimeout(r, Math.min(250, Math.max(0, end - Date.now()))));
    }
    return !state.stop;
  };

  const isVisible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  const getDialog = () => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    return dialogs.find(d => {
      const t = norm(d.textContent);
      return DIALOG_TITLES.some(x => t.includes(x));
    }) || null;
  };

  const labelOf = el => norm(el.getAttribute('aria-label') || el.textContent);

  const nextButton = dialog => {
    const candidates = [...dialog.querySelectorAll('[role="button"], button, [aria-label]')];
    const matches = candidates.filter(el =>
      CANCEL_LABELS.includes(labelOf(el)) &&
      !el.hasAttribute('data-fbsc') &&
      isVisible(el) &&
      el.getAttribute('aria-disabled') !== 'true'
    );
    return matches.find(el => !matches.some(o => o !== el && o.contains(el))) || null;
  };

  const findScroller = dialog => {
    let best = null;
    dialog.querySelectorAll('*').forEach(el => {
      if (el.scrollHeight > el.clientHeight + 20) {
        const oy = getComputedStyle(el).overflowY;
        if (/(auto|scroll)/.test(oy) && (!best || el.scrollHeight > best.scrollHeight)) best = el;
      }
    });
    return best;
  };

  const isBlocked = () => {
    const sent = getDialog();
    const nodes = [...document.querySelectorAll('[role="dialog"], [role="alert"], [role="alertdialog"]')]
      .filter(n => n !== sent && !(sent && sent.contains(n)) && !n.contains(panel) && n !== panel);
    return nodes.some(n => {
      const t = norm(n.textContent);
      return BLOCK_PHRASES.some(p => t.includes(p));
    });
  };

  const realClick = el => {
    const opts = { bubbles: true, cancelable: true };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(type => {
      try {
        const Ctor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ctor(type, opts));
      } catch (e) {}
    });
    el.click();
  };

  const waitForChange = async (btn, original) => {
    const end = Date.now() + 7000;
    while (Date.now() < end) {
      if (state.stop) return true;
      if (!btn.isConnected || labelOf(btn) !== original || !isVisible(btn)) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  };

  const openSent = async () => {
    if (getDialog()) return true;
    const link = [...document.querySelectorAll('a, [role="button"], [role="link"]')]
      .find(e => OPEN_LABELS.includes(norm(e.textContent)) && isVisible(e));
    if (!link) return false;
    link.click();
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      if (getDialog()) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  };

  const finish = reason => {
    state.running = false;
    state.stop = false;
    $('start').disabled = false;
    $('stop').disabled = true;
    setStatus(reason);
    log(reason);
    refreshStats();
  };

  const runInner = async () => {
    readCfg();
    state.running = true;
    state.stop = false;
    state.cancelled = 0;
    state.failed = 0;
    state.startedAt = Date.now();
    $('start').disabled = true;
    $('stop').disabled = false;
    log(`Started. Delay ${cfg.minDelay}-${cfg.maxDelay}s, batch ${cfg.batchSize}, pause ${cfg.batchPauseMin}-${cfg.batchPauseMax}s`);

    let sinceBatch = 0;
    let idleScrolls = 0;
    let consecutiveFails = 0;

    while (!state.stop) {
      if (isBlocked()) return finish('Facebook warning detected. Stopped to protect your account. Wait a few hours before retrying.');

      let dialog = getDialog();
      if (!dialog) {
        setStatus('Opening sent requests...');
        if (!(await openSent())) return finish('Could not open Sent requests. Click "View sent requests" and press Start again.');
        if (!(await sleep(2500))) break;
        dialog = getDialog();
        if (!dialog) continue;
      }

      if (cfg.maxTotal > 0 && state.cancelled >= cfg.maxTotal) return finish(`Reached limit of ${cfg.maxTotal}. Done.`);

      const btn = nextButton(dialog);

      if (!btn) {
        const sc = findScroller(dialog);
        if (!sc || idleScrolls >= 6) return finish(`No more requests found. Cancelled ${state.cancelled}.`);
        const before = sc.scrollHeight;
        sc.scrollTop = sc.scrollHeight;
        setStatus('Loading more requests...');
        if (!(await sleep(rand(1800, 3200)))) break;
        idleScrolls = sc.scrollHeight > before ? 0 : idleScrolls + 1;
        continue;
      }

      idleScrolls = 0;
      btn.scrollIntoView({ block: 'center' });
      if (!(await sleep(rand(250, 700)))) break;

      const original = labelOf(btn);
      btn.setAttribute('data-fbsc', '1');
      realClick(btn);

      const changed = await waitForChange(btn, original);
      if (state.stop) break;

      if (changed) {
        state.cancelled++;
        sinceBatch++;
        consecutiveFails = 0;
        log(`Cancelled #${state.cancelled}`);
      } else {
        state.failed++;
        consecutiveFails++;
        log(`No response from click (${consecutiveFails}/${cfg.maxFails})`);
        if (consecutiveFails >= cfg.maxFails) return finish('Too many consecutive failures. Facebook may be limiting you. Stopped.');
      }
      refreshStats();

      if (sinceBatch >= cfg.batchSize) {
        sinceBatch = 0;
        const pause = rand(cfg.batchPauseMin, cfg.batchPauseMax) * 1000;
        log(`Batch done. Pausing ${Math.round(pause / 1000)}s`);
        if (!(await sleep(pause, 'Batch pause'))) break;
      } else {
        let delay = rand(cfg.minDelay, cfg.maxDelay) * 1000;
        if (Math.random() < 0.12) delay += rand(3000, 9000);
        if (!(await sleep(delay, 'Next in'))) break;
      }
    }

    finish(`Stopped. Cancelled ${state.cancelled}.`);
  };

  const run = () => runInner().catch(e => finish('Error: ' + (e && e.message ? e.message : e)));

  $('start').addEventListener('click', () => { if (!state.running) run(); });
  $('open').addEventListener('click', async () => {
    setStatus('Opening sent requests...');
    const ok = await openSent();
    setStatus(ok ? 'Sent requests open. Press Start.' : 'Link not found. Go to facebook.com/friends/requests first.');
  });
  $('stop').addEventListener('click', () => {
    if (state.running) {
      state.stop = true;
      setStatus('Stopping...');
    }
  });

  setInterval(() => { if (state.running) refreshStats(); }, 1000);
  log('Loaded v1.1.1');
})();