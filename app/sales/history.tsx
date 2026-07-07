import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Snackbar } from '@/components/ui/snackbar';
import { Text } from '@/components/ui/text';
import {
  type SaleWithProduct,
  cancelSale,
  listSales,
  restoreSale,
  updateSale,
} from '@/db/sales';

const BADGE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  efectivo: { bg: 'bg-green-100', text: 'text-green-700', label: 'E' },
  transferencia: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'T' },
  costo: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'C' },
};

const PAYMENT_OPTIONS: readonly SelectOption[] = [
  { label: 'Efectivo', value: 'efectivo' },
  { label: 'Transferencia', value: 'transferencia' },
  { label: 'Costo', value: 'costo' },
];

export default function SalesHistoryScreen() {
  const [salesList, setSalesList] = useState<SaleWithProduct[]>([]);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const [editing, setEditing] = useState<SaleWithProduct | null>(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editPayment, setEditPayment] = useState('efectivo');

  const [snackbar, setSnackbar] = useState<{ message: string; saleId: number } | null>(null);

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
        setSalesList(data.filter((s) => s.productName.toLowerCase().includes(lower)));
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
    const quantity = parseFloat(editQuantity.replace(',', '.'));
    const appliedPrice = parseFloat(editPrice.replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      Alert.alert('Cantidad inválida', 'Ingresa una cantidad mayor que 0.');
      return;
    }
    if (!Number.isFinite(appliedPrice) || appliedPrice < 0) {
      Alert.alert('Precio inválido', 'Ingresa un precio válido.');
      return;
    }
    await updateSale(editing.id, { quantity, appliedPrice, paymentMethod: editPayment });
    setEditing(null);
    reload();
  }

  function confirmCancel(sale: SaleWithProduct) {
    Alert.alert(
      'Anular venta',
      `¿Anular la venta de ${sale.productName}? El stock se ajustará automáticamente.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Anular',
          style: 'destructive',
          onPress: async () => {
            await cancelSale(sale.id);
            reload();
            setSnackbar({ message: 'Venta anulada', saleId: sale.id });
          },
        },
      ],
    );
  }

  async function undoCancel(saleId: number) {
    await restoreSale(saleId);
    reload();
  }

  function openActions(sale: SaleWithProduct) {
    if (sale.cancelled) {
      Alert.alert('Venta anulada', `${sale.productName} · ${sale.date}`, [
        { text: 'Cerrar', style: 'cancel' },
        {
          text: 'Restaurar',
          onPress: async () => {
            await restoreSale(sale.id);
            reload();
          },
        },
      ]);
      return;
    }
    Alert.alert(sale.productName, `${sale.date} · $${(sale.quantity * sale.appliedPrice).toFixed(2)}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Editar', onPress: () => openEditor(sale) },
      { text: 'Anular', style: 'destructive', onPress: () => confirmCancel(sale) },
    ]);
  }

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
        <Pressable
          onPress={() => setShowCancelled((v) => !v)}
          className="flex-row items-center gap-2 self-start">
          <View
            className={`h-5 w-5 items-center justify-center rounded border ${
              showCancelled
                ? 'border-teal-700 bg-teal-700'
                : 'border-gray-400 dark:border-slate-600'
            }`}>
            {showCancelled ? <Text className="text-white text-xs font-bold">✓</Text> : null}
          </View>
          <Text variant="label">Mostrar anuladas</Text>
        </Pressable>
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
          const strike = item.cancelled ? 'line-through' : '';
          return (
            <Pressable
              onPress={() => openActions(item)}
              className={`rounded-xl bg-white dark:bg-slate-900 p-4 shadow-sm gap-1 active:opacity-70 ${
                item.cancelled ? 'opacity-60' : ''
              }`}>
              <View className="flex-row items-start justify-between">
                <View className="flex-1 flex-row items-center gap-2">
                  <Text variant="heading" className={strike}>
                    {item.productName}
                  </Text>
                  {item.cancelled ? (
                    <View className="rounded-full px-2 py-0.5 bg-gray-200 dark:bg-slate-700">
                      <Text variant="caption" className="text-gray-600 dark:text-slate-300">
                        ANULADA
                      </Text>
                    </View>
                  ) : (
                    <View className={`rounded-full px-2 py-0.5 ${badge.bg}`}>
                      <Text variant="caption" className={badge.text}>
                        {badge.label}
                      </Text>
                    </View>
                  )}
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
              <Text variant="body" className={strike}>
                {item.quantity} {item.unitOfMeasure} × ${item.appliedPrice} = $
                {(item.quantity * item.appliedPrice).toFixed(2)}
              </Text>
              <Text variant="caption">
                Utilidad: ${item.profit.toFixed(2)}
              </Text>
            </Pressable>
          );
        }}
      />

      <Modal
        visible={editing !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditing(null)}>
        <View className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-3xl bg-white dark:bg-slate-900 p-5 gap-4">
            <View className="flex-row items-center justify-between">
              <Text variant="title">Editar venta</Text>
              <Pressable hitSlop={8} onPress={() => setEditing(null)}>
                <Text variant="body" className="text-slate-500">Cerrar</Text>
              </Pressable>
            </View>
            {editing ? (
              <Text variant="caption">
                {editing.productName} · {editing.date}
              </Text>
            ) : null}
            <Input
              label={`Cantidad${editing ? ` (${editing.unitOfMeasure})` : ''}`}
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
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button variant="outline" label="Cancelar" onPress={() => setEditing(null)} />
              </View>
              <View className="flex-1">
                <Button label="Guardar" onPress={saveEdit} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Snackbar
        visible={snackbar !== null}
        message={snackbar?.message ?? ''}
        actionLabel="Deshacer"
        onAction={() => {
          if (snackbar) undoCancel(snackbar.saleId);
        }}
        onDismiss={() => setSnackbar(null)}
      />
    </View>
  );
}
