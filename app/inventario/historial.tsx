import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { type EntradaConProducto, listarEntradas } from '@/db/movimientos';

export default function HistorialEntradasScreen() {
  const [entradas, setEntradas] = useState<EntradaConProducto[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  const cargar = useCallback(() => {
    let activo = true;
    (async () => {
      const data = await listarEntradas({
        fechaDesde: fechaDesde || undefined,
        fechaHasta: fechaHasta || undefined,
      });
      if (!activo) return;
      if (busqueda.trim()) {
        const lower = busqueda.toLowerCase();
        setEntradas(data.filter((e) => e.productoNombre.toLowerCase().includes(lower)));
      } else {
        setEntradas(data);
      }
    })();
    return () => {
      activo = false;
    };
  }, [busqueda, fechaDesde, fechaHasta]);

  useFocusEffect(cargar);

  return (
    <View className="flex-1 bg-gray-50">
      <Stack.Screen options={{ title: 'Historial de entradas' }} />

      <View className="p-4 gap-3">
        <Input
          placeholder="Filtrar por producto…"
          value={busqueda}
          onChangeText={setBusqueda}
        />
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Input
              label="Desde"
              placeholder="YYYY-MM-DD"
              value={fechaDesde}
              onChangeText={setFechaDesde}
            />
          </View>
          <View className="flex-1">
            <Input
              label="Hasta"
              placeholder="YYYY-MM-DD"
              value={fechaHasta}
              onChangeText={setFechaHasta}
            />
          </View>
        </View>
      </View>

      <FlatList
        data={entradas}
        keyExtractor={(e) => String(e.id)}
        contentContainerClassName="px-4 pb-8 gap-3"
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text variant="caption">No hay entradas registradas.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="rounded-xl bg-white p-4 shadow-sm gap-1">
            <View className="flex-row items-start justify-between">
              <Text variant="heading">{item.productoNombre}</Text>
              <Text variant="caption">{item.fecha}</Text>
            </View>
            <Text variant="body">
              {item.cantidad} {item.unidadMedida} × ${item.precioCostoUnitario}
            </Text>
            {item.notas ? <Text variant="caption">{item.notas}</Text> : null}
          </View>
        )}
      />
    </View>
  );
}
