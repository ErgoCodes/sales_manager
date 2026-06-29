import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, View } from 'react-native';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ProductPicker,
  type SelectedProduct,
} from '@/components/ui/product-picker';
import { Text } from '@/components/ui/text';
import { registerEntry } from '@/db/movements';
import { updateProduct } from '@/db/products';

const positivePrice = (msg: string) =>
  z.string().refine((v) => v.trim() !== '' && Number(v) > 0, msg);

const schema = z.object({
  quantity: z.string().refine((v) => Number(v) > 0, 'Debe ser mayor que 0'),
  unitCostPrice: positivePrice('El costo es obligatorio y debe ser mayor que 0'),
  date: z.string().min(1, 'La fecha es obligatoria'),
  notes: z.string().optional(),
  newCostPrice: z.string().optional(),
  newCashPrice: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

function calculateTransferPrice(cashPrice: number): number {
  return Math.round((cashPrice * 1.1) / 5) * 5;
}

export default function StockEntryScreen() {
  const [product, setProduct] = useState<SelectedProduct | null>(null);
  const [productError, setProductError] = useState('');
  const [updatePrices, setUpdatePrices] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      quantity: '',
      unitCostPrice: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      notes: '',
      newCostPrice: '',
      newCashPrice: '',
    },
  });

  function onProductSelected(p: SelectedProduct) {
    setProduct(p);
    setProductError('');
    if (p.costPrice != null) {
      setValue('unitCostPrice', String(p.costPrice));
    }
    if (updatePrices) {
      if (p.costPrice != null) setValue('newCostPrice', String(p.costPrice));
      if (p.cashPrice != null) setValue('newCashPrice', String(p.cashPrice));
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    if (!product) {
      setProductError('Selecciona un producto');
      return;
    }

    await registerEntry({
      productId: product.id,
      quantity: Number(values.quantity),
      unitCostPrice: Number(values.unitCostPrice),
      date: values.date,
      notes: values.notes || null,
    });

    if (updatePrices) {
      const cost = values.newCostPrice ? Number(values.newCostPrice) : undefined;
      const cash = values.newCashPrice ? Number(values.newCashPrice) : undefined;
      if (cost && cost > 0 && cash && cash > 0) {
        await updateProduct(product.id, {
          name: product.name,
          unitOfMeasure: product.unitOfMeasure,
          category: null,
          lowStockThreshold: null,
          costPrice: cost,
          cashPrice: cash,
          transferPrice: calculateTransferPrice(cash),
        });
      }
    }

    router.back();
  });

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="p-4 gap-4">
      <Stack.Screen options={{ title: 'Registrar entrada' }} />

      <ProductPicker
        label="Producto"
        value={product}
        onChange={onProductSelected}
        error={productError}
      />

      {product ? (
        <View className="rounded-xl bg-white p-3 shadow-sm gap-1">
          <Text variant="label">Precios actuales</Text>
          <Text variant="caption">
            Costo: ${product.costPrice ?? '—'} · Efectivo: ${product.cashPrice ?? '—'} ·
            Transferencia: ${product.transferPrice ?? '—'}
          </Text>
        </View>
      ) : null}

      <Controller
        control={control}
        name="quantity"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label={`Cantidad${product ? ` (${product.unitOfMeasure})` : ''}`}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="Ej. 10"
            error={errors.quantity?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="unitCostPrice"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Precio costo unitario"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="Obligatorio"
            error={errors.unitCostPrice?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="date"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Fecha (YYYY-MM-DD)"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="2026-06-27"
            error={errors.date?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="notes"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Notas (opcional)"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="Ej. Proveedor ABC"
            multiline
          />
        )}
      />

      <Pressable
        onPress={() => setUpdatePrices((v) => !v)}
        hitSlop={8}
        className="flex-row items-center gap-2">
        <Text variant="label" className={updatePrices ? 'text-blue-600' : 'text-gray-500'}>
          {updatePrices ? '☑' : '☐'} Actualizar precios del catálogo
        </Text>
      </Pressable>

      {updatePrices ? (
        <View className="gap-3 rounded-xl bg-blue-50 p-3">
          <Controller
            control={control}
            name="newCostPrice"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Nuevo precio costo"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                keyboardType="numeric"
              />
            )}
          />
          <Controller
            control={control}
            name="newCashPrice"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Nuevo precio efectivo"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                keyboardType="numeric"
              />
            )}
          />
        </View>
      ) : null}

      <Button
        label={isSubmitting ? 'Registrando…' : 'Registrar entrada'}
        onPress={onSubmit}
        disabled={isSubmitting}
      />
    </ScrollView>
  );
}
