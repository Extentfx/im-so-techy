import { describe, expect, it } from 'vitest';
import { lookupBarcode, parseOffProduct, parseUsdaFood, searchFoods } from './foodsearch';

describe('food parsers', () => {
  it('scales Open Food Facts per-100g values to the serving size', () => {
    const h = parseOffProduct({
      code: '5449000000996',
      product_name: 'Cola',
      brands: 'Acme, Other',
      serving_size: '330 ml',
      serving_quantity: 330,
      nutriments: {
        'energy-kcal_100g': 42,
        proteins_100g: 0,
        carbohydrates_100g: 10.6,
        fat_100g: 0,
      },
    });
    expect(h).toMatchObject({
      name: 'Cola',
      brand: 'Acme',
      serving: '330 ml',
      kcal: 139,
      carbs: 35,
      barcode: '5449000000996',
      source: 'openfoodfacts',
    });
  });
  it('falls back to 100 g, converts kJ, and drops products without energy or a name', () => {
    expect(
      parseOffProduct({
        product_name: 'Oats',
        nutriments: { 'energy-kcal_100g': 370, proteins_100g: 13 },
      }),
    ).toMatchObject({ serving: '100 g', kcal: 370, protein: 13 });
    expect(
      parseOffProduct({ product_name: 'Kj only', nutriments: { energy_100g: 418.4 } })?.kcal,
    ).toBe(100);
    expect(parseOffProduct({ product_name: '', nutriments: { 'energy-kcal_100g': 1 } })).toBeNull();
    expect(parseOffProduct({ product_name: 'No energy', nutriments: {} })).toBeNull();
  });
  it('reads USDA nutrients by number and scales branded serving sizes', () => {
    const h = parseUsdaFood({
      description: 'CHICKEN BREAST, GRILLED',
      servingSize: 85,
      servingSizeUnit: 'g',
      foodNutrients: [
        { nutrientNumber: '208', value: 165 },
        { nutrientNumber: '203', value: 31 },
        { nutrientNumber: '205', value: 0 },
        { nutrientNumber: '204', value: 3.6 },
      ],
    });
    expect(h).toMatchObject({
      name: 'Chicken Breast, Grilled',
      serving: '85 g',
      kcal: 140,
      protein: 26.4,
      source: 'usda',
    });
    expect(parseUsdaFood({ description: 'x', foodNutrients: [] })).toBeNull();
  });
});

describe('searchFoods', () => {
  const json = (o: unknown) => new Response(JSON.stringify(o));
  it('merges both sources and survives one failing', async () => {
    const f: typeof fetch = async (u) => {
      const url = String(u);
      if (url.includes('openfoodfacts'))
        return json({
          products: [
            {
              product_name: 'Greek yogurt',
              nutriments: { 'energy-kcal_100g': 59, proteins_100g: 10 },
            },
          ],
        });
      return new Response('rate limited', { status: 429 });
    };
    const r = await searchFoods(f, 'yogurt', 'DEMO_KEY');
    expect(r.results.map((x) => x.name)).toEqual(['Greek yogurt']);
    expect(r.sources).toEqual({ openfoodfacts: 'ok', usda: 'error' });
  });
  it('only ever calls the two fixed food hosts and url-encodes the query', async () => {
    const urls: string[] = [];
    const f: typeof fetch = async (u) => (urls.push(String(u)), json({}));
    await searchFoods(f, 'a&b=c/../x', 'KEY');
    expect(urls).toHaveLength(2);
    expect(urls.map((u) => new URL(u).host).sort()).toEqual([
      'api.nal.usda.gov',
      'world.openfoodfacts.org',
    ]);
    expect(urls.every((u) => u.includes('a%26b%3Dc'))).toBe(true);
  });
  it('looks up barcodes and rejects malformed codes without a request', async () => {
    let calls = 0;
    const f: typeof fetch = async () => (
      calls++,
      json({ status: 1, product: { product_name: 'Bar', nutriments: { 'energy-kcal_100g': 400 } } })
    );
    expect(await lookupBarcode(f, '12345678')).toMatchObject({ name: 'Bar', barcode: '12345678' });
    expect(await lookupBarcode(f, '12; DROP')).toBeNull();
    expect(calls).toBe(1);
    expect(await lookupBarcode(async () => json({ status: 0 }), '12345678')).toBeNull();
  });
});
