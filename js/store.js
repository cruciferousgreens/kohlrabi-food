// js/store.js — local-first persistence (localStorage). No account, no sync in v1.
const K = { log: 'kfood:log:v1', goals: 'kfood:goals:v1', custom: 'kfood:custom:v1', history: 'kfood:history:v1' };

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
