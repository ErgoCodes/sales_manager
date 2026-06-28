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
import { CATEGORIA_OPTIONS, UNIDADES_MEDIDA } from '@/constants/catalogo';
import { actualizarProducto, crearProducto, getProducto } from '@/db/productos';

const precioPositivo = (msg: string) =>
  z.string().refine((v) => v.trim() !== '' && Number(v) > 0, msg);

const schema = z.object({
  nombre: z.string().trim().min(1, 'El nombre no puede estar vacío'),
  unidadMedida: z.string().min(1, 'Selecciona una unidad'),
  categoria: z.string().min(1, 'Selecciona una categoría'),
  umbralAlerta: z
    .string()
    .refine((v) => Number(v) > 0, 'Debe ser mayor que 0')
    .refine((v) => Number.isInteger(Number(v)), 'Debe ser un número entero'),
  precioCosto: precioPositivo('Debe ser mayor que 0'),
  precioEfectivo: precioPositivo('Debe ser mayor que 0'),
});

type FormValues = z.infer<typeof schema>;

function calcTransferencia(efectivo: number): number {
  return Math.round((efectivo * 1.1) / 5) * 5;
}

export default function ProductoFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const esNuevo = id === 'nuevo';

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
      nombre: '',
      unidadMedida: 'ud',
      categoria: '',
      umbralAlerta: '',
      precioCosto: '',
      precioEfectivo: '',
    },
  });

  useEffect(() => {
    if (esNuevo) return;
    (async () => {
      const p = await getProducto(Number(id));
      if (!p) return;
      reset({
        nombre: p.nombre,
        unidadMedida: p.unidadMedida,
        categoria: p.categoria ?? '',
        umbralAlerta: p.umbralAlerta != null ? String(p.umbralAlerta) : '',
        precioCosto: p.precioCosto != null ? String(p.precioCosto) : '',
        precioEfectivo: p.precioEfectivo != null ? String(p.precioEfectivo) : '',
      });
    })();
  }, [id, esNuevo, reset]);

  const costoStr = watch('precioCosto');
  const efectivoStr = watch('precioEfectivo');
  const costoNum = Number(costoStr) || 0;
  const efectivoNum = Number(efectivoStr) || 0;
  const transferencia = efectivoNum > 0 ? calcTransferencia(efectivoNum) : 0;
  const sugerido = costoNum > 0 ? Math.round(costoNum * 1.3 * 100) / 100 : 0;

  const onSubmit = handleSubmit(async (values) => {
    const ef = Number(values.precioEfectivo);
    const datos = {
      nombre: values.nombre.trim(),
      unidadMedida: values.unidadMedida,
      categoria: values.categoria,
      umbralAlerta: Number(values.umbralAlerta),
      precioCosto: Number(values.precioCosto),
      precioEfectivo: ef,
      precioTransferencia: calcTransferencia(ef),
    };
    if (esNuevo) await crearProducto(datos);
    else await actualizarProducto(Number(id), datos);
    router.back();
  });

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="p-4 gap-4">
      <Stack.Screen options={{ title: esNuevo ? 'Nuevo producto' : 'Editar producto' }} />

      <Controller
        control={control}
        name="nombre"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Nombre"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="Ej. Refresco de cola"
            error={errors.nombre?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="unidadMedida"
        render={({ field: { onChange, value } }) => (
          <Select
            label="Unidad de medida"
            options={UNIDADES_MEDIDA}
            value={value}
            onChange={onChange}
            error={errors.unidadMedida?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="categoria"
        render={({ field: { onChange, value } }) => (
          <Select
            label="Categoría"
            options={CATEGORIA_OPTIONS}
            value={value}
            onChange={onChange}
            error={errors.categoria?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="umbralAlerta"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Umbral de alerta de stock"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="Ej. 5"
            error={errors.umbralAlerta?.message}
          />
        )}
      />

      {/* Precios */}
      <Controller
        control={control}
        name="precioCosto"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Precio de costo"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="Ej. 100"
            error={errors.precioCosto?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="precioEfectivo"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Precio efectivo"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="Ej. 130"
            error={errors.precioEfectivo?.message}
          />
        )}
      />

      {/* T-05: Sugerencia de precio óptimo (costo + 30%) */}
      {sugerido > 0 ? (
        <View className="flex-row items-center gap-2 rounded-lg bg-blue-50 px-3 py-2">
          <Text variant="caption" className="flex-1 text-blue-700">
            ≈ Sugerido: ${sugerido} (costo + 30%)
          </Text>
          <Pressable
            hitSlop={8}
            onPress={() => setValue('precioEfectivo', String(sugerido))}>
            <Text variant="label" className="text-blue-600">
              Usar sugerido
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Resumen de los tres precios antes de guardar */}
      <View className="rounded-xl bg-white p-4 shadow-sm gap-2">
        <Text variant="label">Resumen de precios</Text>
        <View className="flex-row justify-between">
          <Text variant="body">Costo</Text>
          <Text variant="body">{costoNum > 0 ? `$${costoNum}` : '—'}</Text>
        </View>
        <View className="flex-row justify-between">
          <Text variant="body">Efectivo</Text>
          <Text variant="body">{efectivoNum > 0 ? `$${efectivoNum}` : '—'}</Text>
        </View>
        <View className="flex-row justify-between">
          <Text variant="body" className="font-semibold">
            Transferencia
          </Text>
          <Text variant="body" className="font-semibold">
            {transferencia > 0 ? `$${transferencia}` : '—'}
          </Text>
        </View>
      </View>

      <Button
        label={isSubmitting ? 'Guardando…' : esNuevo ? 'Crear producto' : 'Guardar cambios'}
        onPress={onSubmit}
        disabled={isSubmitting}
      />
    </ScrollView>
  );
}
