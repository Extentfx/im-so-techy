/** Normalizers for the two food databases. Pure, so they are tested against sample payloads. */

export interface FoodHit {
  name: string;
  brand: string | null;
  serving: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  barcode: string | null;
  source: 'openfoodfacts' | 'usda';
}

const n = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const r1 = (x: number) => Math.round(x * 10) / 10;

interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: Record<string, unknown>;
}

export function parseOffProduct(p: OffProduct): FoodHit | null {
  const name = (p.product_name ?? '').trim();
  const nu = p.nutriments ?? {};
  const kcal100 =
    n(nu['energy-kcal_100g']) ??
    (n(nu['energy_100g']) !== null ? n(nu['energy_100g'])! / 4.184 : null);
  if (!name || kcal100 === null) return null;
  const qty = Number(p.serving_quantity);
  const useServing = Number.isFinite(qty) && qty > 0 && qty <= 1000;
  const f = useServing ? qty / 100 : 1;
  return {
    name: name.slice(0, 120),
    brand: p.brands ? p.brands.split(',')[0]!.trim().slice(0, 60) : null,
    serving: useServing ? `${p.serving_size?.trim() || `${qty} g`}` : '100 g',
    kcal: Math.round(kcal100 * f),
    protein: r1((n(nu['proteins_100g']) ?? 0) * f),
    carbs: r1((n(nu['carbohydrates_100g']) ?? 0) * f),
    fat: r1((n(nu['fat_100g']) ?? 0) * f),
    barcode: p.code && /^\d{8,14}$/.test(p.code) ? p.code : null,
    source: 'openfoodfacts',
  };
}

interface UsdaFood {
  description?: string;
  brandOwner?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: { nutrientNumber?: string; value?: number }[];
}

export function parseUsdaFood(x: UsdaFood): FoodHit | null {
  const get = (num: string) => x.foodNutrients?.find((q) => q.nutrientNumber === num)?.value;
  const kcal100 = n(get('208'));
  const name = (x.description ?? '').trim();
  if (!name || kcal100 === null) return null;
  const grams =
    (x.servingSizeUnit ?? '').toLowerCase() === 'g' && n(x.servingSize) ? x.servingSize! : null;
  const f = grams ? grams / 100 : 1;
  const title = name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    name: title.slice(0, 120),
    brand: x.brandOwner ? x.brandOwner.slice(0, 60) : null,
    serving: grams ? `${grams} g` : '100 g',
    kcal: Math.round(kcal100 * f),
    protein: r1((n(get('203')) ?? 0) * f),
    carbs: r1((n(get('205')) ?? 0) * f),
    fat: r1((n(get('204')) ?? 0) * f),
    barcode: x.gtinUpc && /^\d{8,14}$/.test(x.gtinUpc) ? x.gtinUpc : null,
    source: 'usda',
  };
}

const UA = { 'user-agent': 'LifeDashboard/1.0 (personal use)' };
const FIELDS = 'code,product_name,brands,nutriments,serving_size,serving_quantity';

async function getJson(f: typeof fetch, url: string): Promise<unknown> {
  const res = await f(url, { headers: UA, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function searchFoods(
  f: typeof fetch,
  q: string,
  usdaKey: string,
): Promise<{
  results: FoodHit[];
  sources: { openfoodfacts: 'ok' | 'error'; usda: 'ok' | 'error' };
}> {
  const enc = encodeURIComponent(q);
  const sources = { openfoodfacts: 'ok' as 'ok' | 'error', usda: 'ok' as 'ok' | 'error' };
  const [off, usda] = await Promise.all([
    getJson(
      f,
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${enc}&search_simple=1&action=process&json=1&page_size=8&fields=${FIELDS}`,
    ).catch(() => ((sources.openfoodfacts = 'error'), null)),
    getJson(
      f,
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${enc}&pageSize=8&api_key=${encodeURIComponent(usdaKey)}`,
    ).catch(() => ((sources.usda = 'error'), null)),
  ]);
  const results: FoodHit[] = [];
  for (const p of ((off as { products?: OffProduct[] } | null)?.products ?? []).slice(0, 8)) {
    const h = parseOffProduct(p);
    if (h) results.push(h);
  }
  for (const x of ((usda as { foods?: UsdaFood[] } | null)?.foods ?? []).slice(0, 8)) {
    const h = parseUsdaFood(x);
    if (h) results.push(h);
  }
  return { results, sources };
}

export async function lookupBarcode(f: typeof fetch, code: string): Promise<FoodHit | null> {
  if (!/^\d{8,14}$/.test(code)) return null;
  try {
    const j = (await getJson(
      f,
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`,
    )) as { status?: number; product?: OffProduct };
    return j.status === 1 && j.product ? parseOffProduct({ ...j.product, code }) : null;
  } catch {
    return null;
  }
}
