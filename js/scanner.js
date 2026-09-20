// js/scanner.js — shared barcode scanner.
// Native BarcodeDetector where the browser has one, zxing-wasm fallback
// (vendored under vendor/zxing, cached by the service worker) everywhere else.
// No build step: plain ES module, wasm located relative to this file so it
// works from any base path (GitHub Pages project sites included).

const RETAIL_FORMATS_NATIVE = ['ean_13', 'upc_a', 'upc_e', 'ean_8', 'code_128'];
const RETAIL_FORMATS_WASM = ['EAN-13', 'UPC-A', 'UPC-E', 'EAN-8', 'Code-128'];
const DUP_SUPPRESS_MS = 2500;

function wasmUrl() {
  return new URL('../vendor/zxing/zxing_reader.wasm', import.meta.url).href;
}

async function loadWasmReader() {
  const mod = await import('../vendor/zxing/es/reader/index.js');
  await mod.prepareZXingModule({
    overrides: { locateFile: () => wasmUrl() },
    fireImmediately: true,
  });
  return mod;
}

/**
 * Scan barcodes from the device camera.
 * @param {Object} opts
 * @param {HTMLVideoElement} opts.video - video element to stream into
 * @param {(code:string, format:string)=>void} opts.onDecode - fired on new decodes
 * @param {(msg:string)=>void} [opts.onStatus] - status/diagnostic messages
 * @returns {Promise<{stop:()=>void, path:'native'|'wasm', settings:Object}>}
 */
export async function startScanner({ video, onDecode, onStatus }) {
  const say = onStatus || (() => {});
  const path = ('BarcodeDetector' in window) ? 'native' : 'wasm';
  say(`decoder: ${path}`);

  // Camera
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch (err) {
    throw new Error('Camera unavailable: ' + (err.name || err.message) +
      '. Check permission in the browser settings.');
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play();
  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings ? track.getSettings() : {};
  say(`camera: ${settings.width || '?'}x${settings.height || '?'} (${track.label || 'unknown'})`);

  let stopped = false;
  let lastCode = '', lastAt = 0;
  const fire = (code, format) => {
    const now = Date.now();
    if (code === lastCode && now - lastAt < DUP_SUPPRESS_MS) return;
    lastCode = code; lastAt = now;
    onDecode(code, format);
  };

  let timer = 0;

  if (path === 'native') {
    const detector = new window.BarcodeDetector({ formats: RETAIL_FORMATS_NATIVE });
    const tick = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length) {
          const c = codes[0];
          fire(String(c.rawValue || ''), String(c.format || ''));
        }
      } catch { /* keep scanning */ }
      if (!stopped) timer = setTimeout(tick, 300);
    };
    tick();
  } else {
    // WASM fallback: grab frames from a canvas, decode at ~4 fps.
    let mod;
    try {
      mod = await loadWasmReader();
      say('wasm decoder ready');
    } catch (err) {
      stop();
      throw new Error('Could not load the barcode decoder: ' + err.message);
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (stopped) return;
      const t0 = performance.now();
      try {
        const vw = video.videoWidth, vh = video.videoHeight;
        if (vw && vh) {
          // Center crop matching the on-screen viewfinder frame.
          const cw = Math.floor(vw * 0.7), ch = Math.floor(vh * 0.34);
          const cx = Math.floor((vw - cw) / 2), cy = Math.floor((vh - ch) / 2);
          canvas.width = cw; canvas.height = ch;
          ctx.drawImage(video, cx, cy, cw, ch, 0, 0, cw, ch);
          const img = ctx.getImageData(0, 0, cw, ch);
          let results = [];
          try {
            results = await mod.readBarcodes(img, { formats: RETAIL_FORMATS_WASM });
          } catch {
            results = await mod.readBarcodes(img); // retry unrestricted
          }
          if (results && results.length) {
            const r = results[0];
            say(`decoded in ${Math.round(performance.now() - t0)} ms`);
            fire(String(r.text || ''), String(r.format || ''));
          }
        }
      } catch { /* keep scanning */ }
      if (!stopped) timer = setTimeout(tick, 250);
    };
    tick();
  }

  function stop() {
    stopped = true;
    clearTimeout(timer);
    try { stream.getTracks().forEach(t => t.stop()); } catch {}
  }
  return { stop, path, settings };
}

/** Normalize a scanned code for lookup: strip whitespace, keep digits. */
export function normalizeBarcode(code) {
  return String(code || '').replace(/[^0-9]/g, '');
}
