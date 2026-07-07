import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { listProducts, type ProductWithStock } from '@/db/products';

import { Input } from './input';
import { Text } from './text';

export interface SelectedProduct {
  id: number;
  name: string;
  unitOfMeasure: string;
  costPrice: number | null;
  cashPrice: number | null;
  transferPrice: number | null;
  averageCost: number;
}

interface ProductPickerProps {
  label?: string;
  value?: SelectedProduct | null;
  onChange: (product: SelectedProduct) => void;
  error?: string;
}

export function ProductPicker({ label, value, onChange, error }: ProductPickerProps) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<ProductWithStock[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const handleSearch = useCallback(async (text: string) => {
    setSearch(text);
    if (text.trim().length === 0) {
      setOptions([]);
      setIsOpen(false);
      return;
    }
    const results = await listProducts({ search: text });
    setOptions(results);
    setIsOpen(true);
  }, []);

  function handleSelect(p: ProductWithStock) {
    onChange({
      id: p.id,
      name: p.name,
      unitOfMeasure: p.unitOfMeasure,
      costPrice: p.costPrice,
      cashPrice: p.cashPrice,
      transferPrice: p.transferPrice,
      averageCost: p.averageCost,
    });
    setSearch(p.name);
    setIsOpen(false);
  }

  return (
    <View className="gap-1 z-10">
      <Input
        label={label}
        value={value ? search || value.name : search}
        onChangeText={handleSearch}
        onFocus={() => {
          if (search.trim()) setIsOpen(true);
        }}
        placeholder="Buscar producto…"
        error={error}
      />
      {isOpen && options.length > 0 ? (
        <View className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-md max-h-48">
          <FlatList
            data={options}
            keyExtractor={(p) => String(p.id)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                className="px-3 py-2.5 border-b border-gray-100 dark:border-slate-800 active:bg-gray-50 dark:active:bg-slate-800"
                onPress={() => handleSelect(item)}>
                <Text variant="body">{item.name}</Text>
                <Text variant="caption">
                  Stock: {item.stock} {item.unitOfMeasure}
                  {item.costPrice != null ? ` · Costo: $${item.costPrice}` : ''}
                </Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}
      {isOpen && options.length === 0 && search.trim() ? (
        <View className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5">
          <Text variant="caption">No se encontraron productos.</Text>
        </View>
      ) : null}
    </View>
  );
}
