import { Stack, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import {
  archiveProduct,
  listProducts,
  restoreProduct,
  type ProductWithStock,
} from "@/db/products";
import { CATEGORY_OPTIONS } from "@/drizzle/constants/catalog";
import { Radius, Shadows } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";

const CATEGORY_FILTER = [{ label: "Todas", value: "" }, ...CATEGORY_OPTIONS];

export default function CatalogScreen() {
  const c = useAppColors();
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
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
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: "Catálogo" }} />

      <View style={{ padding: 16, gap: 12 }}>
        <Input
          placeholder="Buscar por nombre…"
          value={search}
          onChangeText={setSearch}
        />
        <Select
          options={CATEGORY_FILTER}
          value={category}
          onChange={setCategory}
        />
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Pressable onPress={() => setIncludeArchived((v) => !v)} hitSlop={8}>
            <Text
              variant="label"
              style={{ color: includeArchived ? c.transfer : c.textMuted }}
            >
              {includeArchived
                ? "☑ Mostrando archivados"
                : "☐ Mostrar archivados"}
            </Text>
          </Pressable>
          <Button
            size="sm"
            label="+ Nuevo"
            onPress={() => router.push("/catalog/new")}
          />
        </View>
      </View>

      <FlatList
        data={products}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 32,
          gap: 12,
        }}
        ListEmptyComponent={
          <View style={{ alignItems: "center", paddingVertical: 48 }}>
            <Text variant="caption">
              No hay productos. Crea el primero con + Nuevo.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={{
              borderRadius: Radius.xl,
              backgroundColor: c.surface,
              padding: 16,
              gap: 8,
              boxShadow: Shadows.sm,
              opacity: item.active ? 1 : 0.6,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="heading">{item.name}</Text>
                <Text variant="caption">
                  {item.category ?? "Sin categoría"} · umbral{" "}
                  {item.lowStockThreshold ?? "—"}
                </Text>
              </View>
              <Text variant="label" style={{ color: c.text }}>
                {item.stock} {item.unitOfMeasure}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button
                size="sm"
                variant="outline"
                label="Editar"
                onPress={() => router.push(`/catalog/${item.id}`)}
              />
              <Button
                size="sm"
                variant={item.active ? "ghost" : "outline"}
                label={item.active ? "Archivar" : "Restaurar"}
                onPress={() => toggleArchive(item)}
              />
            </View>
          </View>
        )}
      />
    </View>
  );
}
