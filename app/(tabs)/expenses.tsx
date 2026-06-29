import { endOfMonth, format, startOfMonth } from 'date-fns';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getTypeLabel } from '@/constants/expenses';
import { Colors, Semantic, Shadows } from '@/constants/theme';
import { listExpenses, sumExpenses } from '@/db/expenses';
import { listMovements, sumLossOutflowsValue } from '@/db/movements';

const OUTFLOW_FILTER = ['merma', 'retiro_owner', 'ajuste'];

const TONE_BY_TYPE: Record<string, BadgeTone> = {
  merma: 'danger',
  retiro_owner: 'warning',
  ajuste: 'neutral',
  salario: 'info',
  multa: 'danger',
  onat: 'cost',
};

interface LedgerRow {
  key: string;
  date: string;
  title: string;
  typeValue: string;
  amount: number;
  detail: string;
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString('es-CU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ExpensesScreen() {
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
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 40, gap: 10 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 4 }}>
            <View
              style={{
                backgroundColor: '#0F766E',
                borderRadius: 20,
                padding: 18,
                borderCurve: 'continuous',
                boxShadow: Shadows.hero,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  right: -30,
                  top: -30,
                  width: 120,
                  height: 120,
                  borderRadius: 60,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                }}
              />
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  color: 'rgba(255,255,255,0.75)',
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                Pérdidas y gastos del mes
              </Text>
              <Text
                selectable
                style={{
                  fontSize: 32,
                  fontWeight: '800',
                  color: '#FFFFFF',
                  letterSpacing: -0.8,
                  marginTop: 6,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {formatCurrency(monthTotal)}
              </Text>
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
                Gastos + mermas y retiros valorados
              </Text>
            </View>

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
                backgroundColor: '#FFFFFF',
                borderRadius: 18,
                padding: 14,
                gap: 12,
                borderCurve: 'continuous',
                boxShadow: Shadows.sm,
              }}
            >
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#0F172A' }}>{item.title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Badge label={getTypeLabel(item.typeValue)} tone={TONE_BY_TYPE[item.typeValue] ?? 'neutral'} />
                  <Text style={{ fontSize: 12, color: '#94A3B8' }}>{item.date}</Text>
                </View>
              </View>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '800',
                  color: '#0F172A',
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
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
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
      <Text style={{ fontSize: 14, fontWeight: '700', color: '#334155' }}>{label}</Text>
    </Pressable>
  );
}
