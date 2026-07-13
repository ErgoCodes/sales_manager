import { useCallback, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { listProducts, type ProductWithStock } from "@/db/products";
import { Radius, Shadows } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";

import { Input } from "./input";
import { Text } from "./text";

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

export function ProductPicker({
  label,
  value,
  onChange,
  error,
}: ProductPickerProps) {
  const c = useAppColors();
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<ProductWithStock[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef("");

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
    latest.current = text;
    clearTimeout(timer.current);

    if (text.trim().length === 0) {
      setOptions([]);
      setIsOpen(false);
      return;
    }

    timer.current = setTimeout(async () => {
      const results = await listProducts({ search: text });
      if (latest.current === text) {
        setOptions(results);
        setIsOpen(true);
      }
    }, 250);
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
        // View + map en vez de FlatList: la lista de sugerencias es corta
        // (acotada por maxHeight) y anidar un VirtualizedList dentro del
        // ScrollView de la pantalla contenedora dispara el warning de RN.
        <View
          style={{
            borderRadius: Radius.md,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
            boxShadow: Shadows.md,
            maxHeight: 192,
            overflow: "hidden",
          }}
        >
          {options.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => ({
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: c.border,
                backgroundColor: pressed ? c.surfaceMuted : "transparent",
              })}
              onPress={() => handleSelect(item)}
            >
              <Text variant="body">{item.name}</Text>
              <Text variant="caption">
                Stock: {item.stock} {item.unitOfMeasure}
                {item.costPrice != null ? ` · Costo: $${item.costPrice}` : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {isOpen && options.length === 0 && search.trim() ? (
        <View
          style={{
            borderRadius: Radius.md,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        >
          <Text variant="caption">No se encontraron productos.</Text>
        </View>
      ) : null}
    </View>
  );
}
