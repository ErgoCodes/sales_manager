import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { listarProductos, type ProductoConStock } from '@/db/productos';

import { Input } from './input';
import { Text } from './text';

export interface ProductoSeleccionado {
  id: number;
  nombre: string;
  unidadMedida: string;
  precioCosto: number | null;
  precioEfectivo: number | null;
  precioTransferencia: number | null;
}

interface ProductPickerProps {
  label?: string;
  value?: ProductoSeleccionado | null;
  onChange: (producto: ProductoSeleccionado) => void;
  error?: string;
}

/** Input de búsqueda con lista desplegable de productos activos. Reutilizable en T-09. */
export function ProductPicker({ label, value, onChange, error }: ProductPickerProps) {
  const [busqueda, setBusqueda] = useState('');
  const [opciones, setOpciones] = useState<ProductoConStock[]>([]);
  const [abierto, setAbierto] = useState(false);

  const buscar = useCallback(async (texto: string) => {
    setBusqueda(texto);
    if (texto.trim().length === 0) {
      setOpciones([]);
      setAbierto(false);
      return;
    }
    const resultados = await listarProductos({ busqueda: texto });
    setOpciones(resultados);
    setAbierto(true);
  }, []);

  function seleccionar(p: ProductoConStock) {
    onChange({
      id: p.id,
      nombre: p.nombre,
      unidadMedida: p.unidadMedida,
      precioCosto: p.precioCosto,
      precioEfectivo: p.precioEfectivo,
      precioTransferencia: p.precioTransferencia,
    });
    setBusqueda(p.nombre);
    setAbierto(false);
  }

  return (
    <View className="gap-1 z-10">
      <Input
        label={label}
        value={value ? busqueda || value.nombre : busqueda}
        onChangeText={buscar}
        onFocus={() => {
          if (busqueda.trim()) setAbierto(true);
        }}
        placeholder="Buscar producto…"
        error={error}
      />
      {abierto && opciones.length > 0 ? (
        <View className="rounded-lg border border-gray-200 bg-white shadow-md max-h-48">
          <FlatList
            data={opciones}
            keyExtractor={(p) => String(p.id)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                className="px-3 py-2.5 border-b border-gray-100 active:bg-gray-50"
                onPress={() => seleccionar(item)}>
                <Text variant="body">{item.nombre}</Text>
                <Text variant="caption">
                  Stock: {item.stock} {item.unidadMedida}
                  {item.precioCosto != null ? ` · Costo: $${item.precioCosto}` : ''}
                </Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}
      {abierto && opciones.length === 0 && busqueda.trim() ? (
        <View className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <Text variant="caption">No se encontraron productos.</Text>
        </View>
      ) : null}
    </View>
  );
}
