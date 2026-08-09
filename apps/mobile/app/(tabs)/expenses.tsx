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
import { useAppColors } from "@/hooks/use-app-colors";
import { formatCurrency } from "@/lib/format";
import { safeWrite } from "@/lib/safe-write";

const OUTFLOW_FILTER = ["merma", "retiro_owner"];

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
          listExpenses({ dateFrom: monthStart, dateTo: monthEnd, includeCancelled: showCancelled }),
          listMovements({
            types: OUTFLOW_FILTER,
            dateFrom: monthStart,
            dateTo: monthEnd,
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
    <View className="flex-1 bg-background">
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerClassName="px-4 pt-3.5 pb-10 gap-2.5"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View className="gap-3.5 mb-1">
            <HeroCard padding={18}>
              <Text className="text-[13px] font-bold text-white/75 tracking-[1px] uppercase">
                Pérdidas y gastos del mes
              </Text>
              <Text
                selectable
                style={{ fontVariant: ["tabular-nums"] }}
                className="text-[30px] font-extrabold text-white tracking-[-0.8px] mt-1.5"
              >
                {formatCurrency(monthTotal)}
              </Text>
              <Text className="text-[14px] text-white/75 mt-1">
                Gastos + mermas y retiros valorados
              </Text>
            </HeroCard>

            <View className="flex-row gap-2.5">
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
              className="flex-row items-center justify-center gap-1.5 py-2 self-end mt-1 active:opacity-70"
            >
              <IconSymbol
                name={showCancelled ? "eye.fill" : "eye.slash.fill"}
                size={16}
                color={showCancelled ? c.tint : c.tabIconDefault}
              />
              <Text
                className={
                  showCancelled
                    ? "text-[14px] font-semibold text-primary"
                    : "text-[14px] font-semibold text-tab-default"
                }
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
              className={`flex-row items-center bg-surface rounded-2xl p-3.5 gap-3 shadow-sm active:opacity-90 ${item.cancelled ? "opacity-50" : ""}`}
            >
              <View className="flex-1 gap-1.5">
                <Text
                  className={`text-[18px] font-bold text-text-strong ${item.cancelled ? "line-through" : ""}`}
                >
                  {item.title}
                </Text>
                <View className="flex-row items-center gap-2 flex-wrap">
                  <Badge
                    label={getTypeLabel(item.typeValue)}
                    tone={TONE_BY_TYPE[item.typeValue] ?? "neutral"}
                  />
                  <Text className="text-[14px] text-tab-default">
                    {item.date}
                  </Text>
                </View>
              </View>
              <Text
                style={{ fontVariant: ["tabular-nums"] }}
                className={`text-[18px] font-extrabold text-text-strong tracking-[-0.4px] ${item.cancelled ? "line-through" : ""}`}
              >
                {formatCurrency(item.amount)}
              </Text>
            </Pressable>
          </Animated.View>
        )}
      />

      {toast?.visible && (
        <View className="absolute bottom-6 left-4 right-4 bg-slate-800 rounded-xl p-3.5 flex-row items-center justify-between shadow-md z-50">
          <Text className="text-white text-[16px] font-semibold">
            {toast.message}
          </Text>
          <Pressable
            onPress={handleUndo}
            accessibilityRole="button"
            accessibilityLabel="Deshacer acción"
            className="bg-slate-700 py-1.5 px-3 rounded-lg active:opacity-70"
          >
            <Text className="text-primary text-[14px] font-bold">
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-1 flex-row items-center justify-center gap-2 bg-surface rounded-2xl py-3.5 shadow-sm active:opacity-80 active:scale-[0.98]"
    >
      <View
        className="w-7 h-7 rounded-[9px] items-center justify-center"
        style={{ backgroundColor: `${accent}15` }}
      >
        <IconSymbol name={icon} size={17} color={accent} />
      </View>
      <Text className="text-[16px] font-bold text-text-strong">
        {label}
      </Text>
    </Pressable>
  );
}
