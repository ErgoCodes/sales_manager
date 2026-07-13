import { endOfMonth, format, startOfMonth } from "date-fns";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroCard } from "@/components/ui/hero-card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  cancelExpense,
  listExpenses,
  restoreExpense,
  sumExpenses,
} from "@/db/expenses";
import {
  cancelOutflow,
  listMovements,
  restoreOutflow,
  sumLossOutflowsValue,
} from "@/db/movements";
import { getTypeLabel } from "@/drizzle/constants/expenses";
import {
  Colors,
  FontSize,
  Overlay,
  Radius,
  Shadows,
} from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";
import { formatCurrency } from "@/lib/format";
import { safeWrite } from "@/lib/safe-write";

const OUTFLOW_FILTER = ["merma", "retiro_owner", "ajuste"];

const TONE_BY_TYPE: Record<string, BadgeTone> = {
  merma: "danger",
  retiro_owner: "warning",
  ajuste: "neutral",
  salario: "info",
  multa: "danger",
  onat: "cost",
  rebaja_liquidacion: "warning",
};

interface LedgerRow {
  key: string;
  id: number;
  date: string;
  title: string;
  typeValue: string;
  amount: number;
  detail: string;
  cancelled: boolean;
}

export default function ExpensesScreen() {
  const c = useAppColors();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [monthTotal, setMonthTotal] = useState(0);
  const [showCancelled, setShowCancelled] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    key: string;
    isExpense: boolean;
    id: number;
  } | null>(null);

  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const triggerRefetch = () => setRefreshTrigger((prev) => prev + 1);

  const showUndoToast = (
    key: string,
    isExpense: boolean,
    id: number,
    title: string
  ) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({
      visible: true,
      message: `Anulado: ${title}`,
      key,
      isExpense,
      id,
    });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 5000);
  };

  const handleCancel = async (
    key: string,
    isExpense: boolean,
    id: number,
    title: string
  ) => {
    const result = await safeWrite(async () => {
      if (isExpense) {
        await cancelExpense(id);
      } else {
        await cancelOutflow(id);
      }
    }, "Error al anular");

    if (result.ok) {
      triggerRefetch();
      showUndoToast(key, isExpense, id, title);
    }
  };

  const handleRestore = async (key: string, isExpense: boolean, id: number) => {
    const result = await safeWrite(async () => {
      if (isExpense) {
        await restoreExpense(id);
      } else {
        await restoreOutflow(id);
      }
    }, "Error al restaurar");

    if (result.ok) {
      triggerRefetch();
    }
  };

  const handleUndo = async () => {
    if (!toast) return;
    const { isExpense, id } = toast;

    const result = await safeWrite(async () => {
      if (isExpense) {
        await restoreExpense(id);
      } else {
        await restoreOutflow(id);
      }
    }, "Error al restaurar");

    if (result.ok) {
      setToast(null);
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      triggerRefetch();
    }
  };

  const handlePressRow = (item: LedgerRow) => {
    const isExpense = item.key.startsWith("exp-");
    if (item.cancelled) {
      Alert.alert("Registro anulado", "¿Deseas restaurar este registro?", [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Restaurar",
          onPress: () => handleRestore(item.key, isExpense, item.id),
        },
      ]);
    } else {
      Alert.alert("Opciones de registro", "Selecciona una acción:", [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Editar",
          onPress: () => {
            if (isExpense) {
              router.push(`/expenses/new?id=${item.id}`);
            } else {
              router.push(`/expenses/outflow?id=${item.id}`);
            }
          },
        },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => handleCancel(item.key, isExpense, item.id, item.title),
        },
      ]);
    }
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
        const monthEnd = format(endOfMonth(new Date()), "yyyy-MM-dd");

        const [expenses, movements, expSum, lossSum] = await Promise.all([
          listExpenses({ includeCancelled: showCancelled }),
          listMovements({
            types: OUTFLOW_FILTER,
            includeCancelled: showCancelled,
          }),
          sumExpenses(monthStart, monthEnd),
          sumLossOutflowsValue(monthStart, monthEnd),
        ]);
        if (!active) return;

        const expenseRows: LedgerRow[] = expenses.map((e) => ({
          key: `exp-${e.id}`,
          id: e.id,
          date: e.date,
          title: e.concept || getTypeLabel(e.type),
          typeValue: e.type,
          amount: e.amount,
          detail: getTypeLabel(e.type),
          cancelled: e.cancelled,
        }));

        const outflowRows: LedgerRow[] = movements.map((m) => {
          const isAdjustment = m.type === "ajuste";
          const signLabel = isAdjustment ? (m.quantity >= 0 ? "+" : "") : "-";
          return {
            key: `mov-${m.id}`,
            id: m.id,
            date: m.date,
            title: m.productName,
            typeValue: m.type,
            amount: Math.abs(m.quantity) * m.unitCostPrice,
            detail: `${getTypeLabel(m.type)} · ${signLabel}${Math.abs(m.quantity)} ${m.unitOfMeasure}`,
            cancelled: m.cancelled,
          };
        });

        const merged = [...expenseRows, ...outflowRows].sort((a, b) =>
          a.date < b.date ? 1 : a.date > b.date ? -1 : 0
        );

        setRows(merged);
        setMonthTotal(expSum + lossSum);
      })();
      return () => {
        active = false;
      };
    }, [showCancelled, refreshTrigger])
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 40,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 4 }}>
            <HeroCard padding={18}>
              <Text
                style={{
                  fontSize: FontSize.xs,
                  fontWeight: "700",
                  color: Overlay.text,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                }}
              >
                Pérdidas y gastos del mes
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
                {formatCurrency(monthTotal)}
              </Text>
              <Text
                style={{
                  fontSize: FontSize.sm,
                  color: Overlay.text,
                  marginTop: 4,
                }}
              >
                Gastos + mermas y retiros valorados
              </Text>
            </HeroCard>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <ActionButton
                label="Gasto"
                icon="dollarsign.circle.fill"
                accent={c.transfer}
                onPress={() => router.push("/expenses/new")}
              />
              <ActionButton
                label="Salida"
                icon="arrow.up.right"
                accent={c.danger}
                onPress={() => router.push("/expenses/outflow")}
              />
            </View>

            <Pressable
              onPress={() => setShowCancelled(!showCancelled)}
              accessibilityRole="button"
              accessibilityState={{ selected: showCancelled }}
              accessibilityLabel={showCancelled ? "Ocultar anulados" : "Mostrar anulados"}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                paddingVertical: 8,
                opacity: pressed ? 0.7 : 1,
                alignSelf: "flex-end",
                marginTop: 4,
              })}
            >
              <IconSymbol
                name={showCancelled ? "eye.fill" : "eye.slash.fill"}
                size={16}
                color={showCancelled ? c.tint : c.tabIconDefault}
              />
              <Text
                style={{
                  fontSize: FontSize.sm,
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
        }
        ListEmptyComponent={
          <EmptyState
            icon="dollarsign.circle.fill"
            title="Sin movimientos"
            description="Registra salarios, multas, ONAT o salidas de almacén (mermas y retiros) para ver su impacto aquí."
          />
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 25).duration(260)}>
            <Pressable
              onPress={() => handlePressRow(item)}
              accessibilityRole="button"
              accessibilityLabel={`Movimiento: ${item.title}, concepto ${item.detail || "sin concepto"}, monto ${item.amount} pesos`}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: c.surface,
                borderRadius: Radius.lg,
                padding: 14,
                gap: 12,
                borderCurve: "continuous",
                boxShadow: Shadows.sm,
                opacity: item.cancelled ? 0.5 : pressed ? 0.9 : 1,
              })}
            >
              <View style={{ flex: 1, gap: 6 }}>
                <Text
                  style={{
                    fontSize: FontSize.lg,
                    fontWeight: "700",
                    color: c.text,
                    textDecorationLine: item.cancelled
                      ? "line-through"
                      : "none",
                  }}
                >
                  {item.title}
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <Badge
                    label={getTypeLabel(item.typeValue)}
                    tone={TONE_BY_TYPE[item.typeValue] ?? "neutral"}
                  />
                  <Text
                    style={{ fontSize: FontSize.sm, color: c.tabIconDefault }}
                  >
                    {item.date}
                  </Text>
                </View>
              </View>
              <Text
                style={{
                  fontSize: FontSize.lg,
                  fontWeight: "800",
                  color: c.text,
                  letterSpacing: -0.4,
                  fontVariant: ["tabular-nums"],
                  textDecorationLine: item.cancelled ? "line-through" : "none",
                }}
              >
                {formatCurrency(item.amount)}
              </Text>
            </Pressable>
          </Animated.View>
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
            borderRadius: Radius.md,
            padding: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: Shadows.md,
            zIndex: 999,
          }}
        >
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: FontSize.base,
              fontWeight: "600",
            }}
          >
            {toast.message}
          </Text>
          <Pressable
            onPress={handleUndo}
            accessibilityRole="button"
            accessibilityLabel="Deshacer acción"
            style={({ pressed }) => ({
              backgroundColor: "#334155",
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: Radius.sm,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{
                color: c.tint,
                fontSize: FontSize.sm,
                fontWeight: "700",
              }}
            >
              Deshacer
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

interface ActionButtonProps {
  label: string;
  icon: Parameters<typeof IconSymbol>[0]["name"];
  accent: string;
  onPress: () => void;
}

function ActionButton({ label, icon, accent, onPress }: ActionButtonProps) {
  const c = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: c.surface,
        borderRadius: Radius.lg,
        paddingVertical: 14,
        borderCurve: "continuous",
        boxShadow: Shadows.sm,
        opacity: pressed ? 0.8 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 9,
          backgroundColor: `${accent}15`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconSymbol name={icon} size={17} color={accent} />
      </View>
      <Text
        style={{ fontSize: FontSize.base, fontWeight: "700", color: c.text }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
