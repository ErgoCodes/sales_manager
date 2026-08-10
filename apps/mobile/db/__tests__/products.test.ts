import { eq } from 'drizzle-orm';

import { archiveProduct, createProduct, getProduct, listProducts, restoreProduct, updateProduct } from '../products';

import { getDb } from '../client';
import { products } from '../schema';
import { resetDb, seedEntry, seedProduct } from './helpers';

describe('db/products', () => {
  beforeEach(() => {
    resetDb();
  });

  describe('createProduct', () => {
    it('seeds averageCost with costPrice when creating a product', async () => {
      const id = await createProduct({
        name: 'Chupa chupa',
        category: 'Dulces',
        unitOfMeasure: 'u',
        costPrice: 45,
        cashPrice: 60,
        transferPrice: 60,
      });

      const [p] = getDb().select().from(products).where(eq(products.id, id)).all();
      expect(p.costPrice).toBe(45);
      expect(p.averageCost).toBe(45);
    });

    it('seeds averageCost as 0 when costPrice is not provided', async () => {
      const id = await createProduct({
        name: 'Sin costo',
        category: 'Dulces',
        unitOfMeasure: 'u',
        costPrice: null,
        cashPrice: 60,
        transferPrice: 60,
      });

      const [p] = getDb().select().from(products).where(eq(products.id, id)).all();
      expect(p.averageCost).toBe(0);
    });
  });

  describe('updateProduct', () => {
    it('updates the provided fields', async () => {
      const id = seedProduct({ name: 'Original', cashPrice: 60 });

      await updateProduct(id, {
        name: 'Renombrado',
        category: 'Bebidas',
        unitOfMeasure: 'u',
        costPrice: 45,
        cashPrice: 70,
        transferPrice: 70,
      });

      const product = await getProduct(id);
      expect(product?.name).toBe('Renombrado');
      expect(product?.cashPrice).toBe(70);
    });
  });

  describe('archiveProduct / restoreProduct', () => {
    it('excludes an archived product from listProducts by default, and restore brings it back', async () => {
      const id = seedProduct({ name: 'Producto' });

      await archiveProduct(id);
      expect(await listProducts()).toHaveLength(0);
      expect(await listProducts({ includeArchived: true })).toHaveLength(1);

      await restoreProduct(id);
      expect(await listProducts()).toHaveLength(1);
    });
  });

  describe('listProducts', () => {
    it('joins the derived stock and filters by search and category', async () => {
      const productId = seedProduct({ name: 'Refresco Cola', category: 'Bebidas' });
      seedProduct({ name: 'Jabón', category: 'Aseo personal' });
      seedEntry(productId, { quantity: 15 });

      const results = await listProducts({ search: 'cola' });
      expect(results).toHaveLength(1);
      expect(results[0].stock).toBe(15);

      expect(await listProducts({ category: 'Aseo personal' })).toHaveLength(1);
      expect(await listProducts({ category: 'Bebidas' })).toHaveLength(1);
    });

    it('orders results by name', async () => {
      seedProduct({ name: 'Zanahoria' });
      seedProduct({ name: 'Arroz' });

      const results = await listProducts();
      expect(results.map((p) => p.name)).toEqual(['Arroz', 'Zanahoria']);
    });
  });
});
