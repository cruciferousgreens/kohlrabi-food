// js/app.js — Kohlrabi Food v1 (sample data). Tabs: Log / Scan / Goals.
import { startScanner, normalizeBarcode } from './scanner.js';
import { lookupBarcode, searchFoods, scaleNutrients, HEADLINE, HEADLINE_LABEL, HEADLINE_UNIT, EXTRA_LABEL, EXTRA_UNIT } from './fake-api.js';
import { todayISO, shiftISO, prettyDate, getDay, addEntry, removeEntry, dayTotals, getGoals, setGoals, getCustom, addCustom, getHistory, saveHistory } from './store.js';

const $ = (s, r = document) => r.querySelector(s);
let viewISO = todayISO();
let scannerCtl = null;

// ---------- Tabs ----------
document.querySelectorAll('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'scan') ensureScanner();
    else stopScanner();
    if (btn.dataset.tab === 'goals') renderGoals();
  });
});

// ---------- Log ----------
function renderLog() {
  $('#date-label').textContent = prettyDate(viewISO) + (viewISO === todayISO() ? ' (today)' : '');
  const goals = getGoals();
  const totals = dayTotals(viewISO);
  const order = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
  $('#rollup').innerHTML = order.map(k => {
    const pct = goals[k] > 0 ? Math.min(100, (totals[k] / goals[k]) * 100) : 0;
    const over = goals[k] > 0 && totals[k] > goals[k];
    return `<div class="goalbar${over ? ' over' : ''}">
      <div class="lbl"><span class="${k === 'fiber' ? 'fiber-tag' : ''}">${HEADLINE_LABEL[k]}${k === 'fiber' ? ' ✦' : ''}</span>
      <span>${fmt(totals[k])}${HEADLINE_UNIT[k]} / ${goals[k]}${HEADLINE_UNIT[k]}</span></div>
      <div class="track"><div class="fill${k === 'fiber' ? ' fiber' : ''}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  const entries = getDay(viewISO).slice().sort((a, b) => a.ts - b.ts);
  $('#entries').innerHTML = entries.length ? entries.map(e => `
    <div class="entry">
      <div><div class="name">${esc(e.name)}${e.sample ? '<span class="sample-badge">SAMPLE</span>' : ''}</div>
      <div class="amt">${esc(e.amountLabel || '')}</div></div>
      <div class="row"><div class="macros">${Math.round(e.nutrients.calories)} cal<br>P ${fmt(e.nutrients.protein)} · Fb ${fmt(e.nutrients.fiber)}g</div>
      <button class="del" data-id="${e.id}" aria-label="Delete">×</button></div>
    </div>`).join('')
    : `<div class="empty">Nothing logged yet.<br>Tap <b>Scan</b> below to log your first item.</div>`;

  $('#entries').querySelectorAll('.del').forEach(b =>
    b.addEventListener('click', () => { removeEntry(viewISO, b.dataset.id); renderLog(); }));
}
function fmt(n) { return (Math.round(n * 10) / 10).toString(); }
function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

$('#date-prev').addEventListener('click', () => { viewISO = shiftISO(viewISO, -1); renderLog(); });
$('#date-next').addEventListener('click', () => { viewISO = shiftISO(viewISO, 1); renderLog(); });

// ---------- Scanner ----------
async function ensureScanner() {
  if (scannerCtl) return;
  const video = $('#viewfinder');
  try {
    scannerCtl = await startScanner({
      video,
      onDecode: (code) => handleBarcode(normalizeBarcode(code)),
      onStatus: (msg) => { $('#scan-status').textContent = msg; },
    });
  } catch (err) {
    $('#scan-status').textContent = err.message;
  }
}
function stopScanner() {
  if (scannerCtl) { try { scannerCtl.stop(); } catch {} scannerCtl = null; }
}

let lookupToken = 0;
async function handleBarcode(barcode) {
  if (!barcode) return;
  const my = ++lookupToken;
  $('#scan-status').textContent = 'Looking up ' + barcode + '…';
  // Instant path: our own history.
  const cached = getHistory(barcode);
  if (cached) { if (my === lookupToken) openProductSheet(cached, barcode); return; }
  const res = await lookupBarcode(barcode);
  if (my !== lookupToken) return;
  if (res.status === 'found') {
    saveHistory(barcode, res.product);
    openProductSheet(res.product, barcode);
  } else {
    openNotFoundSheet(barcode);
  }
}

$('#manual-barcode-btn').addEventListener('click', () => {
  const v = normalizeBarcode($('#manual-barcode').value);
  if (v) handleBarcode(v);
});
$('#name-search-btn').addEventListener('click', async () => {
  const q = $('#name-search').value.trim();
  if (q.length < 2) return;
  $('#search-results').innerHTML = '<div class="muted">Searching sample catalog…</div>';
  const hits = await searchFoods(q);
  const customs = getCustom().filter(c => (c.name + ' ' + (c.brand || '')).toLowerCase().includes(q.toLowerCase()));
  const all = [...customs, ...hits];
  $('#search-results').innerHTML = all.length ? all.map((p, i) => `
    <div class="entry"><div><div class="name">${esc(p.name)}${p.sample ? '<span class="sample-badge">SAMPLE</span>' : ''}${p.custom ? '<span class="sample-badge">CUSTOM</span>' : ''}</div>
    <div class="amt">${esc(p.brand || '')} · ${esc(p.serving.label)} (${p.serving.grams}g)</div></div>
    <button class="btn small" data-i="${i}">Add</button></div>`).join('')
    : '<div class="empty">No matches in the sample catalog.<br>Try the manual entry below.</div>';
  $('#search-results').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => openProductSheet(all[+b.dataset.i], null)));
});

// ---------- Product sheet ----------
let sheetProduct = null, sheetServings = 1;
function openSheet(html) {
  closeSheet();
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.innerHTML = `<div class="sheet">${html}</div>`;
  bd.addEventListener('click', (e) => { if (e.target === bd) closeSheet(); });
  document.body.appendChild(bd);
}
function closeSheet() { document.querySelector('.sheet-backdrop')?.remove(); }

function openProductSheet(product, barcode) {
  sheetProduct = product; sheetServings = 1;
  renderProductSheet(barcode);
}
function renderProductSheet(barcode) {
  const p = sheetProduct;
  const n = scaleNutrients(p, sheetServings);
  const grams = Math.round(p.serving.grams * sheetServings);
  const extras = Object.keys(EXTRA_LABEL)
    .filter(k => p.nutrients[k] !== undefined)
    .map(k => `<div class="nut-row"><span>${EXTRA_LABEL[k]}</span><span>${fmt(n[k])} ${EXTRA_UNIT[k]}</span></div>`).join('');
  openSheet(`
    <h2>${esc(p.name)}${p.sample ? '<span class="sample-badge">SAMPLE</span>' : ''}</h2>
    <div class="brand">${esc(p.brand || '')} · ${esc(p.serving.label)} (${p.serving.grams}g)${barcode ? ' · ' + esc(barcode) : ''}</div>
    <div class="macro-grid">
      ${HEADLINE.map(k => `<div class="m${k === 'fiber' ? ' fiber' : ''}"><div class="v">${fmt(n[k])}${HEADLINE_UNIT[k]}</div><div class="k">${HEADLINE_LABEL[k]}${k === 'fiber' ? ' ✦' : ''}</div></div>`).join('')}
    </div>
    <div class="stepper">
      <button id="st-minus">−</button>
      <div class="val">${fmt(sheetServings)} × serving<br><span class="muted" style="font-size:12px">${grams}g</span></div>
      <button id="st-plus">+</button>
    </div>
    <button class="btn" id="log-btn">Log it</button>
    <div style="height:8px"></div>
    <button class="btn secondary" id="sheet-cancel">Cancel</button>
    <details class="nutrients"><summary>All nutrients (per logged amount)</summary>${extras}</details>
  `);
  $('#st-minus').addEventListener('click', () => { sheetServings = Math.max(0.25, sheetServings - 0.25); renderProductSheet(barcode); });
  $('#st-plus').addEventListener('click', () => { sheetServings = sheetServings + 0.25; renderProductSheet(barcode); });
  $('#sheet-cancel').addEventListener('click', closeSheet);
  $('#log-btn').addEventListener('click', () => {
    addEntry(viewISO, {
      name: p.name, brand: p.brand, sample: !!p.sample,
      amountLabel: `${fmt(sheetServings)} × ${p.serving.label} (${grams}g)`,
      servings: sheetServings, nutrients: n, source: barcode ? 'scan' : 'search',
    });
    closeSheet();
    switchTab('log'); renderLog();
  });
}

function openNotFoundSheet(barcode) {
  openSheet(`
    <h2>Not in the sample catalog</h2>
    <div class="brand">Barcode ${esc(barcode)} · the real app would check Open Food Facts + USDA here.</div>
    <label class="field">Food name</label><input type="text" id="m-name" placeholder="e.g. Store-brand granola">
    <label class="field">Serving description</label><input type="text" id="m-serving" placeholder="e.g. 2/3 cup (55g)" value="1 serving">
    <div class="row">
      <div style="flex:1"><label class="field">Calories</label><input type="number" id="m-cal" inputmode="decimal"></div>
      <div style="flex:1"><label class="field">Protein (g)</label><input type="number" id="m-pro" inputmode="decimal"></div>
    </div>
    <div class="row">
      <div style="flex:1"><label class="field">Carbs (g)</label><input type="number" id="m-carb" inputmode="decimal"></div>
      <div style="flex:1"><label class="field">Fat (g)</label><input type="number" id="m-fat" inputmode="decimal"></div>
    </div>
    <label class="field">Fiber (g) ✦</label><input type="number" id="m-fiber" inputmode="decimal">
    <div style="height:12px"></div>
    <button class="btn" id="m-save">Save & log</button>
    <div style="height:8px"></div>
    <button class="btn secondary" id="m-cancel">Cancel</button>
  `);
  $('#m-cancel').addEventListener('click', closeSheet);
  $('#m-save').addEventListener('click', () => {
    const num = (id) => parseFloat($('#' + id).value) || 0;
    const food = {
      name: $('#m-name').value.trim() || 'Unnamed food',
      brand: '', serving: { label: $('#m-serving').value.trim() || '1 serving', grams: 0 },
      nutrients: { calories: num('m-cal'), protein: num('m-pro'), carbs: num('m-carb'), fat: num('m-fat'), fiber: num('m-fiber') },
    };
    const saved = addCustom(food);
    addEntry(viewISO, { name: saved.name, brand: '', amountLabel: food.serving.label,
      servings: 1, nutrients: { ...food.nutrients }, source: 'manual' });
    closeSheet(); switchTab('log'); renderLog();
  });
}

function switchTab(name) {
  document.querySelector(`nav.tabs button[data-tab="${name}"]`).click();
}

// ---------- Goals + TDEE ----------
function renderGoals() {
  const g = getGoals();
  $('#goals-form').innerHTML = ['calories', 'protein', 'carbs', 'fat', 'fiber'].map(k => `
    <label class="field">${HEADLINE_LABEL[k]}${k === 'fiber' ? ' ✦' : ''} goal (${HEADLINE_UNIT[k] || 'kcal'})</label>
    <input type="number" id="g-${k}" value="${g[k]}" inputmode="decimal">`).join('') +
    `<div style="height:12px"></div><button class="btn" id="goals-save">Save goals</button>`;
  $('#goals-save').addEventListener('click', () => {
    const ng = {};
    ['calories', 'protein', 'carbs', 'fat', 'fiber'].forEach(k => { ng[k] = parseFloat($('#g-' + k).value) || 0; });
    setGoals(ng); renderGoals(); renderLog();
    $('#goals-msg').textContent = 'Goals saved.';
  });
}
$('#tdee-calc').addEventListener('click', () => {
  const age = parseFloat($('#t-age').value), h = parseFloat($('#t-height').value), w = parseFloat($('#t-weight').value);
  const sex = $('#t-sex').value, act = parseFloat($('#t-act').value);
  if (!age || !h || !w) { $('#tdee-out').textContent = 'Fill in age, height, and weight.'; return; }
  const bmr = 10 * w + 6.25 * h - 5 * age + (sex === 'male' ? 5 : -161);
  const tdee = Math.round(bmr * act);
  $('#tdee-out').innerHTML = `Estimated TDEE: <b>${tdee} kcal/day</b> (Mifflin-St Jeor, rough — not medical advice).<br>
    <button class="btn small" id="tdee-use" style="margin-top:8px">Use as calorie goal</button>`;
  $('#tdee-use').addEventListener('click', () => {
    setGoals({ calories: tdee }); renderGoals(); renderLog();
    $('#goals-msg').textContent = 'Calorie goal set to ' + tdee + '.';
  });
});

// ---------- init ----------
renderLog();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
