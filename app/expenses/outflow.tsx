import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ProductPicker,
  type SelectedProduct,
} from '@/components/ui/product-picker';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { OUTFLOW_TYPES, type OutflowType } from '@/constants/expenses';
import { registerOutflow } from '@/db/movements';
import { calculateStock } from '@/db/queries';

const schema = z.object({
  quantity: z.string().refine((v) => Number(v) > 0, 'Debe ser mayor que 0'),
  unitCostPrice: z
    .string()
    .refine((v) => v.trim() !== '' && Number(v) > 0, 'El costo es obligatorio y debe ser mayor que 0'),
  date: z.string().min(1, 'La fecha es obligatoria'),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function OutflowScreen() {
  const [product, setProduct] = useState<SelectedProduct | null>(null);
  const [productError, setProductError] = useState('');
  const [type, setType] = useState<OutflowType>('merma');
  const [direction, setDirection] = useState<'decrease' | 'increase'>('decrease');

  const {
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      quantity: '',
      unitCostPrice: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      notes: '',
    },
  });

  function onProductSelected(p: SelectedProduct) {
    setProduct(p);
    setProductError('');
    const cost = p.averageCost > 0 ? p.averageCost : (p.costPrice ?? 0);
    if (cost > 0) setValue('unitCostPrice', String(cost));
  }

  async function persist(values: FormValues, signedQuantity: number) {
    if (!product) return;
    await registerOutflow({
      productId: product.id,
      type,
      quantity: signedQuantity,
      unitCostPrice: Number(values.unitCostPrice),
      date: values.date,
      notes: values.notes || null,
    });
    router.back();
  }

  const onSubmit = handleSubmit(async (values) => {
    if (!product) {
      setProductError('Selecciona un producto');
      return;
    }

    // Ajuste puede subir o bajar el stock; merma y retiro siempre lo bajan.
    const magnitude = Number(values.quantity);
    const signedQuantity =
      type === 'ajuste' && direction === 'increase' ? magnitude : -magnitude;

    // Advertir (sin bloquear) si el stock quedaría negativo.
    if (signedQuantity < 0) {
      const stock = await calculateStock(product.id);
      const resulting = stock + signedQuantity;
      if (resulting < 0) {
        Alert.alert(
          'Stock insuficiente',
          `${product.name} tiene ${stock} ${product.unitOfMeasure}. Esta salida lo dejaría en ${resulting}. ¿Registrar de todas formas?`,
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Registrar',
              style: 'destructive',
              onPress: () => persist(getValues(), signedQuantity),
            },
          ],
        );
        return;
      }
    }

    await persist(values, signedQuantity);
  });

  const isAdjustment = type === 'ajuste';

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-slate-950" contentContainerClassName="p-4 gap-4">
      <Stack.Screen options={{ title: 'Salida de almacén' }} />

      <Select
        label="Tipo de salida"
        options={OUTFLOW_TYPES}
        value={type}
        onChange={(v) => setType(v as OutflowType)}
      />

      <ProductPicker
        label="Producto"
        value={product}
        onChange={onProductSelected}
        error={productError}
      />

      {product ? (
        <View className="rounded-xl bg-white dark:bg-slate-900 p-3 shadow-sm gap-1">
          <Text variant="label">Costo promedio actual</Text>
          <Text variant="caption">
            ${product.averageCost > 0 ? product.averageCost : (product.costPrice ?? '—')} ·{' '}
            {product.unitOfMeasure}
          </Text>
        </View>
      ) : null}

      {isAdjustment ? (
        <View className="gap-1.5">
          <Text variant="label">Dirección del ajuste</Text>
          <View className="flex-row gap-2">
            {(
              [
                { value: 'decrease', label: 'Disminuir' },
                { value: 'increase', label: 'Aumentar' },
              ] as const
            ).map((opt) => {
              const selected = opt.value === direction;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setDirection(opt.value)}
                  className={`rounded-full border px-3.5 py-2 ${
                    selected ? 'border-blue-600 bg-blue-600' : 'border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900'
                  }`}>
                  <Text className={selected ? 'text-white font-medium' : 'text-gray-700 dark:text-slate-200'}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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
            placeholder="Ej. 3"
            error={errors.quantity?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="unitCostPrice"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Costo unitario"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="Obligatorio"
            hint="Se usa para valorar la pérdida en los reportes."
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
            placeholder="2026-06-29"
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
            placeholder="Ej. Producto vencido"
            multiline
          />
        )}
      />

      <Button
        label={isSubmitting ? 'Registrando…' : 'Registrar salida'}
        onPress={onSubmit}
        disabled={isSubmitting}
      />
    </ScrollView>
  );
}
