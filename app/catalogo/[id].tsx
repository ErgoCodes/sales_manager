import { zodResolver } from '@hookform/resolvers/zod';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ScrollView } from 'react-native';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CATEGORIA_OPTIONS, UNIDADES_MEDIDA } from '@/constants/catalogo';
import { actualizarProducto, crearProducto, getProducto } from '@/db/productos';

const schema = z.object({
  nombre: z.string().trim().min(1, 'El nombre no puede estar vacío'),
  unidadMedida: z.string().min(1, 'Selecciona una unidad'),
  categoria: z.string().min(1, 'Selecciona una categoría'),
  umbralAlerta: z
    .string()
    .refine((v) => Number(v) > 0, 'Debe ser mayor que 0')
    .refine((v) => Number.isInteger(Number(v)), 'Debe ser un número entero'),
});

type FormValues = z.infer<typeof schema>;

export default function ProductoFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const esNuevo = id === 'nuevo';

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { nombre: '', unidadMedida: 'ud', categoria: '', umbralAlerta: '' },
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
      });
    })();
  }, [id, esNuevo, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const datos = {
      nombre: values.nombre.trim(),
      unidadMedida: values.unidadMedida,
      categoria: values.categoria,
      umbralAlerta: Number(values.umbralAlerta),
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

      <Button
        label={isSubmitting ? 'Guardando…' : esNuevo ? 'Crear producto' : 'Guardar cambios'}
        onPress={onSubmit}
        disabled={isSubmitting}
      />
    </ScrollView>
  );
}
