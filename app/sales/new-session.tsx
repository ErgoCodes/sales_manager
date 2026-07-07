import { Stack, router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ProductPicker,
  type SelectedProduct,
} from '@/components/ui/product-picker';
import { Text } from '@/components/ui/text';
import { registerSalesSession, verifySessionStock } from '@/db/sales';
import { useCartStore } from '@/store';

export default function NewSessionScreen() {
  const items = useCartStore((s) => s.items);
  const date = useCartStore((s) => s.date);
  const addItem = useCartStore((s) => s.addItem);
  const removeItem = useCartStore((s) => s.removeItem);
  const setDate = useCartStore((s) => s.setDate);
  const clear = useCartStore((s) => s.clear);
  const totalCash = useCartStore((s) => s.totalCash);
  const totalTransfer = useCartStore((s) => s.totalTransfer);
  const totalCost = useCartStore((s) => s.totalCost);
  const grandTotal = useCartStore((s) => s.grandTotal);

  const [product, setProduct] = useState<SelectedProduct | null>(null);
  const [quantity, setQuantity] = useState('');
  const [workerSale, setWorkerSale] = useState(false);
  const [discountExpanded, setDiscountExpanded] = useState(false);
  const [discountPercent, setDiscountPercent] = useState('');
  const [saving, setSaving] = useState(false);

  const quantityRef = useRef<TextInput>(null);
  const discountPercentNum = discountPercent === '' ? 0 : Number(discountPercent);

  function handleDiscountChange(text: string) {
    const cleaned = text.replace(/[^0-9]/g, '');
    if (cleaned === '') {
      setDiscountPercent('');
      return;
    }
    setDiscountPercent(String(Math.min(100, Number(cleaned))));
  }

  function onProductSelected(p: SelectedProduct) {
    setProduct(p);
    setQuantity('1');
    setWorkerSale(false);
    setDiscountExpanded(false);
    setDiscountPercent('');
    setTimeout(() => quantityRef.current?.focus(), 100);
  }

  function addToCart(paymentMethod: 'efectivo' | 'transferencia' | 'costo') {
    if (!product) return;
    const qty = Number(quantity);
    if (!qty || qty <= 0) return;

    const effectiveDiscount = paymentMethod === 'costo' ? 0 : discountPercentNum;

    let appliedPrice: number;
    let profit: number;
    if (paymentMethod === 'costo') {
      appliedPrice = product.costPrice ?? product.averageCost;
      profit = 0;
    } else {
      const basePrice =
        paymentMethod === 'efectivo'
          ? (product.cashPrice ?? 0)
          : (product.transferPrice ?? 0);
      appliedPrice = basePrice * (1 - effectiveDiscount / 100);
      profit = (appliedPrice - product.averageCost) * qty;
    }

    addItem({
      productId: product.id,
      name: product.name,
      unitOfMeasure: product.unitOfMeasure,
      quantity: qty,
      paymentMethod,
      appliedPrice,
      discountPercent: effectiveDiscount,
      costAtSale: product.averageCost,
      profit,
    });

    setProduct(null);
    setQuantity('');
    setWorkerSale(false);
    setDiscountExpanded(false);
    setDiscountPercent('');
  }

  async function saveSession() {
    if (items.length === 0) return;
    setSaving(true);

    try {
      const warnings = await verifySessionStock(items);
      if (warnings.length > 0) {
        const message = warnings
          .map(
            (w) =>
              `${w.name}: stock ${w.currentStock}, vendiendo ${w.quantityToSell} → quedaría ${w.resultingStock}`,
          )
          .join('\n');

        const shouldContinue = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Stock insuficiente',
            `Los siguientes productos quedarían con stock negativo:\n\n${message}\n\n¿Desea continuar de todas formas?`,
            [
              { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Guardar igual', onPress: () => resolve(true) },
            ],
          );
        });
        if (!shouldContinue) {
          setSaving(false);
          return;
        }
      }

      registerSalesSession(items, date);
      clear();
      router.back();
    } catch {
      Alert.alert('Error', 'No se pudo guardar la sesión.');
    } finally {
      setSaving(false);
    }
  }

  const formatAmount = (n: number) => n.toFixed(2);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-gray-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: 'Nueva sesión' }} />

      <View className="px-4 pt-3 gap-3 z-10">
        <Input
          label="Fecha de la sesión"
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
        />

        <ProductPicker
          label="Buscar producto"
          value={product}
          onChange={onProductSelected}
        />

        {product ? (
          <View className="rounded-xl bg-white p-3 shadow-sm gap-2">
            <View className="flex-row justify-between items-center">
              <Text variant="heading">{product.name}</Text>
              <Pressable
                onPress={() => {
                  setProduct(null);
                  setQuantity('');
                  setWorkerSale(false);
                  setDiscountExpanded(false);
                  setDiscountPercent('');
                }}
                hitSlop={12}
              >
                <Text variant="body" className="text-gray-400">
                  ✕
                </Text>
              </Pressable>
            </View>
            <Text variant="caption">
              Efectivo: ${product.cashPrice ?? '—'} · Transferencia: $
              {product.transferPrice ?? '—'} · Costo prom: $
              {product.averageCost.toFixed(2)}
            </Text>

            <View className="gap-1">
              <Text className="text-sm font-medium text-gray-700">
                Cantidad ({product.unitOfMeasure})
              </Text>
              <TextInput
                ref={quantityRef}
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-base text-gray-900 bg-white"
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="numeric"
                placeholder="1"
                selectTextOnFocus
                placeholderTextColor="#9ca3af"
              />
            </View>

            <Pressable
              onPress={() => {
                setWorkerSale((v) => {
                  const next = !v;
                  if (next) {
                    setDiscountExpanded(false);
                    setDiscountPercent('');
                  }
                  return next;
                });
              }}
              hitSlop={8}
              className="flex-row items-center gap-2"
            >
              <Text variant="label" className={workerSale ? 'text-orange-600' : 'text-gray-500'}>
                {workerSale ? '☑' : '☐'} Venta a trabajador (costo)
              </Text>
            </Pressable>

            {!workerSale ? (
              <Pressable
                onPress={() => setDiscountExpanded((v) => !v)}
                hitSlop={8}
                className="flex-row items-center gap-2"
              >
                <Text
                  variant="label"
                  className={discountExpanded ? 'text-purple-600' : 'text-gray-500'}
                >
                  {discountExpanded ? '☑' : '☐'} Descuento
                </Text>
              </Pressable>
            ) : null}

            {!workerSale && discountExpanded ? (
              <Input
                label="% descuento"
                value={discountPercent}
                onChangeText={handleDiscountChange}
                keyboardType="numeric"
                placeholder="0"
              />
            ) : null}

            {workerSale ? (
              <Pressable
                className="rounded-lg bg-orange-500 py-3 items-center active:bg-orange-600"
                onPress={() => addToCart('costo')}
              >
                <Text className="text-white font-semibold text-sm">
                  A costo ${product.costPrice ?? product.averageCost.toFixed(2)}
                </Text>
              </Pressable>
            ) : (
              <View className="flex-row gap-3">
                <Pressable
                  className="flex-1 rounded-lg bg-green-600 py-3 items-center active:bg-green-700"
                  onPress={() => addToCart('efectivo')}
                >
                  <Text className="text-white font-semibold text-sm">
                    Efectivo $
                    {discountPercentNum > 0
                      ? ((product.cashPrice ?? 0) * (1 - discountPercentNum / 100)).toFixed(2)
                      : (product.cashPrice ?? 0)}
                  </Text>
                </Pressable>
                <Pressable
                  className="flex-1 rounded-lg bg-blue-600 py-3 items-center active:bg-blue-700"
                  onPress={() => addToCart('transferencia')}
                >
                  <Text className="text-white font-semibold text-sm">
                    Transfer $
                    {discountPercentNum > 0
                      ? ((product.transferPrice ?? 0) * (1 - discountPercentNum / 100)).toFixed(2)
                      : (product.transferPrice ?? 0)}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        className="flex-1"
        contentContainerClassName="px-4 py-3 gap-2"
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text variant="caption">
              Selecciona un producto para comenzar
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="flex-row items-center rounded-xl bg-white px-4 py-3 shadow-sm">
            <View className="flex-1 gap-0.5">
              <Text variant="body">{item.name}</Text>
              <Text variant="caption">
                {item.quantity} {item.unitOfMeasure} × ${item.appliedPrice} = $
                {formatAmount(item.quantity * item.appliedPrice)}
              </Text>
            </View>
            {item.discountPercent > 0 ? (
              <View className="rounded-full px-2 py-0.5 mr-2 bg-purple-100">
                <Text variant="caption" className="text-purple-700">
                  -{Math.round(item.discountPercent)}%
                </Text>
              </View>
            ) : null}
            <View
              className={`rounded-full px-2 py-0.5 mr-3 ${
                item.paymentMethod === 'efectivo'
                  ? 'bg-green-100'
                  : item.paymentMethod === 'transferencia'
                    ? 'bg-blue-100'
                    : 'bg-orange-100'
              }`}
            >
              <Text
                variant="caption"
                className={
                  item.paymentMethod === 'efectivo'
                    ? 'text-green-700'
                    : item.paymentMethod === 'transferencia'
                      ? 'text-blue-700'
                      : 'text-orange-700'
                }
              >
                {item.paymentMethod === 'efectivo' ? 'E' : item.paymentMethod === 'transferencia' ? 'T' : 'C'}
              </Text>
            </View>
            <Pressable onPress={() => removeItem(item.key)} hitSlop={12}>
              <Text className="text-red-500 text-lg">✕</Text>
            </Pressable>
          </View>
        )}
      />

      <View className="bg-white border-t border-gray-200 px-4 py-3 gap-2">
        <View className="flex-row justify-between flex-wrap gap-1">
          <Text variant="label" className="text-green-700">
            Efectivo: ${formatAmount(totalCash())}
          </Text>
          <Text variant="label" className="text-blue-700">
            Transfer: ${formatAmount(totalTransfer())}
          </Text>
          {totalCost() > 0 ? (
            <Text variant="label" className="text-orange-600">
              Costo: ${formatAmount(totalCost())}
            </Text>
          ) : null}
        </View>
        <View className="flex-row justify-between items-center">
          <Text variant="heading">Total: ${formatAmount(grandTotal())}</Text>
          <Text variant="caption">{items.length} ítem(s)</Text>
        </View>
        <Button
          label={saving ? 'Guardando…' : `Guardar sesión (${items.length})`}
          onPress={saveSession}
          disabled={items.length === 0 || saving}
          size="lg"
        />
      </View>
    </KeyboardAvoidingView>
  );
}
