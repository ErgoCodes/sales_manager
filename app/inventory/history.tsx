import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, View } from "react-native";

import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { type EntryWithProduct, listEntries } from "@/db/movements";
import { Radius, Shadows } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";

export default function EntryHistoryScreen() {
  const c = useAppColors();
  const [entries, setEntries] = useState<EntryWithProduct[]>([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(() => {
    let active = true;
    (async () => {
      const data = await listEntries({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      if (!active) return;
      if (search.trim()) {
        const lower = search.toLowerCase();
        setEntries(
          data.filter((e) => e.productName.toLowerCase().includes(lower))
        );
      } else {
        setEntries(data);
      }
    })();
    return () => {
      active = false;
    };
  }, [search, dateFrom, dateTo]);

  useFocusEffect(load);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: "Historial de entradas" }} />

      <View style={{ padding: 16, gap: 12 }}>
        <Input
          placeholder="Filtrar por producto…"
          value={search}
          onChangeText={setSearch}
        />
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <DatePicker
              label="Desde"
              value={dateFrom}
              onChange={setDateFrom}
              placeholder="Desde"
              clearable
            />
          </View>
          <View style={{ flex: 1 }}>
            <DatePicker
              label="Hasta"
              value={dateTo}
              onChange={setDateTo}
              placeholder="Hasta"
              clearable
            />
          </View>
        </View>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 32,
          gap: 12,
        }}
        ListEmptyComponent={
          <View style={{ alignItems: "center", paddingVertical: 48 }}>
            <Text variant="caption">No hay entradas registradas.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={{
              borderRadius: Radius.xl,
              backgroundColor: c.surface,
              padding: 16,
              boxShadow: Shadows.sm,
              gap: 4,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                justifyContent: "space-between",
              }}
            >
              <Text variant="heading">{item.productName}</Text>
              <Text variant="caption">{item.date}</Text>
            </View>
            <Text variant="body">
              {item.quantity} {item.unitOfMeasure} × ${item.unitCostPrice}
            </Text>
            {item.notes ? <Text variant="caption">{item.notes}</Text> : null}
          </View>
        )}
      />
    </View>
  );
}
