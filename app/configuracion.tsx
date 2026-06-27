import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ScrollView, View } from 'react-native';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { CONFIG_KEYS, getAllConfig, setConfig } from '@/db/config';

const numeroNoNegativo = (msg: string) =>
  z.string().refine((v) => v.trim() !== '' && Number(v) >= 0, msg);

const schema = z.object({
  nombreNegocio: z.string().trim().min(1, 'El nombre no puede estar vacío'),
  descuentoEfectivoPct: numeroNoNegativo('Debe ser un número ≥ 0'),
  umbralStockGeneral: numeroNoNegativo('Debe ser un número ≥ 0').refine(
    (v) => Number.isInteger(Number(v)),
    'Debe ser un número entero',
  ),
});

type FormValues = z.infer<typeof schema>;

export default function ConfiguracionScreen() {
  const [guardado, setGuardado] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { nombreNegocio: '', descuentoEfectivoPct: '10', umbralStockGeneral: '5' },
  });

  useEffect(() => {
    (async () => {
      const cfg = await getAllConfig();
      reset({
        nombreNegocio: cfg[CONFIG_KEYS.nombreNegocio],
        descuentoEfectivoPct: cfg[CONFIG_KEYS.descuentoEfectivoPct],
        umbralStockGeneral: cfg[CONFIG_KEYS.umbralStockGeneral],
      });
    })();
  }, [reset]);

  const onSubmit = handleSubmit(async (values) => {
    await Promise.all([
      setConfig(CONFIG_KEYS.nombreNegocio, values.nombreNegocio.trim()),
      setConfig(CONFIG_KEYS.descuentoEfectivoPct, String(Number(values.descuentoEfectivoPct))),
      setConfig(CONFIG_KEYS.umbralStockGeneral, String(Number(values.umbralStockGeneral))),
    ]);
    setGuardado(true);
  });

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="p-4 gap-4">
      <Controller
        control={control}
        name="nombreNegocio"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Nombre del negocio"
            value={String(value ?? '')}
            onChangeText={(t) => {
              onChange(t);
              setGuardado(false);
            }}
            onBlur={onBlur}
            placeholder="Mercado Mónaco"
            error={errors.nombreNegocio?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="descuentoEfectivoPct"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="% descuento por efectivo"
            value={String(value ?? '')}
            onChangeText={(t) => {
              onChange(t);
              setGuardado(false);
            }}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="10"
            error={errors.descuentoEfectivoPct?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="umbralStockGeneral"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Umbral de stock bajo (general)"
            value={String(value ?? '')}
            onChangeText={(t) => {
              onChange(t);
              setGuardado(false);
            }}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="5"
            error={errors.umbralStockGeneral?.message}
          />
        )}
      />

      <Button label={isSubmitting ? 'Guardando…' : 'Guardar'} onPress={onSubmit} disabled={isSubmitting} />

      {guardado ? (
        <View className="rounded-lg bg-green-50 p-3">
          <Text variant="label" className="text-green-700">
            ✓ Configuración guardada
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
