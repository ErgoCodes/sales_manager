import { Stack, router } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, FlatList, Pressable, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import {
  ProductPicker,
  type SelectedProduct,
} from '@/components/ui/product-picker';
import { Snackbar } from '@/components/ui/snackbar';
import { Text } from '@/components/ui/text';
import { Colors, Radius, Shadows } from '@/constants/theme';
import { registerSalesSession, verifySessionStock } from '@/db/sales';
import { useCartStore } from '@/store';
import { useAppColors } from '@/hooks/use-app-colors';
import { safeWrite } from '@/lib/safe-write';

export default function NewSessionScreen() {
  const c = useAppColors();
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
  const [amountReceived, setAmountReceived] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

    if (cashDue > 0 && (receivedNum === null || receivedNum < cashDue)) {
      setErrorMessage(
        `El monto recibido en efectivo ($${amountReceived === '' ? '0' : amountReceived}) es menor al subtotal en efectivo ($${formatAmount(cashDue)}).`,
      );
      return;
    }

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

      const received = Number(amountReceived);
      const result = await safeWrite(() =>
        registerSalesSession(
          items,
          date,
          received > 0 ? { amountReceived: received } : undefined,
        ),
        'No se pudo guardar la sesión',
      );
      if (result.ok) {
        clear();
        router.back();
      }
    } finally {
      setSaving(false);
    }
  }

  const formatAmount = (n: number) => n.toFixed(2);

  // Denominaciones DOP para llenar el monto recibido con un toque.
  const QUICK_BILLS = [100, 200, 500, 1000, 2000];
  const cashDue = totalCash();
  const receivedNum = amountReceived === '' ? null : Number(amountReceived);
  const changeAmount = receivedNum === null ? null : receivedNum - cashDue;

  function addBill(bill: number) {
    const current = amountReceived === '' ? 0 : Number(amountReceived);
    setAmountReceived(String(current + bill));
  }

  function handleReceivedChange(text: string) {
    // Solo dígitos y un punto decimal.
    const cleaned = text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    setAmountReceived(cleaned);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior="padding"
    >
      <Stack.Screen options={{ title: 'Nueva sesión' }} />

      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 12, zIndex: 10 }}>
        <DatePicker
          label="Fecha de la sesión"
          value={date}
          onChange={setDate}
          placeholder="Seleccionar fecha"
        />

        <ProductPicker
          label="Buscar producto"
          value={product}
          onChange={onProductSelected}
        />

        {product ? (
          <View style={{ borderRadius: Radius.xl, backgroundColor: c.surface, padding: 12, boxShadow: Shadows.sm, gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
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
                <Text variant="body" style={{ color: c.textMuted }}>
                  ✕
                </Text>
              </Pressable>
            </View>
            <Text variant="caption">
              Efectivo: ${product.cashPrice ?? '—'} · Transferencia: $
              {product.transferPrice ?? '—'} · Costo prom: $
              {product.averageCost.toFixed(2)}
            </Text>

            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: c.text }}>
                Cantidad ({product.unitOfMeasure})
              </Text>
              <TextInput
                ref={quantityRef}
                style={{
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: Radius.lg,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontSize: 16,
                  color: c.text,
                  backgroundColor: c.surface,
                }}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="numeric"
                placeholder="1"
                selectTextOnFocus
                placeholderTextColor={Colors.light.tabIconDefault}
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
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <Text variant="label" style={{ color: workerSale ? c.cost : c.textMuted }}>
                {workerSale ? '☑' : '☐'} Venta a trabajador (costo)
              </Text>
            </Pressable>

            {!workerSale ? (
              <Pressable
                onPress={() => setDiscountExpanded((v) => !v)}
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <Text
                  variant="label"
                  style={{ color: discountExpanded ? '#9333EA' : c.textMuted }}
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
                style={({ pressed }) => ({
                  borderRadius: Radius.lg,
                  backgroundColor: c.cost,
                  paddingVertical: 12,
                  alignItems: 'center',
                  opacity: pressed ? 0.8 : 1,
                })}
                onPress={() => addToCart('costo')}
              >
                <Text style={{ color: 'white', fontWeight: '600', fontSize: 14 }}>
                  A costo ${product.costPrice ?? product.averageCost.toFixed(2)}
                </Text>
              </Pressable>
            ) : (
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: Radius.lg,
                    backgroundColor: c.cash,
                    paddingVertical: 12,
                    alignItems: 'center',
                    opacity: pressed ? 0.8 : 1,
                  })}
                  onPress={() => addToCart('efectivo')}
                >
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 14 }}>
                    Efectivo $
                    {discountPercentNum > 0
                      ? ((product.cashPrice ?? 0) * (1 - discountPercentNum / 100)).toFixed(2)
                      : (product.cashPrice ?? 0)}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: Radius.lg,
                    backgroundColor: c.transfer,
                    paddingVertical: 12,
                    alignItems: 'center',
                    opacity: pressed ? 0.8 : 1,
                  })}
                  onPress={() => addToCart('transferencia')}
                >
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 14 }}>
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
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 48 }}>
            <Text variant="caption">
              Selecciona un producto para comenzar
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: Radius.xl, backgroundColor: c.surface, paddingHorizontal: 16, paddingVertical: 12, boxShadow: Shadows.sm }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="body">{item.name}</Text>
              <Text variant="caption">
                {item.quantity} {item.unitOfMeasure} × ${item.appliedPrice} = $
                {formatAmount(item.quantity * item.appliedPrice)}
              </Text>
            </View>
            {item.discountPercent > 0 ? (
              <View style={{ borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8, backgroundColor: '#F3E8FF' }}>
                <Text variant="caption" style={{ color: '#7E22CE' }}>
                  -{Math.round(item.discountPercent)}%
                </Text>
              </View>
            ) : null}
            <View
              style={{
                borderRadius: Radius.full,
                paddingHorizontal: 8,
                paddingVertical: 2,
                marginRight: 12,
                backgroundColor:
                  item.paymentMethod === 'efectivo'
                    ? c.cashSoft
                    : item.paymentMethod === 'transferencia'
                      ? c.transferSoft
                      : c.costSoft,
              }}
            >
              <Text
                variant="caption"
                style={{
                  color:
                    item.paymentMethod === 'efectivo'
                      ? c.cash
                      : item.paymentMethod === 'transferencia'
                        ? c.transfer
                        : c.cost,
                }}
              >
                {item.paymentMethod === 'efectivo' ? 'E' : item.paymentMethod === 'transferencia' ? 'T' : 'C'}
              </Text>
            </View>
            <Pressable onPress={() => removeItem(item.key)} hitSlop={12}>
              <Text style={{ color: c.danger, fontSize: 18 }}>✕</Text>
            </Pressable>
          </View>
        )}
      />

      <View style={{ backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border, paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
          <Text variant="label" style={{ color: c.cash }}>
            Efectivo: ${formatAmount(totalCash())}
          </Text>
          <Text variant="label" style={{ color: c.transfer }}>
            Transfer: ${formatAmount(totalTransfer())}
          </Text>
          {totalCost() > 0 ? (
            <Text variant="label" style={{ color: c.cost }}>
              Costo: ${formatAmount(totalCost())}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="heading">Total: ${formatAmount(grandTotal())}</Text>
          <Text variant="caption">{items.length} ítem(s)</Text>
        </View>

        {cashDue > 0 ? (
          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 }}>
            <Text variant="label" style={{ color: c.text }}>
              Cobro en efectivo (${formatAmount(cashDue)})
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontSize: 16,
                  color: c.text,
                  backgroundColor: c.surface,
                }}
                value={amountReceived}
                onChangeText={handleReceivedChange}
                keyboardType="numeric"
                placeholder="Monto recibido"
                placeholderTextColor={c.tabIconDefault}
              />
              {changeAmount !== null ? (
                <Text
                  variant="label"
                  style={{ color: changeAmount >= 0 ? c.cash : c.danger }}
                >
                  {changeAmount >= 0 ? 'Vuelto' : 'Falta'}: ${formatAmount(Math.abs(changeAmount))}
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {QUICK_BILLS.map((bill) => (
                <Pressable
                  key={bill}
                  onPress={() => addBill(bill)}
                  style={({ pressed }) => ({
                    borderRadius: 8,
                    backgroundColor: c.surfaceMuted,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text variant="label" style={{ color: c.text }}>
                    +{bill}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setAmountReceived(String(cashDue))}
                style={({ pressed }) => ({
                  borderRadius: 8,
                  backgroundColor: c.cashSoft,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text variant="label" style={{ color: c.cash }}>
                  Exacto
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <Button
          label={saving ? 'Guardando…' : `Guardar venta (${items.length})`}
          onPress={saveSession}
          disabled={items.length === 0 || saving}
          size="lg"
        />
      </View>

      <Snackbar
        visible={errorMessage !== null}
        message={errorMessage ?? ''}
        onDismiss={() => setErrorMessage(null)}
      />
    </KeyboardAvoidingView>
  );
}
