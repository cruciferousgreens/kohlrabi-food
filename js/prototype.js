// js/prototype.js — scanner prototype: camera + decode diagnostics on real hardware.
import { startScanner, normalizeBarcode } from './scanner.js';
import { lookupBarcode, scaleNutrients, HEADLINE, HEADLINE_LABEL, HEADLINE_UNIT } from './fake-api.js';
import { getHistory, saveHistory } from './store.js';

const $ = (s) => document.querySelector(s);
const logEl = $('#diag');
function log(msg) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent = `[${t}] ${msg}\n` + logEl.textContent;
}

let ctl = null;
$('#start-btn').addEventListener('click', async () => {
  if (ctl) { ctl.stop(); ctl = null; $('#start-btn').textContent = 'Start camera'; return; }
  logEl.textContent = '';
  log('requesting camera…');
  try {
    ctl = await startScanner({
      video: $('#viewfinder'),
      onDecode: (code, format) => {
        const n = normalizeBarcode(code);
        log(`DECODED: ${n} (${format || 'unknown format'})`);
        handleLookup(n);
      },
      onStatus: (msg) => { $('#scan-status').textContent = msg; log(msg); },
    });
    log('scanner running, path=' + ctl.path);
    log('settings: ' + JSON.stringify(ctl.settings));
    $('#start-btn').textContent = 'Stop camera';
  } catch (err) {
    log('ERROR: ' + err.message);
    $('#scan-status').textContent = err.message;
  }
});

let token = 0;
async function handleLookup(barcode) {
  const my = ++token;
  $('#result').innerHTML = '<div class="muted">Looking up ' + barcode + '…</div>';
  const cached = getHistory(barcode);
  if (cached) { if (my === token) showProduct(cached, barcode, true); return; }
  const res = await lookupBarcode(barcode);
  if (my !== token) return;
  if (res.status === 'found') {
    saveHistory(barcode, res.product);
    showProduct(res.product, barcode, false);
    log('lookup HIT: ' + res.product.brand + ' ' + res.product.name);
  } else {
    $('#result').innerHTML = `<div class="empty">No match for <b>${barcode}</b> in the sample catalog.<br>The real app would check Open Food Facts + USDA next.</div>`;
    log('lookup MISS: ' + barcode);
  }
}
function showProduct(p, barcode, cached) {
  $('#result').innerHTML = `
    <div class="card">
      <h3>${p.name}${p.sample ? '<span class="sample-badge">SAMPLE</span>' : ''}${cached ? '<span class="sample-badge">CACHED</span>' : ''}</h3>
      <div class="muted">${p.brand} · ${p.serving.label} (${p.serving.grams}g) · ${barcode}</div>
      <div class="macro-grid">${HEADLINE.map(k =>
        `<div class="m${k === 'fiber' ? ' fiber' : ''}"><div class="v">${p.nutrients[k]}${HEADLINE_UNIT[k]}</div><div class="k">${HEADLINE_LABEL[k]}</div></div>`).join('')}
      </div>
      <details class="nutrients"><summary>Raw product object</summary>
        <div class="diag">${JSON.stringify(p, null, 1).replace(/</g, '&lt;')}</div>
      </details>
    </div>`;
}

$('#manual-btn').addEventListener('click', () => {
  const v = normalizeBarcode($('#manual').value);
  if (v) { log('manual entry: ' + v); handleLookup(v); }
});

log('prototype ready — tap Start camera.');
log('userAgent: ' + navigator.userAgent);
