import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { listProducts, type ProductWithStock } from '@/db/products';
import { useAppColors } from '@/hooks/use-app-colors';
import { Radius, Shadows } from '@/constants/theme';

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
  const c = useAppColors();
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
    <View style={{ gap: 4, zIndex: 10 }}>
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
        <View style={{
          borderRadius: Radius.md,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
          boxShadow: Shadows.md,
          maxHeight: 192,
        }}>
          <FlatList
            data={options}
            keyExtractor={(p) => String(p.id)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => ({
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: c.border,
                  backgroundColor: pressed ? c.surfaceMuted : 'transparent',
                })}
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
        <View style={{
          borderRadius: Radius.md,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}>
          <Text variant="caption">No se encontraron productos.</Text>
        </View>
      ) : null}
    </View>
  );
}
