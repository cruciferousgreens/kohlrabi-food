// js/app.js — Kohlrabi Food v1 (sample data). Tabs: Log / Scan / Goals.
import { startScanner, normalizeBarcode } from './scanner.js';
import { lookupBarcode, searchFoods, scaleNutrients, HEADLINE, HEADLINE_LABEL, HEADLINE_UNIT, EXTRA_LABEL, EXTRA_UNIT } from './fake-api.js';
import { todayISO, shiftISO, prettyDate, getDay, addEntry, removeEntry, dayTotals, periodDays, recentFoods, getWeights, addWeight, getGoals, setGoals, getCustom, addCustom, getHistory, saveHistory, getUnit, setUnit, getDirection, setDirection, getRate, setRate, getGoalWeight, setGoalWeight, getTDEE, setTDEE, exportAll, wipeAll } from './store.js';

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
    $('#fab-add').hidden = btn.dataset.tab !== 'log';
    if (btn.dataset.tab === 'scan') ensureScanner();
    else stopScanner();
    if (btn.dataset.tab === 'settings') renderSettings();
    if (btn.dataset.tab === 'stats') renderStats();
  });
});
$('#fab-add').addEventListener('click', openAddSheet);

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
    : `<div class="empty"><strong>Nothing logged yet.</strong><br>Tap + below to log your first item.</div>`;

  $('#entries').querySelectorAll('.del').forEach(b =>
    b.addEventListener('click', () => { removeEntry(viewISO, b.dataset.id); renderLog(); }));

  // Quick add: one-tap re-log of recently eaten foods, right on the log.
  const recents = recentFoods(6);
  $('#quick-card').hidden = recents.length === 0;
  if (recents.length) {
    $('#quick-add').innerHTML = recents.map((p, i) => `
      <div class="entry"><div><div class="name">${esc(p.name)}</div>
      <div class="amt">${esc(p.brand || '')}${p.brand ? ' · ' : ''}${esc(p.serving.label)} · ${Math.round(p.nutrients.calories)} kcal</div></div>
      <button class="btn small" data-q="${i}">Log</button></div>`).join('');
    $('#quick-add').querySelectorAll('[data-q]').forEach(b =>
      b.addEventListener('click', () => { addEntry(recents[+b.dataset.q], 1, viewISO); renderLog(); }));
  }
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

function openNotFoundSheet(barcode) { openManualEntrySheet(barcode); }

// Manual food entry — reached from a barcode miss or from the Log + button.
function openManualEntrySheet(barcode) {
  const title = barcode ? 'Not in the sample catalog' : 'Add food manually';
  const sub = barcode
    ? `Barcode ${esc(barcode)} · the real app would check Open Food Facts + USDA here.`
    : 'Type it in from the label.';
  openSheet(`
    <h2>${title}</h2>
    <div class="brand">${sub}</div>
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

// ---------- Log + button: scan / search / manual ----------
function openAddSheet() {
  openSheet(`
    <h2>Add food</h2>
    <div class="brand">How do you want to add it?</div>
    <button class="btn" id="add-scan" style="margin-bottom:8px">Scan barcode</button>
    <button class="btn secondary" id="add-search" style="margin-bottom:8px">Search foods</button>
    <button class="btn secondary" id="add-manual" style="margin-bottom:8px">Add manually</button>
    <div style="height:8px"></div>
    <button class="btn secondary" id="add-cancel">Cancel</button>
  `);
  $('#add-scan').addEventListener('click', () => { closeSheet(); switchTab('scan'); });
  $('#add-search').addEventListener('click', openSearchSheet);
  $('#add-manual').addEventListener('click', () => openManualEntrySheet(null));
  $('#add-cancel').addEventListener('click', closeSheet);
}

function openSearchSheet() {
  openSheet(`
    <h2>Search foods</h2>
    <div class="brand">Sample catalog + your custom foods</div>
    <div class="row">
      <input type="text" id="sh-q" placeholder="e.g. cheerios">
      <button class="btn small" id="sh-go">Search</button>
    </div>
    <div id="sh-results" style="margin-top:8px"></div>
    <div style="height:8px"></div>
    <button class="btn secondary" id="sh-cancel">Cancel</button>
  `);
  $('#sh-cancel').addEventListener('click', closeSheet);
  const run = async () => {
    const q = $('#sh-q').value.trim();
    if (q.length < 2) return;
    $('#sh-results').innerHTML = '<div class="muted">Searching…</div>';
    const hits = await searchFoods(q);
    const customs = getCustom().filter(c => c.name.toLowerCase().includes(q.toLowerCase()));
    const all = [...customs, ...hits];
    $('#sh-results').innerHTML = all.length ? all.map((p, i) => `
      <div class="entry"><div><div class="name">${esc(p.name)}${p.sample ? '<span class="sample-badge">SAMPLE</span>' : ''}${p.custom ? '<span class="sample-badge">CUSTOM</span>' : ''}</div>
      <div class="amt">${esc(p.brand || '')} · ${esc(p.serving.label)}${p.serving.grams ? ` (${p.serving.grams}g)` : ''}</div></div>
      <button class="btn small" data-i="${i}">Add</button></div>`).join('')
      : '<div class="empty"><strong>No matches</strong>Try adding it manually instead.</div>';
    $('#sh-results').querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => openProductSheet(all[+b.dataset.i], null)));
  };
  $('#sh-go').addEventListener('click', run);
  $('#sh-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  setTimeout(() => $('#sh-q').focus(), 50);
}

// ---------- Settings ----------
// Calorie targets follow the 3,500 kcal ≈ 1 lb rule: 1 lb/week = 500 kcal/day.
const DIR_DEFS = {
  lose: { label: 'Lose weight', rates: [0.5, 1, 1.5, 2] },
  maintain: { label: 'Maintain', rates: [] },
  gain: { label: 'Gain weight', rates: [0.25, 0.5, 1] },
};
function dirOffset() {
  const d = getDirection();
  if (d === 'maintain') return 0;
  return (d === 'lose' ? -1 : 1) * getRate() * 500;
}
// Set calorie goal from TDEE + direction/pace. Manual entry always wins —
// the estimator is advisory only.
function applyDirectionToCalories(announce) {
  const tdee = getTDEE();
  if (!(tdee > 0)) return;
  const target = Math.round(tdee + dirOffset());
  const g = getGoals(); g.calories = target; setGoals(g);
  if (announce) $('#goals-msg').textContent = `Calorie goal set to ${target.toLocaleString()}.`;
}

function renderSettings() {
  renderGoalsForm();
  renderCalGoal();
  renderUnitPills();
  $('#tdee-wunit').textContent = getUnit();
  $('#gw-unit').textContent = getUnit();
  prefillTdeeWeight();
  $('#export-json').onclick = () => {
    const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kohlrabi-food-export.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#delete-all').onclick = () => {
    if (confirm('Delete ALL food data, weigh-ins, and settings? This cannot be undone.')) {
      if (confirm('Really delete everything?')) { wipeAll(); location.reload(); }
    }
  };
}

function renderGoalsForm() {
  const g = getGoals();
  $('#goals-form').innerHTML = ['calories', 'protein', 'carbs', 'fat', 'fiber'].map(k => `
    <label class="field">${HEADLINE_LABEL[k]}${k === 'fiber' ? ' ✦' : ''} goal (${HEADLINE_UNIT[k] || 'kcal'})</label>
    <input type="number" id="g-${k}" value="${g[k]}" inputmode="decimal">`).join('') +
    `<div style="height:12px"></div><button class="btn" id="goals-save">Save goals</button>`;
  $('#goals-save').addEventListener('click', () => {
    const ng = {};
    ['calories', 'protein', 'carbs', 'fat', 'fiber'].forEach(k => { ng[k] = parseFloat($('#g-' + k).value) || 0; });
    setGoals(ng); renderGoalsForm(); renderLog();
    $('#goals-msg').textContent = 'Goals saved.';
  });
}

function renderCalGoal() {
  const dir = getDirection();
  const rates = DIR_DEFS[dir].rates;
  $('#dir-pills').innerHTML = Object.entries(DIR_DEFS).map(([k, v]) =>
    `<button type="button" class="period-tab" data-dir="${k}" aria-pressed="${dir === k}">${v.label}</button>`).join('');
  $('#dir-pills').querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => {
    if (getDirection() === b.dataset.dir) return;
    setDirection(b.dataset.dir);
    const nr = DIR_DEFS[b.dataset.dir].rates;
    if (!nr.includes(getRate())) setRate(nr[0] || 1);
    applyDirectionToCalories(false);
    renderCalGoal(); renderGoalsForm(); renderGwProjection();
  }));
  $('#rate-row').style.display = rates.length ? '' : 'none';
  if (rates.length) {
    $('#rate-pills').innerHTML = rates.map(r =>
      `<button type="button" class="period-tab" data-rate="${r}" aria-pressed="${getRate() === r}">${r} lb/wk</button>`).join('');
    $('#rate-pills').querySelectorAll('[data-rate]').forEach(b => b.addEventListener('click', () => {
      setRate(parseFloat(b.dataset.rate));
      applyDirectionToCalories(false);
      renderCalGoal(); renderGoalsForm(); renderGwProjection();
    }));
  }
  const tdee = getTDEE(), out = $('#cal-target-out');
  if (tdee > 0) {
    const delta = dirOffset();
    const target = Math.round(tdee + delta);
    const pace = dir === 'maintain' ? 'eat at maintenance'
      : `about ${getRate()} lb/week ${dir === 'lose' ? 'loss' : 'gain'} (3,500 kcal ≈ 1 lb)`;
    out.innerHTML = `Daily target: <strong>${target.toLocaleString()} kcal</strong><br>
      <span class="muted">TDEE ${Math.round(tdee).toLocaleString()} ${delta >= 0 ? '+' : '-'} ${Math.abs(delta)} · ${pace}.</span><br>
      <button class="btn small" id="use-target" style="margin-top:8px">Use this target</button>
      <div class="muted" style="margin-top:6px">Optional — or just type a calorie goal under Daily goals.</div>`;
    $('#use-target').onclick = () => { applyDirectionToCalories(true); renderGoalsForm(); renderLog(); renderCalGoal(); };
  } else {
    out.innerHTML = `<span class="muted">Estimate your TDEE below and I'll compute a daily target from the 3,500 kcal ≈ 1 lb rule. Or just type a calorie goal under Daily goals — the estimator is optional.</span>`;
  }
  const gwInput = $('#goal-weight');
  if (document.activeElement !== gwInput && !gwInput.dataset.touched) {
    const gw = getGoalWeight();
    gwInput.value = gw ? Math.round((getUnit() === 'kg' ? gw / 2.20462 : gw) * 10) / 10 : '';
  }
  $('#gw-save').onclick = () => {
    const v = parseFloat(gwInput.value);
    setGoalWeight(v > 0 ? (getUnit() === 'kg' ? v * 2.20462 : v) : 0);
    gwInput.dataset.touched = '1';
    renderGwProjection();
  };
  renderGwProjection();
}

function renderGwProjection() {
  const el = $('#gw-projection');
  const gw = getGoalWeight(), dir = getDirection(), weights = getWeights();
  const cur = weights.length ? weights[weights.length - 1].lb : 0;
  if (!gw || dir === 'maintain' || !cur) { el.textContent = ''; return; }
  const diff = dir === 'lose' ? cur - gw : gw - cur;
  if (diff <= 0) { el.textContent = 'Already at or past that goal weight — nice.'; return; }
  const weeks = Math.max(1, Math.ceil(diff / getRate()));
  el.textContent = `About ${weeks} week${weeks === 1 ? '' : 's'} to reach it at ${getRate()} lb/week.`;
}

function renderUnitPills() {
  const u = getUnit();
  $('#unit-pills').innerHTML = ['lb', 'kg'].map(x =>
    `<button type="button" class="period-tab" data-u="${x}" aria-pressed="${u === x}">${x === 'lb' ? 'Pounds (lb)' : 'Kilograms (kg)'}</button>`).join('');
  $('#unit-pills').querySelectorAll('[data-u]').forEach(b => b.addEventListener('click', () => {
    if (getUnit() === b.dataset.u) return;
    setUnit(b.dataset.u);
    renderSettings();
  }));
}

function prefillTdeeWeight() {
  const w = $('#t-weight');
  if (w.value) return;
  const weights = getWeights();
  if (!weights.length) return;
  const lb = weights[weights.length - 1].lb;
  w.value = Math.round((getUnit() === 'kg' ? lb / 2.20462 : lb) * 10) / 10;
}
$('#tdee-calc').addEventListener('click', () => {
  const age = parseFloat($('#t-age').value), h = parseFloat($('#t-height').value);
  let w = parseFloat($('#t-weight').value);
  const sex = $('#t-sex').value, act = parseFloat($('#t-act').value);
  if (!age || !h || !w) { $('#tdee-out').textContent = 'Fill in age, height, and weight.'; return; }
  if (getUnit() === 'lb') w = w / 2.20462; // formula takes kg
  const bmr = 10 * w + 6.25 * h - 5 * age + (sex === 'male' ? 5 : -161);
  const tdee = Math.round(bmr * act);
  setTDEE(tdee);
  const delta = dirOffset();
  const target = Math.round(tdee + delta);
  $('#tdee-out').innerHTML = `Estimated TDEE: <b>${tdee.toLocaleString()} kcal/day</b> (Mifflin-St Jeor, rough — not medical advice).<br>
    <span class="muted">With your ${DIR_DEFS[getDirection()].label.toLowerCase()} goal${delta ? ` (${delta > 0 ? '+' : '-'}${Math.abs(delta)})` : ''}: <b>${target.toLocaleString()} kcal/day</b>.</span><br>
    <button class="btn small" id="tdee-use" style="margin-top:8px">Use as calorie goal</button>`;
  $('#tdee-use').addEventListener('click', () => {
    applyDirectionToCalories(true); renderGoalsForm(); renderLog(); renderCalGoal();
  });
  renderCalGoal();
});

// ---------- Stats (goals vs actuals, workout-app language) ----------
let statsPeriod = 'week', statsWeekOffset = 0, statsSelDate = null;
const MACROS5 = ['calories', 'protein', 'carbs', 'fat', 'fiber'];

function mondayISO(offset) {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return todayISO(d);
}

function goalRow(k, actual, goal) {
  const pct = goal > 0 ? Math.min(100, (actual / goal) * 100) : 0;
  const over = goal > 0 && actual > goal;
  return `<div class="goalbar${over ? ' over' : ''}">
    <div class="lbl"><span class="${k === 'fiber' ? 'fiber-tag' : ''}">${HEADLINE_LABEL[k]}${k === 'fiber' ? ' ✦' : ''}</span>
    <span>${fmt(actual)}${HEADLINE_UNIT[k]} / ${goal}${HEADLINE_UNIT[k]}</span></div>
    <div class="track"><div class="fill${k === 'fiber' ? ' fiber' : ''}" style="width:${pct}%"></div></div>
  </div>`;
}

function renderStats() {
  const goals = getGoals();
  const tabs = $('#stats-period');
  tabs.innerHTML = ['week', 'month'].map(p =>
    `<button type="button" class="period-tab" data-p="${p}" aria-pressed="${statsPeriod === p}">${p === 'week' ? 'Week' : 'Month'}</button>`).join('');
  tabs.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => {
    if (statsPeriod === b.dataset.p) return;
    statsPeriod = b.dataset.p; statsSelDate = null; renderStats();
  }));
  $('#stats-week-prev').onclick = () => { statsWeekOffset -= 1; statsSelDate = null; renderStats(); };
  $('#stats-week-next').onclick = () => { if (statsWeekOffset < 0) { statsWeekOffset += 1; statsSelDate = null; renderStats(); } };
  $('#stats-week-next').style.opacity = statsWeekOffset >= 0 ? '.4' : '1';

  let days, label, showStrip = true;
  if (statsPeriod === 'week') {
    const start = mondayISO(statsWeekOffset);
    days = periodDays(start, 7);
    $('#stats-week-label').textContent = `${prettyDate(start)} – ${prettyDate(shiftISO(start, 6))}`;
  } else {
    showStrip = false;
    days = periodDays(shiftISO(todayISO(), -29), 30);
  }
  $('#stats-strip-wrap').style.display = showStrip ? '' : 'none';
  $('#stats-cal-card').style.display = showStrip ? '' : 'none';

  if (showStrip) {
    const today = todayISO();
    $('#stats-strip').innerHTML = days.map(({ iso, totals }) => {
      const d = new Date(iso + 'T12:00:00');
      const logged = getDay(iso).length > 0;
      return `<button type="button" class="day-chip${iso === today ? ' today' : ''}${logged ? ' has-log' : ''}${statsSelDate === iso ? ' selected' : ''}" data-d="${iso}" aria-pressed="${statsSelDate === iso}">
        <span>${d.toLocaleDateString(undefined, { weekday: 'narrow' })}</span><strong>${d.getDate()}</strong><em>${logged ? Math.round(totals.calories) : ''}</em></button>`;
    }).join('');
    $('#stats-strip').querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => {
      statsSelDate = statsSelDate === b.dataset.d ? null : b.dataset.d;
      renderStats();
    }));

    // Calories by day with goal line; tap a bar to inspect the day.
    const max = Math.max(goals.calories, ...days.map(d => d.totals.calories), 1);
    const goalPct = (goals.calories / max) * 100;
    $('#stats-cals').innerHTML = `
      <div class="bars">
        <div class="goal-line" style="bottom:${goalPct}%"></div>
        ${days.map(({ iso, totals }) => {
          const h = Math.max(2.5, (totals.calories / max) * 100);
          return `<div class="bar-col${statsSelDate === iso ? ' selected' : ''}" data-d="${iso}"><div class="bar${totals.calories > goals.calories ? ' over' : ''}" style="height:${h}%"></div></div>`;
        }).join('')}
      </div>
      <div class="bar-labels">${days.map(({ iso }) =>
        `<span>${new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</span>`).join('')}</div>
      <div class="muted" style="margin-top:8px">Dashed line = daily goal (${goals.calories} kcal). Tap a bar or day to inspect it.</div>`;
    $('#stats-cals').querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => {
      statsSelDate = statsSelDate === b.dataset.d ? null : b.dataset.d;
      renderStats();
    }));
  }

  // Goals vs actuals: selected day, or daily average across the period.
  let actuals;
  if (statsSelDate) {
    actuals = dayTotals(statsSelDate);
    label = prettyDate(statsSelDate);
  } else {
    actuals = {};
    for (const k of MACROS5) actuals[k] = days.reduce((s, d) => s + d.totals[k], 0) / days.length;
    for (const k of MACROS5) actuals[k] = Math.round(actuals[k] * 10) / 10;
    label = statsPeriod === 'week' ? 'daily average · this week' : 'daily average · last 30 days';
  }
  $('#stats-avg-label').textContent = '— ' + label;
  $('#stats-goals').innerHTML = MACROS5.map(k => goalRow(k, actuals[k], goals[k])).join('');
  renderWeights();
}

// ---------- Weight tracking (Stats) ----------
function renderWeights() {
  const unit = getUnit();
  const weights = getWeights();
  const toU = lb => unit === 'kg' ? lb / 2.20462 : lb;
  const fmtW = lb => `${Math.round(toU(lb) * 10) / 10} ${unit}`;
  $('#weight-add').onclick = openWeightSheet;
  if (!weights.length) {
    $('#weight-summary').innerHTML = '<div class="muted">No weigh-ins yet. Tap Enter weight to log your first.</div>';
    $('#weight-list').innerHTML = '';
    return;
  }
  const latest = weights[weights.length - 1];
  const target = shiftISO(latest.iso, -7);
  let ref = weights[0];
  for (const w of weights) { if (w.iso <= target) ref = w; }
  const deltaU = Math.round(toU(latest.lb - ref.lb) * 10) / 10;
  const dstr = Math.abs(deltaU) < 0.05 ? 'no change'
    : `${deltaU > 0 ? '+' : ''}${deltaU} ${unit}`;
  $('#weight-summary').innerHTML = `
    <div style="font-size:24px;font-weight:800;letter-spacing:-.02em">${fmtW(latest.lb)}</div>
    <div class="muted">${prettyDate(latest.iso)} · ${dstr} since ${prettyDate(ref.iso)}</div>`;
  $('#weight-list').innerHTML = weights.slice(-8).reverse().map(w =>
    `<div class="nut-row"><span>${prettyDate(w.iso)}</span><strong>${fmtW(w.lb)}</strong></div>`).join('');
}

function openWeightSheet() {
  const unit = getUnit();
  const weights = getWeights();
  const latest = weights.length ? weights[weights.length - 1] : null;
  const prefill = latest ? Math.round((unit === 'kg' ? latest.lb / 2.20462 : latest.lb) * 10) / 10 : '';
  openSheet(`
    <h2>Enter weight</h2>
    <div class="brand">Weigh-ins live under Stats, next to your nutrition trends.</div>
    <div class="row">
      <div style="flex:1"><label class="field">Weight (${unit})</label><input type="number" id="w-val" inputmode="decimal" value="${prefill}"></div>
      <div style="flex:1"><label class="field">Date</label><input type="date" id="w-date" value="${todayISO()}"></div>
    </div>
    <div style="height:12px"></div>
    <button class="btn" id="w-save">Save weigh-in</button>
    <div style="height:8px"></div>
    <button class="btn secondary" id="w-cancel">Cancel</button>
  `);
  $('#w-cancel').onclick = closeSheet;
  $('#w-save').onclick = () => {
    const v = parseFloat($('#w-val').value);
    const iso = $('#w-date').value || todayISO();
    if (!(v > 0)) return;
    addWeight(iso, unit === 'kg' ? v * 2.20462 : v);
    closeSheet();
    renderStats();
  };
  setTimeout(() => $('#w-val').focus(), 50);
}

// ---------- init ----------
renderLog();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
