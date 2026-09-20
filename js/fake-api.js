// js/fake-api.js — FAKE food API (sample data only).
//
// Stand-in for the real pipeline:
//   local history -> Open Food Facts (/api/v2/product/{barcode}.json)
//                -> USDA FDC via worker proxy (search query={barcode}, Branded)
//                -> manual entry
//
// Callers use lookupBarcode() / searchFoods() and never touch the network
// directly, so swapping in the real pipeline later means replacing this file.

const NETWORK_MS = 400;
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Nutrients are per serving (label values), matching what a label shows.
const SAMPLE = [
  {
    barcodes: ['3017624010701'],
    brand: 'Ferrero', name: 'Nutella Hazelnut Spread',
    serving: { label: '2 tbsp', grams: 37 },
    nutrients: { calories: 200, protein: 2, carbs: 22, fat: 12, fiber: 1,
      sugar: 21, saturatedFat: 4, sodium: 15, potassium: 130, calcium: 0, iron: 0.7 },
    sample: true,
  },
  {
    barcodes: ['016000275287'],
    brand: 'General Mills', name: 'Honey Nut Cheerios',
    serving: { label: '1 cup', grams: 39 },
    nutrients: { calories: 160, protein: 3, carbs: 30, fat: 2, fiber: 3,
      sugar: 12, saturatedFat: 0.5, sodium: 210, potassium: 180, calcium: 130, iron: 8.1 },
    sample: true,
  },
  {
    barcodes: ['031558110131'],
    brand: 'Chobani', name: 'Greek Yogurt, Plain Non-Fat',
    serving: { label: '1 container', grams: 150 },
    nutrients: { calories: 80, protein: 14, carbs: 6, fat: 0, fiber: 0,
      sugar: 5, saturatedFat: 0, sodium: 60, potassium: 220, calcium: 150, iron: 0 },
    sample: true,
  },
  {
    barcodes: ['888849007521'],
    brand: 'Quest', name: 'Protein Bar, Cookies & Cream',
    serving: { label: '1 bar', grams: 60 },
    nutrients: { calories: 200, protein: 21, carbs: 25, fat: 8, fiber: 14,
      sugar: 1, saturatedFat: 3, sodium: 240, potassium: 160, calcium: 80, iron: 1.8 },
    sample: true,
  },
  {
    // Values verified against USDA FoodData Central (fdcId 2118224), 2026-09-20.
    barcodes: ['075925300009'],
    brand: 'Crystal Farms', name: 'Cheddar Cheese, Shredded',
    serving: { label: '1/4 cup', grams: 28 },
    nutrients: { calories: 110, protein: 6, carbs: 2, fat: 9, fiber: 0,
      sugar: 0, saturatedFat: 6, sodium: 190, potassium: 0, calcium: 200, iron: 0 },
    sample: true,
  },
  {
    barcodes: ['049000028904'],
    brand: 'Coca-Cola', name: 'Coca-Cola Classic',
    serving: { label: '12 fl oz', grams: 355 },
    nutrients: { calories: 140, protein: 0, carbs: 39, fat: 0, fiber: 0,
      sugar: 39, saturatedFat: 0, sodium: 45, potassium: 0, calcium: 0, iron: 0 },
    sample: true,
  },
];

function norm(b) {
  const d = String(b || '').replace(/[^0-9]/g, '');
  return d.replace(/^0+(?=\d)/, ''); // tolerate zero-padding differences
}

/** Look up one barcode. Returns {status:'found',product} or {status:'not_found',barcode}. */
export async function lookupBarcode(barcode) {
  await delay(NETWORK_MS);
  const digits = String(barcode || '').replace(/[^0-9]/g, '');
  const hit = SAMPLE.find(p => p.barcodes.some(b => norm(b) === norm(digits)));
  if (hit) return { status: 'found', product: { ...hit, nutrients: { ...hit.nutrients } } };
  return { status: 'not_found', barcode: digits };
}

/** Text search over the sample catalog. */
export async function searchFoods(query) {
  await delay(NETWORK_MS);
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  return SAMPLE
    .filter(p => (p.brand + ' ' + p.name).toLowerCase().includes(q))
    .map(p => ({ ...p, nutrients: { ...p.nutrients } }));
}

/** Scale a product's per-serving nutrients by a serving multiplier. */
export function scaleNutrients(product, servings) {
  const out = {};
  for (const [k, v] of Object.entries(product.nutrients)) {
    out[k] = Math.round(v * servings * 10) / 10;
  }
  return out;
}

export const HEADLINE = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
export const HEADLINE_LABEL = { calories: 'Cal', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', fiber: 'Fiber' };
export const HEADLINE_UNIT = { calories: '', protein: 'g', carbs: 'g', fat: 'g', fiber: 'g' };
export const EXTRA_LABEL = {
  sugar: 'Sugars', saturatedFat: 'Sat fat', sodium: 'Sodium',
  potassium: 'Potassium', calcium: 'Calcium', iron: 'Iron',
};
export const EXTRA_UNIT = {
  sugar: 'g', saturatedFat: 'g', sodium: 'mg',
  potassium: 'mg', calcium: 'mg', iron: 'mg',
};
