import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Modal, Pressable, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { Snackbar } from "@/components/ui/snackbar";
import { Text } from "@/components/ui/text";
import {
  type SaleWithProduct,
  cancelSale,
  listSales,
  restoreSale,
  updateSale,
} from "@/db/sales";
import { Radius, Shadows } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";

function getBadgeStyle(paymentMethod: string, c: any) {
  switch (paymentMethod) {
    case "transferencia":
      return { bg: c.transferSoft, text: c.transfer, label: "T" };
    case "costo":
      return { bg: c.costSoft, text: c.cost, label: "C" };
    case "efectivo":
    default:
      return { bg: c.cashSoft, text: c.cash, label: "E" };
  }
}

const PAYMENT_OPTIONS: readonly SelectOption[] = [
  { label: "Efectivo", value: "efectivo" },
  { label: "Transferencia", value: "transferencia" },
  { label: "Costo", value: "costo" },
];

export default function SalesHistoryScreen() {
  const c = useAppColors();
  const [salesList, setSalesList] = useState<SaleWithProduct[]>([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const [editing, setEditing] = useState<SaleWithProduct | null>(null);
  const [editQuantity, setEditQuantity] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editPayment, setEditPayment] = useState("efectivo");

  const [snackbar, setSnackbar] = useState<{
    message: string;
    saleId: number;
  } | null>(null);

  const reload = () => setReloadToken((t) => t + 1);

  const load = useCallback(() => {
    let active = true;
    (async () => {
      const data = await listSales({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        includeCancelled: showCancelled,
      });
      if (!active) return;
      if (search.trim()) {
        const lower = search.toLowerCase();
        setSalesList(
          data.filter((s) => s.productName.toLowerCase().includes(lower))
        );
      } else {
        setSalesList(data);
      }
    })();
    return () => {
      active = false;
    };
    // reloadToken is intentional: bumping it re-subscribes useFocusEffect to refresh after edits/cancellations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, dateFrom, dateTo, showCancelled, reloadToken]);

  useFocusEffect(load);

  function openEditor(sale: SaleWithProduct) {
    setEditing(sale);
    setEditQuantity(String(sale.quantity));
    setEditPrice(String(sale.appliedPrice));
    setEditPayment(sale.paymentMethod);
  }

  async function saveEdit() {
    if (!editing) return;
    const quantity = parseFloat(editQuantity.replace(",", "."));
    const appliedPrice = parseFloat(editPrice.replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      Alert.alert("Cantidad inválida", "Ingresa una cantidad mayor que 0.");
      return;
    }
    if (!Number.isFinite(appliedPrice) || appliedPrice < 0) {
      Alert.alert("Precio inválido", "Ingresa un precio válido.");
      return;
    }
    await updateSale(editing.id, {
      quantity,
      appliedPrice,
      paymentMethod: editPayment,
    });
    setEditing(null);
    reload();
  }

  function confirmCancel(sale: SaleWithProduct) {
    Alert.alert(
      "Anular venta",
      `¿Anular la venta de ${sale.productName}? El stock se ajustará automáticamente.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Anular",
          style: "destructive",
          onPress: async () => {
            await cancelSale(sale.id);
            reload();
            setSnackbar({ message: "Venta anulada", saleId: sale.id });
          },
        },
      ]
    );
  }

  async function undoCancel(saleId: number) {
    await restoreSale(saleId);
    reload();
  }

  // El recibido/vuelto es un dato de la sesión (transacción del cliente), pero
  // el historial lista una fila por producto. Para no repetirlo en cada línea
  // de la misma sesión, marcamos como "ancla" solo la primera fila de cada
  // sessionId en el orden de la lista; únicamente ahí se muestra el vuelto.
  const sessionAnchors = new Set<number>();
  const seenSessions = new Set<number>();
  for (const s of salesList) {
    if (
      s.sessionId != null &&
      s.amountReceived != null &&
      !seenSessions.has(s.sessionId)
    ) {
      seenSessions.add(s.sessionId);
      sessionAnchors.add(s.id);
    }
  }

  function openActions(sale: SaleWithProduct) {
    if (sale.cancelled) {
      Alert.alert("Venta anulada", `${sale.productName} · ${sale.date}`, [
        { text: "Cerrar", style: "cancel" },
        {
          text: "Restaurar",
          onPress: async () => {
            await restoreSale(sale.id);
            reload();
          },
        },
      ]);
      return;
    }
    const cashInfo =
      sale.amountReceived != null && sale.change != null
        ? `\nRecibido: $${sale.amountReceived.toFixed(2)} · Vuelto: $${sale.change.toFixed(2)}`
        : "";
    Alert.alert(
      sale.productName,
      `${sale.date} · $${(sale.quantity * sale.appliedPrice).toFixed(2)}${cashInfo}`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Editar", onPress: () => openEditor(sale) },
        {
          text: "Anular",
          style: "destructive",
          onPress: () => confirmCancel(sale),
        },
      ]
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: "Historial de ventas" }} />

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
          onPress={() => setShowCancelled((v) => !v)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            alignSelf: "flex-start",
          }}
        >
          <View
            style={{
              height: 20,
              width: 20,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
              borderWidth: 1,
              borderColor: showCancelled ? "#0F766E" : c.border,
              backgroundColor: showCancelled ? "#0F766E" : "transparent",
            }}
          >
            {showCancelled ? (
              <Text
                style={{ color: "white", fontSize: 12, fontWeight: "bold" }}
              >
                ✓
              </Text>
            ) : null}
          </View>
          <Text variant="label">Mostrar anuladas</Text>
        </Pressable>
      </View>

      <FlatList
        data={salesList}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 32,
          gap: 12,
        }}
        ListEmptyComponent={
          <View style={{ alignItems: "center", paddingVertical: 48 }}>
            <Text variant="caption">No hay ventas registradas.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const badge = getBadgeStyle(item.paymentMethod, c);
          return (
            <Pressable
              onPress={() => openActions(item)}
              style={({ pressed }) => ({
                borderRadius: Radius.xl,
                backgroundColor: c.surface,
                padding: 16,
                boxShadow: Shadows.sm,
                gap: 4,
                opacity: (pressed ? 0.7 : 1) * (item.cancelled ? 0.6 : 1),
              })}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                }}
              >
                <View
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Text
                    variant="heading"
                    style={
                      item.cancelled
                        ? { textDecorationLine: "line-through" }
                        : {}
                    }
                  >
                    {item.productName}
                  </Text>
                  {item.cancelled ? (
                    <View
                      style={{
                        borderRadius: Radius.full,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        backgroundColor: c.surfaceMuted,
                      }}
                    >
                      <Text variant="caption" style={{ color: c.textMuted }}>
                        ANULADA
                      </Text>
                    </View>
                  ) : (
                    <View
                      style={{
                        borderRadius: Radius.full,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        backgroundColor: badge.bg,
                      }}
                    >
                      <Text variant="caption" style={{ color: badge.text }}>
                        {badge.label}
                      </Text>
                    </View>
                  )}
                  {item.discountPercent > 0 ? (
                    <View
                      style={{
                        borderRadius: Radius.full,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        backgroundColor: "#F3E8FF",
                      }}
                    >
                      <Text variant="caption" style={{ color: "#7E22CE" }}>
                        -{Math.round(item.discountPercent)}%
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text variant="caption">{item.date}</Text>
              </View>
              <Text
                variant="body"
                style={
                  item.cancelled ? { textDecorationLine: "line-through" } : {}
                }
              >
                {item.quantity} {item.unitOfMeasure} × ${item.appliedPrice} = $
                {(item.quantity * item.appliedPrice).toFixed(2)}
              </Text>
              <Text variant="caption">Utilidad: ${item.profit.toFixed(2)}</Text>
              {sessionAnchors.has(item.id) &&
              item.amountReceived != null &&
              item.change != null ? (
                <Text variant="caption" style={{ color: c.cash }}>
                  💵 Recibido ${item.amountReceived.toFixed(2)} · Vuelto $
                  {item.change.toFixed(2)}
                </Text>
              ) : null}
            </Pressable>
          );
        }}
      />

      <Modal
        visible={editing !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        <KeyboardAvoidingView
          behavior="padding"
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "rgba(0,0,0,0.4)",
          }}
        >
          <View
            style={{
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              backgroundColor: c.surface,
              padding: 20,
              gap: 16,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text variant="title">Editar venta</Text>
              <Pressable hitSlop={8} onPress={() => setEditing(null)}>
                <Text variant="body" style={{ color: c.textMuted }}>
                  Cerrar
                </Text>
              </Pressable>
            </View>
            {editing ? (
              <Text variant="caption">
                {editing.productName} · {editing.date}
              </Text>
            ) : null}
            <Input
              label={`Cantidad${editing ? ` (${editing.unitOfMeasure})` : ""}`}
              keyboardType="decimal-pad"
              value={editQuantity}
              onChangeText={setEditQuantity}
            />
            <Input
              label="Precio aplicado"
              keyboardType="decimal-pad"
              value={editPrice}
              onChangeText={setEditPrice}
            />
            <Select
              label="Método de pago"
              options={PAYMENT_OPTIONS}
              value={editPayment}
              onChange={setEditPayment}
            />
            <Text variant="caption">
              ¿Cambiar de producto? Anula esta venta y regístrala de nuevo.
            </Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Button
                  variant="outline"
                  label="Cancelar"
                  onPress={() => setEditing(null)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Guardar" onPress={saveEdit} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Snackbar
        visible={snackbar !== null}
        message={snackbar?.message ?? ""}
        actionLabel="Deshacer"
        onAction={() => {
          if (snackbar) undoCancel(snackbar.saleId);
        }}
        onDismiss={() => setSnackbar(null)}
      />
    </View>
  );
}
