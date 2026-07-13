import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroCard } from "@/components/ui/hero-card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { CONFIG_KEYS, getConfig } from "@/db/config";
import { listProducts, type ProductWithStock } from "@/db/products";
import { getLastSaleDates } from "@/db/queries";
import { getProductThreshold } from "@/drizzle/constants/catalog";
import {
  Colors,
  FontSize,
  Overlay,
  Radius,
  Shadows,
} from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";
import { formatCurrency } from "@/lib/format";
import { isNearExpiration, isStagnant } from "@/lib/product-status";

interface ProductWithValue extends ProductWithStock {
  value: number;
  threshold: number;
  isLow: boolean;
  isStagnant: boolean;
  isNearExpiration: boolean;
}

interface FilterChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  count?: number;
  accent?: string;
}

function FilterChip({
  label,
  active,
  onPress,
  count,
  accent,
}: FilterChipProps) {
  const c = useAppColors();
  const chipAccent = accent ?? c.tint;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: Radius.full,
        backgroundColor: active ? chipAccent : c.surface,
        borderWidth: 1,
        borderColor: active ? chipAccent : c.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          fontSize: FontSize.md,
          fontWeight: "600",
          color: active ? Colors.light.surface : c.text,
        }}
      >
        {label}
      </Text>
      {count !== undefined ? (
        <View
          style={{
            paddingHorizontal: 6,
            paddingVertical: 1,
            borderRadius: Radius.full,
            backgroundColor: active ? Overlay.strong : c.surfaceMuted,
            minWidth: 20,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              fontSize: FontSize.xs,
              fontWeight: "700",
              color: active ? Colors.light.surface : c.textMuted,
              fontVariant: ["tabular-nums"],
            }}
          >
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function InventoryScreen() {
  const c = useAppColors();
  const [products, setProducts] = useState<ProductWithValue[]>([]);
  const [totalInventory, setTotalInventory] = useState(0);
  const [filter, setFilter] = useState<"all" | "low" | "stagnant">("all");

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [list, thresholdStr, lastSaleDates] = await Promise.all([
          listProducts(),
          getConfig(CONFIG_KEYS.generalStockThreshold),
          getLastSaleDates(),
        ]);
        if (!active) return;
        const generalThreshold = Number(thresholdStr ?? 5);
        let total = 0;
        const withValue = list.map((p) => {
          const val = p.stock * (p.averageCost ?? 0);
          total += val;
          const threshold = getProductThreshold(p, generalThreshold);
          return {
            ...p,
            value: val,
            threshold,
            isLow: p.stock < threshold,
            isStagnant: isStagnant({
              stock: p.stock,
              lastSaleDate: lastSaleDates.get(p.id) ?? null,
            }),
            isNearExpiration: isNearExpiration({
              expirationDate: p.expirationDate,
            }),
          };
        });
        setProducts(withValue);
        setTotalInventory(total);
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const lowCount = products.filter((p) => p.isLow).length;
  const stagnantCount = products.filter(
    (p) => p.isStagnant || p.isNearExpiration
  ).length;
  const filteredList =
    filter === "low"
      ? products.filter((p) => p.isLow)
      : filter === "stagnant"
        ? products.filter((p) => p.isStagnant || p.isNearExpiration)
        : products;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 10,
          flexDirection: "row",
          gap: 8,
        }}
      >
        <FilterChip
          label="Todos"
          active={filter === "all"}
          count={products.length}
          onPress={() => setFilter("all")}
        />
        <FilterChip
          label="Stock bajo"
          active={filter === "low"}
          count={lowCount}
          accent={c.danger}
          onPress={() => setFilter("low")}
        />
        <FilterChip
          label="Estancados"
          active={filter === "stagnant"}
          count={stagnantCount}
          accent={c.warning}
          onPress={() => setFilter("stagnant")}
        />
      </View>

      <FlatList
        data={filteredList}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 120,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          products.length === 0 ? (
            <EmptyState
              icon="archivebox.fill"
              title="Inventario vacío"
              description="Crea tu primer producto en el catálogo para empezar a vender."
              action={{
                label: "Ir al catálogo",
                onPress: () => router.push("/catalog"),
              }}
            />
          ) : (
            <EmptyState
              icon="checkmark.circle.fill"
              title="Todo en orden"
              description="Ningún producto cae por debajo de su umbral mínimo."
            />
          )
        }
        ListFooterComponent={
          products.length > 0 ? (
            <HeroCard padding={18} style={{ marginTop: 14 }}>
              <Text
                style={{
                  fontSize: FontSize.xs,
                  fontWeight: "700",
                  color: Overlay.text,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                }}
              >
                Valor total del inventario
              </Text>
              <Text
                selectable
                style={{
                  fontSize: FontSize["3xl"],
                  fontWeight: "800",
                  color: Colors.light.surface,
                  letterSpacing: -0.8,
                  marginTop: 6,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatCurrency(totalInventory)}
              </Text>
              <Text
                style={{
                  fontSize: FontSize.sm,
                  color: Overlay.text,
                  marginTop: 4,
                }}
              >
                {products.length} producto{products.length !== 1 ? "s" : ""} en
                stock
              </Text>
            </HeroCard>
          ) : null
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 30).duration(280)}>
            <Pressable
              onPress={() => router.push(`/catalog/${item.id}`)}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <View
                style={{
                  flexDirection: "row",
                  backgroundColor: item.isLow ? c.lowStockBg : c.surface,
                  borderRadius: Radius.lg,
                  padding: 14,
                  gap: 12,
                  borderCurve: "continuous",
                  boxShadow: Shadows.sm,
                  borderLeftWidth: item.isLow ? 4 : 0,
                  borderLeftColor: c.danger,
                }}
              >
                <View style={{ flex: 1, gap: 6 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: FontSize.lg,
                        fontWeight: "700",
                        color: c.text,
                      }}
                    >
                      {item.name}
                    </Text>
                    {item.isLow ? (
                      <Badge label="Stock bajo" tone="danger" dot />
                    ) : null}
                    {item.isStagnant ? (
                      <Badge label="Estancado" tone="warning" dot />
                    ) : null}
                    {item.isNearExpiration ? (
                      <Badge label="Por vencer" tone="warning" dot />
                    ) : null}
                  </View>
                  {item.category ? (
                    <Badge label={item.category} tone="neutral" />
                  ) : null}
                  <View style={{ flexDirection: "row", gap: 14, marginTop: 4 }}>
                    <Text style={{ fontSize: FontSize.sm, color: c.textMuted }}>
                      Costo prom:{" "}
                      <Text
                        style={{
                          fontWeight: "600",
                          color: c.text,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {formatCurrency(item.averageCost ?? 0)}
                      </Text>
                    </Text>
                    <Text style={{ fontSize: FontSize.sm, color: c.textMuted }}>
                      Valor:{" "}
                      <Text
                        style={{
                          fontWeight: "600",
                          color: c.text,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {formatCurrency(item.value)}
                      </Text>
                    </Text>
                  </View>
                </View>
                <View
                  style={{
                    alignItems: "flex-end",
                    justifyContent: "center",
                    minWidth: 64,
                  }}
                >
                  <Text
                    style={{
                      fontSize: FontSize["2xl"],
                      fontWeight: "800",
                      color: item.isLow ? c.danger : c.text,
                      letterSpacing: -0.5,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {item.stock}
                  </Text>
                  <Text
                    style={{
                      fontSize: FontSize.xs,
                      color: c.tabIconDefault,
                      fontWeight: "600",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    {item.unitOfMeasure}
                  </Text>
                  {item.isLow ? (
                    <Text
                      style={{ fontSize: 10, color: c.danger, marginTop: 2 }}
                    >
                      min {item.threshold}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
          </Animated.View>
        )}
      />

      <Pressable
        onPress={() => router.push("/inventory/stock-entry")}
        style={({ pressed }) => ({
          position: "absolute",
          bottom: 24,
          right: 20,
          width: 60,
          height: 60,
          borderRadius: Radius.xl,
          backgroundColor: Colors.light.tint,
          alignItems: "center",
          justifyContent: "center",
          borderCurve: "continuous",
          boxShadow: Shadows.lg,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        })}
      >
        <IconSymbol name="plus" size={28} color={Colors.light.surface} />
      </Pressable>
    </View>
  );
}
