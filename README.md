# Kohlrabi Food

Barcode-first food tracker. Separate app from the Kohlrabi workout tracker.
Live (GitHub Pages): https://cruciferousgreens.github.io/kohlrabi-food/

**Status: prototype with SAMPLE data.** All nutrition values are hard-coded
samples in `js/fake-api.js` — nothing here is real nutrition advice.

## Pages

- `/` — v1 app: Scan / Log / Goals tabs. Flat chronological day log,
  headline macros (calories, protein, carbs, fat, **fiber** — fiber is elevated
  by design), full label nutrients behind a disclosure, goal bars, TDEE
  estimator (Mifflin-St Jeor, optional).
- `/prototype/` — scanner hardware check: which decoder path the browser takes
  (native `BarcodeDetector` vs vendored `zxing-wasm`), camera resolution,
  decode latency, lookup result.

## How the real data pipeline will plug in

`js/fake-api.js` is the seam. Callers only use `lookupBarcode()` /
`searchFoods()`. The real pipeline, per scan:

1. Local scan history (already in `js/store.js` — instant, offline)
2. Open Food Facts: `GET https://world.openfoodfacts.org/api/v2/product/{barcode}.json`
   (no key; send a `User-Agent` header; misses return HTTP 200 with `status: 0`)
3. USDA FoodData Central via a Cloudflare Worker proxy (API key stays server-side;
   search `query={barcode}`, Branded data type; normalize zero-padding)
4. Manual entry (already built)

## Scanner

`js/scanner.js`: native `BarcodeDetector` where available, `zxing-wasm`
fallback elsewhere (iOS Safari). The WASM module is vendored under
`vendor/zxing/` and cached by the service worker, so scanning works offline
after first load. No build step — plain ES modules.

## Conventions

- localStorage-first, no account in v1 (`kfood:*` keys).
- No minification, no build step (same philosophy as the workout app).
- No AI-generated imagery; icon is an emoji SVG.
- Privacy: no personal names in code, commits, or docs.
