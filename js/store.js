// js/store.js — local-first persistence (localStorage). No account, no sync in v1.
const K = { log: 'kfood:log:v1', goals: 'kfood:goals:v1', custom: 'kfood:custom:v1', history: 'kfood:history:v1', settings: 'kfood:settings:v1' };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

export function todayISO(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function shiftISO(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return todayISO(d);
}
export function prettyDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// --- Day log: { [iso]: [entry] } ; entry = {id, ts, name, brand, amountLabel, servings, nutrients, source}
export function getDay(iso) { return read(K.log, {})[iso] || []; }
export function addEntry(iso, entry) {
  const log = read(K.log, {});
  const day = log[iso] || [];
  day.push({ ...entry, id: 'e' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), ts: Date.now() });
  log[iso] = day;
  write(K.log, log);
}
export function removeEntry(iso, id) {
  const log = read(K.log, {});
  log[iso] = (log[iso] || []).filter(e => e.id !== id);
  write(K.log, log);
}
export function dayTotals(iso) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  for (const e of getDay(iso)) {
    for (const k of Object.keys(t)) t[k] += (e.nutrients && e.nutrients[k]) || 0;
  }
  for (const k of Object.keys(t)) t[k] = Math.round(t[k] * 10) / 10;
  return t;
}

// --- Period aggregates: [{iso, totals}] for n consecutive days from startISO ---
export function periodDays(startISO, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const iso = shiftISO(startISO, i);
    out.push({ iso, totals: dayTotals(iso) });
  }
  return out;
}

// --- Recently-logged foods (for quick re-logging) ---
export function recentFoods(limit = 6) {
  const seen = new Map();
  const t = todayISO();
  for (let i = 0; i < 30 && seen.size < limit; i++) {
    const iso = shiftISO(t, -i);
    for (const e of getDay(iso)) {
      const key = [e.name, e.brand, e.amountLabel].join('|');
      if (!seen.has(key)) seen.set(key, e);
    }
  }
  return [...seen.values()].slice(0, limit);
}

// --- Body weight entries: [{iso, lb}] sorted ascending ---
function settings() { return read(K.settings, {}); }
function saveSettings(d) { write(K.settings, d); }

export function getWeights() {
  return (settings().weights || []).slice().sort((a, b) => a.iso < b.iso ? -1 : 1);
}
export function addWeight(iso, lb) {
  const d = settings();
  d.weights = (d.weights || []).filter(w => w.iso !== iso);
  d.weights.push({ iso, lb: Math.round(lb * 10) / 10 });
  saveSettings(d);
}

// --- Settings: weight unit, goal direction, last TDEE ---
export function getUnit() { return settings().unit || 'lb'; }
export function setUnit(u) { const d = settings(); d.unit = u; saveSettings(d); }
export function getDirection() { return settings().direction || 'maintain'; }
export function setDirection(dir) { const d = settings(); d.direction = dir; saveSettings(d); }
export function getRate() { const r = settings().rate; return r > 0 ? r : 1; }
export function setRate(r) { const d = settings(); d.rate = r; saveSettings(d); }
export function getGoalWeight() { return settings().goalWeightLb || 0; } // stored in lb
export function setGoalWeight(lb) { const d = settings(); d.goalWeightLb = lb; saveSettings(d); }
export function getTDEE() { return settings().tdee || 0; }
export function setTDEE(t) { const d = settings(); d.tdee = t; saveSettings(d); }
export function exportAll() {
  const out = {};
  for (const k of Object.values(K)) out[k] = read(k, null);
  return out;
}
export function wipeAll() { try { for (const k of Object.values(K)) localStorage.removeItem(k); } catch (_) {} }

// --- Log entry serving edits (rescales nutrients by servings ratio) ---
export function updateEntryServings(iso, id, servings) {
  if (!(servings > 0)) return;
  const log = read(K.log, {});
  const e = (log[iso] || []).find(x => x.id === id);
  if (!e) return;
  const ratio = servings / (e.servings || 1);
  const n = {};
  for (const k of ['calories', 'protein', 'carbs', 'fat', 'fiber'])
    n[k] = Math.round(((e.nutrients && e.nutrients[k]) || 0) * ratio * 10) / 10;
  e.servings = servings;
  e.nutrients = { ...(e.nutrients || {}), ...n };
  if (e.amountLabel) e.amountLabel = e.amountLabel.replace(/^[\d.]+ × /, `${fmtNum(servings)} × `);
  write(K.log, log);
}
function fmtNum(n) { return (Math.round(n * 100) / 100).toString(); }

// --- Goals ---
const DEFAULT_GOALS = { calories: 2200, protein: 150, carbs: 250, fat: 75, fiber: 30 };
export function getGoals() { return { ...DEFAULT_GOALS, ...read(K.goals, {}) }; }
export function setGoals(g) { write(K.goals, { ...getGoals(), ...g }); }

// --- Custom foods (manual entries), keyed by id ---
export function getCustom() { return read(K.custom, []); }
export function addCustom(food) {
  const list = getCustom();
  const item = { ...food, id: 'c' + Date.now().toString(36), custom: true };
  list.unshift(item);
  write(K.custom, list);
  return item;
}

// --- Scan history: barcode -> product (instant re-lookup, offline) ---
export function getHistory(barcode) { return read(K.history, {})[barcode]; }
export function saveHistory(barcode, product) {
  const h = read(K.history, {});
  h[barcode] = product;
  const keys = Object.keys(h);
  if (keys.length > 200) delete h[keys[0]]; // cap
  write(K.history, h);
}
