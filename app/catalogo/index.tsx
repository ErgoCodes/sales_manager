import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { CATEGORIA_OPTIONS } from '@/constants/catalogo';
import {
  archivarProducto,
  listarProductos,
  type ProductoConStock,
  restaurarProducto,
} from '@/db/productos';

const FILTRO_CATEGORIAS = [{ label: 'Todas', value: '' }, ...CATEGORIA_OPTIONS];

export default function CatalogoScreen() {
  const [productos, setProductos] = useState<ProductoConStock[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState('');
  const [incluirArchivados, setIncluirArchivados] = useState(false);

  const cargar = useCallback(() => {
    let activo = true;
    (async () => {
      const data = await listarProductos({
        busqueda,
        categoria: categoria || undefined,
        incluirArchivados,
      });
      if (activo) setProductos(data);
    })();
    return () => {
      activo = false;
    };
  }, [busqueda, categoria, incluirArchivados]);

  useFocusEffect(cargar);

  async function toggleArchivar(p: ProductoConStock) {
    if (p.activo) await archivarProducto(p.id);
    else await restaurarProducto(p.id);
    cargar();
  }

  return (
    <View className="flex-1 bg-gray-50">
      <Stack.Screen options={{ title: 'Catálogo' }} />

      <View className="p-4 gap-3">
        <Input placeholder="Buscar por nombre…" value={busqueda} onChangeText={setBusqueda} />
        <Select options={FILTRO_CATEGORIAS} value={categoria} onChange={setCategoria} />
        <View className="flex-row items-center justify-between">
          <Pressable onPress={() => setIncluirArchivados((v) => !v)} hitSlop={8}>
            <Text variant="label" className={incluirArchivados ? 'text-blue-600' : 'text-gray-500'}>
              {incluirArchivados ? '☑ Mostrando archivados' : '☐ Mostrar archivados'}
            </Text>
          </Pressable>
          <Button size="sm" label="+ Nuevo" onPress={() => router.push('/catalogo/nuevo')} />
        </View>
      </View>

      <FlatList
        data={productos}
        keyExtractor={(p) => String(p.id)}
        contentContainerClassName="px-4 pb-8 gap-3"
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text variant="caption">No hay productos. Crea el primero con + Nuevo.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            className={`rounded-xl bg-white p-4 shadow-sm gap-2 ${item.activo ? '' : 'opacity-60'}`}>
            <View className="flex-row items-start justify-between">
              <View className="flex-1 gap-0.5">
                <Text variant="heading">{item.nombre}</Text>
                <Text variant="caption">
                  {item.categoria ?? 'Sin categoría'} · umbral {item.umbralAlerta ?? '—'}
                </Text>
              </View>
              <Text variant="label" className="text-gray-700">
                {item.stock} {item.unidadMedida}
              </Text>
            </View>
            <View className="flex-row gap-2">
              <Button
                size="sm"
                variant="outline"
                label="Editar"
                onPress={() => router.push(`/catalogo/${item.id}`)}
              />
              <Button
                size="sm"
                variant={item.activo ? 'ghost' : 'outline'}
                label={item.activo ? 'Archivar' : 'Restaurar'}
                onPress={() => toggleArchivar(item)}
              />
            </View>
          </View>
        )}
      />
    </View>
  );
}
