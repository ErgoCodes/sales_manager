import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { type SaleWithProduct, listSales } from '@/db/sales';

const BADGE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  efectivo: { bg: 'bg-green-100', text: 'text-green-700', label: 'E' },
  transferencia: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'T' },
  costo: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'C' },
};

export default function SalesHistoryScreen() {
  const [salesList, setSalesList] = useState<SaleWithProduct[]>([]);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(() => {
    let active = true;
    (async () => {
      const data = await listSales({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      if (!active) return;
      if (search.trim()) {
        const lower = search.toLowerCase();
        setSalesList(data.filter((s) => s.productName.toLowerCase().includes(lower)));
      } else {
        setSalesList(data);
      }
    })();
    return () => {
      active = false;
    };
  }, [search, dateFrom, dateTo]);

  useFocusEffect(load);

  return (
    <View className="flex-1 bg-gray-50 dark:bg-slate-950">
      <Stack.Screen options={{ title: 'Historial de ventas' }} />

      <View className="p-4 gap-3">
        <Input
          placeholder="Filtrar por producto…"
          value={search}
          onChangeText={setSearch}
        />
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Input
              label="Desde"
              placeholder="YYYY-MM-DD"
              value={dateFrom}
              onChangeText={setDateFrom}
            />
          </View>
          <View className="flex-1">
            <Input
              label="Hasta"
              placeholder="YYYY-MM-DD"
              value={dateTo}
              onChangeText={setDateTo}
            />
          </View>
        </View>
      </View>

      <FlatList
        data={salesList}
        keyExtractor={(s) => String(s.id)}
        contentContainerClassName="px-4 pb-8 gap-3"
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text variant="caption">No hay ventas registradas.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const badge = BADGE_COLORS[item.paymentMethod] ?? BADGE_COLORS.efectivo;
          return (
            <View className="rounded-xl bg-white dark:bg-slate-900 p-4 shadow-sm gap-1">
              <View className="flex-row items-start justify-between">
                <View className="flex-1 flex-row items-center gap-2">
                  <Text variant="heading">{item.productName}</Text>
                  <View className={`rounded-full px-2 py-0.5 ${badge.bg}`}>
                    <Text variant="caption" className={badge.text}>
                      {badge.label}
                    </Text>
                  </View>
                  {item.discountPercent > 0 ? (
                    <View className="rounded-full px-2 py-0.5 bg-purple-100">
                      <Text variant="caption" className="text-purple-700">
                        -{Math.round(item.discountPercent)}%
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text variant="caption">{item.date}</Text>
              </View>
              <Text variant="body">
                {item.quantity} {item.unitOfMeasure} × ${item.appliedPrice} = $
                {(item.quantity * item.appliedPrice).toFixed(2)}
              </Text>
              <Text variant="caption">
                Utilidad: ${item.profit.toFixed(2)}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}
