import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { CATEGORY_OPTIONS } from '@/constants/catalog';
import {
  archiveProduct,
  listProducts,
  type ProductWithStock,
  restoreProduct,
} from '@/db/products';

const CATEGORY_FILTER = [{ label: 'Todas', value: '' }, ...CATEGORY_OPTIONS];

export default function CatalogScreen() {
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const load = useCallback(() => {
    let active = true;
    (async () => {
      const data = await listProducts({
        search,
        category: category || undefined,
        includeArchived,
      });
      if (active) setProducts(data);
    })();
    return () => {
      active = false;
    };
  }, [search, category, includeArchived]);

  useFocusEffect(load);

  async function toggleArchive(p: ProductWithStock) {
    if (p.active) await archiveProduct(p.id);
    else await restoreProduct(p.id);
    load();
  }

  return (
    <View className="flex-1 bg-gray-50">
      <Stack.Screen options={{ title: 'Catálogo' }} />

      <View className="p-4 gap-3">
        <Input placeholder="Buscar por nombre…" value={search} onChangeText={setSearch} />
        <Select options={CATEGORY_FILTER} value={category} onChange={setCategory} />
        <View className="flex-row items-center justify-between">
          <Pressable onPress={() => setIncludeArchived((v) => !v)} hitSlop={8}>
            <Text variant="label" className={includeArchived ? 'text-blue-600' : 'text-gray-500'}>
              {includeArchived ? '☑ Mostrando archivados' : '☐ Mostrar archivados'}
            </Text>
          </Pressable>
          <Button size="sm" label="+ Nuevo" onPress={() => router.push('/catalog/new')} />
        </View>
      </View>

      <FlatList
        data={products}
        keyExtractor={(p) => String(p.id)}
        contentContainerClassName="px-4 pb-8 gap-3"
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text variant="caption">No hay productos. Crea el primero con + Nuevo.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            className={`rounded-xl bg-white p-4 shadow-sm gap-2 ${item.active ? '' : 'opacity-60'}`}>
            <View className="flex-row items-start justify-between">
              <View className="flex-1 gap-0.5">
                <Text variant="heading">{item.name}</Text>
                <Text variant="caption">
                  {item.category ?? 'Sin categoría'} · umbral {item.lowStockThreshold ?? '—'}
                </Text>
              </View>
              <Text variant="label" className="text-gray-700">
                {item.stock} {item.unitOfMeasure}
              </Text>
            </View>
            <View className="flex-row gap-2">
              <Button
                size="sm"
                variant="outline"
                label="Editar"
                onPress={() => router.push(`/catalog/${item.id}`)}
              />
              <Button
                size="sm"
                variant={item.active ? 'ghost' : 'outline'}
                label={item.active ? 'Archivar' : 'Restaurar'}
                onPress={() => toggleArchive(item)}
              />
            </View>
          </View>
        )}
      />
    </View>
  );
}
