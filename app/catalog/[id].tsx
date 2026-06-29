import { zodResolver } from '@hookform/resolvers/zod';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, View } from 'react-native';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { CATEGORY_OPTIONS, UNITS_OF_MEASURE } from '@/constants/catalog';
import { createProduct, getProduct, updateProduct } from '@/db/products';

const positivePrice = (msg: string) =>
  z.string().refine((v) => v.trim() !== '' && Number(v) > 0, msg);

const schema = z.object({
  name: z.string().trim().min(1, 'El nombre no puede estar vacío'),
  unitOfMeasure: z.string().min(1, 'Selecciona una unidad'),
  category: z.string().min(1, 'Selecciona una categoría'),
  lowStockThreshold: z
    .string()
    .refine((v) => Number(v) > 0, 'Debe ser mayor que 0')
    .refine((v) => Number.isInteger(Number(v)), 'Debe ser un número entero'),
  costPrice: positivePrice('Debe ser mayor que 0'),
  cashPrice: positivePrice('Debe ser mayor que 0'),
});

type FormValues = z.infer<typeof schema>;

function calculateTransferPrice(cashPrice: number): number {
  return Math.round((cashPrice * 1.1) / 5) * 5;
}

export default function ProductFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      unitOfMeasure: 'ud',
      category: '',
      lowStockThreshold: '',
      costPrice: '',
      cashPrice: '',
    },
  });

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const p = await getProduct(Number(id));
      if (!p) return;
      reset({
        name: p.name,
        unitOfMeasure: p.unitOfMeasure,
        category: p.category ?? '',
        lowStockThreshold: p.lowStockThreshold != null ? String(p.lowStockThreshold) : '',
        costPrice: p.costPrice != null ? String(p.costPrice) : '',
        cashPrice: p.cashPrice != null ? String(p.cashPrice) : '',
      });
    })();
  }, [id, isNew, reset]);

  const costStr = watch('costPrice');
  const cashStr = watch('cashPrice');
  const costNum = Number(costStr) || 0;
  const cashNum = Number(cashStr) || 0;
  const transferNum = cashNum > 0 ? calculateTransferPrice(cashNum) : 0;
  const suggested = costNum > 0 ? Math.round(costNum * 1.3 * 100) / 100 : 0;

  const onSubmit = handleSubmit(async (values) => {
    const cash = Number(values.cashPrice);
    const data = {
      name: values.name.trim(),
      unitOfMeasure: values.unitOfMeasure,
      category: values.category,
      lowStockThreshold: Number(values.lowStockThreshold),
      costPrice: Number(values.costPrice),
      cashPrice: cash,
      transferPrice: calculateTransferPrice(cash),
    };
    if (isNew) await createProduct(data);
    else await updateProduct(Number(id), data);
    router.back();
  });

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="p-4 gap-4">
      <Stack.Screen options={{ title: isNew ? 'Nuevo producto' : 'Editar producto' }} />

      <Controller
        control={control}
        name="name"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Nombre"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="Ej. Refresco de cola"
            error={errors.name?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="unitOfMeasure"
        render={({ field: { onChange, value } }) => (
          <Select
            label="Unidad de medida"
            options={UNITS_OF_MEASURE}
            value={value}
            onChange={onChange}
            error={errors.unitOfMeasure?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="category"
        render={({ field: { onChange, value } }) => (
          <Select
            label="Categoría"
            options={CATEGORY_OPTIONS}
            value={value}
            onChange={onChange}
            error={errors.category?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="lowStockThreshold"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Umbral de alerta de stock"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="Ej. 5"
            error={errors.lowStockThreshold?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="costPrice"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Precio de costo"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="Ej. 100"
            error={errors.costPrice?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="cashPrice"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Precio efectivo"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="Ej. 130"
            error={errors.cashPrice?.message}
          />
        )}
      />

      {suggested > 0 ? (
        <View className="flex-row items-center gap-2 rounded-lg bg-blue-50 px-3 py-2">
          <Text variant="caption" className="flex-1 text-blue-700">
            ≈ Sugerido: ${suggested} (costo + 30%)
          </Text>
          <Pressable
            hitSlop={8}
            onPress={() => setValue('cashPrice', String(suggested))}>
            <Text variant="label" className="text-blue-600">
              Usar sugerido
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View className="rounded-xl bg-white p-4 shadow-sm gap-2">
        <Text variant="label">Resumen de precios</Text>
        <View className="flex-row justify-between">
          <Text variant="body">Costo</Text>
          <Text variant="body">{costNum > 0 ? `$${costNum}` : '—'}</Text>
        </View>
        <View className="flex-row justify-between">
          <Text variant="body">Efectivo</Text>
          <Text variant="body">{cashNum > 0 ? `$${cashNum}` : '—'}</Text>
        </View>
        <View className="flex-row justify-between">
          <Text variant="body" className="font-semibold">
            Transferencia
          </Text>
          <Text variant="body" className="font-semibold">
            {transferNum > 0 ? `$${transferNum}` : '—'}
          </Text>
        </View>
      </View>

      <Button
        label={isSubmitting ? 'Guardando…' : isNew ? 'Crear producto' : 'Guardar cambios'}
        onPress={onSubmit}
        disabled={isSubmitting}
      />
    </ScrollView>
  );
}
