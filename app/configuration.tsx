import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ScrollView, View } from 'react-native';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { CONFIG_KEYS, getAllConfig, setConfig } from '@/db/config';

const nonNegativeNumber = (msg: string) =>
  z.string().refine((v) => v.trim() !== '' && Number(v) >= 0, msg);

const schema = z.object({
  businessName: z.string().trim().min(1, 'El nombre no puede estar vacío'),
  cashDiscountPercent: nonNegativeNumber('Debe ser un número ≥ 0'),
  generalStockThreshold: nonNegativeNumber('Debe ser un número ≥ 0').refine(
    (v) => Number.isInteger(Number(v)),
    'Debe ser un número entero',
  ),
  stagnantDiscountPercent: nonNegativeNumber('Debe ser un número ≥ 0'),
});

type FormValues = z.infer<typeof schema>;

export default function ConfigurationScreen() {
  const [saved, setSaved] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      businessName: '',
      cashDiscountPercent: '10',
      generalStockThreshold: '5',
      stagnantDiscountPercent: '15',
    },
  });

  useEffect(() => {
    (async () => {
      const cfg = await getAllConfig();
      reset({
        businessName: cfg[CONFIG_KEYS.businessName],
        cashDiscountPercent: cfg[CONFIG_KEYS.cashDiscountPercent],
        generalStockThreshold: cfg[CONFIG_KEYS.generalStockThreshold],
        stagnantDiscountPercent: cfg[CONFIG_KEYS.stagnantDiscountPercent],
      });
    })();
  }, [reset]);

  const onSubmit = handleSubmit(async (values) => {
    await Promise.all([
      setConfig(CONFIG_KEYS.businessName, values.businessName.trim()),
      setConfig(CONFIG_KEYS.cashDiscountPercent, String(Number(values.cashDiscountPercent))),
      setConfig(CONFIG_KEYS.generalStockThreshold, String(Number(values.generalStockThreshold))),
      setConfig(CONFIG_KEYS.stagnantDiscountPercent, String(Number(values.stagnantDiscountPercent))),
    ]);
    setSaved(true);
  });

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="p-4 gap-4">
      <Controller
        control={control}
        name="businessName"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Nombre del negocio"
            value={String(value ?? '')}
            onChangeText={(t) => {
              onChange(t);
              setSaved(false);
            }}
            onBlur={onBlur}
            placeholder="Mercado Mónaco"
            error={errors.businessName?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="cashDiscountPercent"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="% descuento por efectivo"
            value={String(value ?? '')}
            onChangeText={(t) => {
              onChange(t);
              setSaved(false);
            }}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="10"
            error={errors.cashDiscountPercent?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="generalStockThreshold"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Umbral de stock bajo (general)"
            value={String(value ?? '')}
            onChangeText={(t) => {
              onChange(t);
              setSaved(false);
            }}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="5"
            error={errors.generalStockThreshold?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="stagnantDiscountPercent"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="% descuento por producto estancado/vencimiento"
            value={String(value ?? '')}
            onChangeText={(t) => {
              onChange(t);
              setSaved(false);
            }}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="15"
            error={errors.stagnantDiscountPercent?.message}
          />
        )}
      />

      <Button label={isSubmitting ? 'Guardando…' : 'Guardar'} onPress={onSubmit} disabled={isSubmitting} />

      {saved ? (
        <View className="rounded-lg bg-green-50 p-3">
          <Text variant="label" className="text-green-700">
            ✓ Configuración guardada
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
