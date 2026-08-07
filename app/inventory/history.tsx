import { Stack, router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, FlatList, Pressable, View } from "react-native";

import { DatePicker } from "@/components/ui/date-picker";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import {
  type EntryWithProduct,
  cancelEntry,
  listEntries,
  restoreEntry,
} from "@/db/movements";
import { Radius, Shadows } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";
import { safeWrite } from "@/lib/safe-write";

export default function EntryHistoryScreen() {
  const c = useAppColors();
  const [entries, setEntries] = useState<EntryWithProduct[]>([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    id: number;
  } | null>(null);

  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const triggerRefetch = () => setRefreshTrigger((prev) => prev + 1);

  const showUndoToast = (id: number, productName: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({
      visible: true,
      message: `Anulado: Entrada de ${productName}`,
      id,
    });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 5000);
  };

  const handleCancel = async (id: number, productName: string) => {
    const result = await safeWrite(async () => {
      await cancelEntry(id);
    }, "Error al anular");

    if (result.ok) {
      triggerRefetch();
      showUndoToast(id, productName);
    }
  };

  const handleRestore = async (id: number) => {
    const result = await safeWrite(async () => {
      await restoreEntry(id);
    }, "Error al restaurar");

    if (result.ok) {
      triggerRefetch();
    }
  };

  const handleUndo = async () => {
    if (!toast) return;
    const { id } = toast;

    const result = await safeWrite(async () => {
      await restoreEntry(id);
    }, "Error al restaurar");

    if (result.ok) {
      setToast(null);
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      triggerRefetch();
    }
  };

  const handlePressRow = (item: EntryWithProduct) => {
    if (item.cancelled) {
      Alert.alert("Entrada anulada", "¿Deseas restaurar esta entrada?", [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Restaurar",
          onPress: () => handleRestore(item.id),
        },
      ]);
    } else {
      Alert.alert("Opciones de entrada", "Selecciona una acción:", [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Editar",
          onPress: () => {
            router.push(`/inventory/stock-entry?id=${item.id}`);
          },
        },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => handleCancel(item.id, item.productName),
        },
      ]);
    }
  };

  const load = useCallback(() => {
    void refreshTrigger;
    let active = true;
    (async () => {
      const data = await listEntries({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        includeCancelled: showCancelled,
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
  }, [search, dateFrom, dateTo, showCancelled, refreshTrigger]);

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

        <Pressable
          onPress={() => setShowCancelled(!showCancelled)}
          accessibilityRole="button"
          accessibilityState={{ selected: showCancelled }}
          accessibilityLabel={showCancelled ? "Ocultar anulados" : "Mostrar anulados"}
          style={{
            flexDirection: "row",
            alignItems: "center",
            alignSelf: "flex-end",
            gap: 6,
            paddingVertical: 4,
          }}
        >
          <IconSymbol
            name={showCancelled ? "eye.fill" : "eye.slash.fill"}
            size={16}
            color={showCancelled ? c.tint : c.tabIconDefault}
          />
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: showCancelled ? c.tint : c.tabIconDefault,
            }}
          >
            {showCancelled
              ? "Mostrar anulados: Sí"
              : "Mostrar anulados: No"}
          </Text>
        </Pressable>
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
          <Pressable
            onPress={() => handlePressRow(item)}
            accessibilityRole="button"
            accessibilityLabel={`Entrada de ${item.productName}, ${item.quantity} ${item.unitOfMeasure}`}
            style={({ pressed }) => ({
              borderRadius: Radius.xl,
              backgroundColor: c.surface,
              padding: 16,
              boxShadow: Shadows.sm,
              gap: 4,
              opacity: item.cancelled ? 0.5 : pressed ? 0.85 : 1,
            })}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                justifyContent: "space-between",
              }}
            >
              <Text
                variant="heading"
                style={{
                  textDecorationLine: item.cancelled ? "line-through" : "none",
                }}
              >
                {item.productName}
              </Text>
              <Text variant="caption">{item.date}</Text>
            </View>
            <Text
              variant="body"
              style={{
                textDecorationLine: item.cancelled ? "line-through" : "none",
              }}
            >
              {item.quantity} {item.unitOfMeasure} × ${item.unitCostPrice}
            </Text>
            {item.notes ? <Text variant="caption">{item.notes}</Text> : null}
          </Pressable>
        )}
      />

      {toast?.visible && (
        <View
          style={{
            position: "absolute",
            bottom: 24,
            left: 16,
            right: 16,
            backgroundColor: "#1E293B",
            borderRadius: Radius.xl,
            padding: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: Shadows.md,
            zIndex: 50,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "600" }}>
            {toast.message}
          </Text>
          <Pressable
            onPress={handleUndo}
            accessibilityRole="button"
            accessibilityLabel="Deshacer acción"
            style={{
              backgroundColor: "#334155",
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: Radius.md,
            }}
          >
            <Text style={{ color: c.tint, fontSize: 14, fontWeight: "700" }}>
              Deshacer
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

