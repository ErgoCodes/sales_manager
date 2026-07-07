import { endOfMonth, format, startOfMonth } from 'date-fns';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { HeroCard } from '@/components/ui/hero-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getTypeLabel } from '@/constants/expenses';
import { Colors, FontSize, Overlay, Radius, Semantic, Shadows } from '@/constants/theme';
import { listExpenses, sumExpenses } from '@/db/expenses';
import { listMovements, sumLossOutflowsValue } from '@/db/movements';
import { useAppColors } from '@/hooks/use-app-colors';
import { formatCurrency } from '@/lib/format';

const OUTFLOW_FILTER = ['merma', 'retiro_owner', 'ajuste'];

const TONE_BY_TYPE: Record<string, BadgeTone> = {
  merma: 'danger',
  retiro_owner: 'warning',
  ajuste: 'neutral',
  salario: 'info',
  multa: 'danger',
  onat: 'cost',
  rebaja_liquidacion: 'warning',
};

interface LedgerRow {
  key: string;
  date: string;
  title: string;
  typeValue: string;
  amount: number;
  detail: string;
}

export default function ExpensesScreen() {
  const c = useAppColors();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [monthTotal, setMonthTotal] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
        const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd');

        const [expenses, movements, expSum, lossSum] = await Promise.all([
          listExpenses(),
          listMovements({ types: OUTFLOW_FILTER }),
          sumExpenses(monthStart, monthEnd),
          sumLossOutflowsValue(monthStart, monthEnd),
        ]);
        if (!active) return;

        const expenseRows: LedgerRow[] = expenses.map((e) => ({
          key: `exp-${e.id}`,
          date: e.date,
          title: e.concept || getTypeLabel(e.type),
          typeValue: e.type,
          amount: e.amount,
          detail: getTypeLabel(e.type),
        }));

        const outflowRows: LedgerRow[] = movements.map((m) => {
          const isAdjustment = m.type === 'ajuste';
          const signLabel = isAdjustment ? (m.quantity >= 0 ? '+' : '') : '-';
          return {
            key: `mov-${m.id}`,
            date: m.date,
            title: m.productName,
            typeValue: m.type,
            amount: Math.abs(m.quantity) * m.unitCostPrice,
            detail: `${getTypeLabel(m.type)} · ${signLabel}${Math.abs(m.quantity)} ${m.unitOfMeasure}`,
          };
        });

        const merged = [...expenseRows, ...outflowRows].sort((a, b) =>
          a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
        );

        setRows(merged);
        setMonthTotal(expSum + lossSum);
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 40, gap: 10 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 4 }}>
            <HeroCard padding={18}>
              <Text
                style={{
                  fontSize: FontSize.xs,
                  fontWeight: '700',
                  color: Overlay.text,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                Pérdidas y gastos del mes
              </Text>
              <Text
                selectable
                style={{
                  fontSize: FontSize['3xl'],
                  fontWeight: '800',
                  color: Colors.light.surface,
                  letterSpacing: -0.8,
                  marginTop: 6,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {formatCurrency(monthTotal)}
              </Text>
              <Text style={{ fontSize: FontSize.sm, color: Overlay.text, marginTop: 4 }}>
                Gastos + mermas y retiros valorados
              </Text>
            </HeroCard>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <ActionButton
                label="Gasto"
                icon="dollarsign.circle.fill"
                accent={Semantic.transfer}
                onPress={() => router.push('/expenses/new')}
              />
              <ActionButton
                label="Salida"
                icon="arrow.up.right"
                accent={Semantic.danger}
                onPress={() => router.push('/expenses/outflow')}
              />
            </View>
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
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: c.surface,
                borderRadius: Radius.lg,
                padding: 14,
                gap: 12,
                borderCurve: 'continuous',
                boxShadow: Shadows.sm,
              }}
            >
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={{ fontSize: FontSize.lg, fontWeight: '700', color: c.text }}>{item.title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Badge label={getTypeLabel(item.typeValue)} tone={TONE_BY_TYPE[item.typeValue] ?? 'neutral'} />
                  <Text style={{ fontSize: FontSize.sm, color: c.tabIconDefault }}>{item.date}</Text>
                </View>
              </View>
              <Text
                style={{
                  fontSize: FontSize.lg,
                  fontWeight: '800',
                  color: c.text,
                  letterSpacing: -0.4,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {formatCurrency(item.amount)}
              </Text>
            </View>
          </Animated.View>
        )}
      />
    </View>
  );
}

interface ActionButtonProps {
  label: string;
  icon: Parameters<typeof IconSymbol>[0]['name'];
  accent: string;
  onPress: () => void;
}

function ActionButton({ label, icon, accent, onPress }: ActionButtonProps) {
  const c = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: c.surface,
        borderRadius: Radius.lg,
        paddingVertical: 14,
        borderCurve: 'continuous',
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
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <IconSymbol name={icon} size={17} color={accent} />
      </View>
      <Text style={{ fontSize: FontSize.base, fontWeight: '700', color: c.text }}>{label}</Text>
    </Pressable>
  );
}
