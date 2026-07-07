import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { type EntryWithProduct, listEntries } from '@/db/movements';

export default function EntryHistoryScreen() {
  const [entries, setEntries] = useState<EntryWithProduct[]>([]);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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
        setEntries(data.filter((e) => e.productName.toLowerCase().includes(lower)));
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
    <View className="flex-1 bg-gray-50 dark:bg-slate-950">
      <Stack.Screen options={{ title: 'Historial de entradas' }} />

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
        data={entries}
        keyExtractor={(e) => String(e.id)}
        contentContainerClassName="px-4 pb-8 gap-3"
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text variant="caption">No hay entradas registradas.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="rounded-xl bg-white dark:bg-slate-900 p-4 shadow-sm gap-1">
            <View className="flex-row items-start justify-between">
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
