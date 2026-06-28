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
  type ProductoSeleccionado,
} from '@/components/ui/product-picker';
import { Text } from '@/components/ui/text';
import { registrarEntrada } from '@/db/movimientos';
import { actualizarProducto } from '@/db/productos';

const precioPositivo = (msg: string) =>
  z.string().refine((v) => v.trim() !== '' && Number(v) > 0, msg);

const schema = z.object({
  cantidad: z.string().refine((v) => Number(v) > 0, 'Debe ser mayor que 0'),
  precioCostoUnitario: precioPositivo('El costo es obligatorio y debe ser mayor que 0'),
  fecha: z.string().min(1, 'La fecha es obligatoria'),
  notas: z.string().optional(),
  // Campos opcionales para actualizar precios del catálogo
  nuevoPrecioCosto: z.string().optional(),
  nuevoPrecioEfectivo: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

function calcTransferencia(efectivo: number): number {
  return Math.round((efectivo * 1.1) / 5) * 5;
}

export default function EntradaScreen() {
  const [producto, setProducto] = useState<ProductoSeleccionado | null>(null);
  const [productoError, setProductoError] = useState('');
  const [actualizarPrecios, setActualizarPrecios] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      cantidad: '',
      precioCostoUnitario: '',
      fecha: format(new Date(), 'yyyy-MM-dd'),
      notas: '',
      nuevoPrecioCosto: '',
      nuevoPrecioEfectivo: '',
    },
  });

  function onProductoSeleccionado(p: ProductoSeleccionado) {
    setProducto(p);
    setProductoError('');
    if (p.precioCosto != null) {
      setValue('precioCostoUnitario', String(p.precioCosto));
    }
    if (actualizarPrecios) {
      if (p.precioCosto != null) setValue('nuevoPrecioCosto', String(p.precioCosto));
      if (p.precioEfectivo != null) setValue('nuevoPrecioEfectivo', String(p.precioEfectivo));
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    if (!producto) {
      setProductoError('Selecciona un producto');
      return;
    }

    await registrarEntrada({
      productoId: producto.id,
      cantidad: Number(values.cantidad),
      precioCostoUnitario: Number(values.precioCostoUnitario),
      fecha: values.fecha,
      notas: values.notas || null,
    });

    if (actualizarPrecios) {
      const costo = values.nuevoPrecioCosto ? Number(values.nuevoPrecioCosto) : undefined;
      const efectivo = values.nuevoPrecioEfectivo ? Number(values.nuevoPrecioEfectivo) : undefined;
      if (costo && costo > 0 && efectivo && efectivo > 0) {
        await actualizarProducto(producto.id, {
          nombre: producto.nombre,
          unidadMedida: producto.unidadMedida,
          categoria: null,
          umbralAlerta: null,
          precioCosto: costo,
          precioEfectivo: efectivo,
          precioTransferencia: calcTransferencia(efectivo),
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
        value={producto}
        onChange={onProductoSeleccionado}
        error={productoError}
      />

      {/* Precios actuales del producto seleccionado */}
      {producto ? (
        <View className="rounded-xl bg-white p-3 shadow-sm gap-1">
          <Text variant="label">Precios actuales</Text>
          <Text variant="caption">
            Costo: ${producto.precioCosto ?? '—'} · Efectivo: ${producto.precioEfectivo ?? '—'} ·
            Transferencia: ${producto.precioTransferencia ?? '—'}
          </Text>
        </View>
      ) : null}

      <Controller
        control={control}
        name="cantidad"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label={`Cantidad${producto ? ` (${producto.unidadMedida})` : ''}`}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="Ej. 10"
            error={errors.cantidad?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="precioCostoUnitario"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Precio costo unitario"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder="Obligatorio"
            error={errors.precioCostoUnitario?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="fecha"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Fecha (YYYY-MM-DD)"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="2026-06-27"
            error={errors.fecha?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="notas"
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

      {/* Toggle para actualizar precios del catálogo */}
      <Pressable
        onPress={() => setActualizarPrecios((v) => !v)}
        hitSlop={8}
        className="flex-row items-center gap-2">
        <Text variant="label" className={actualizarPrecios ? 'text-blue-600' : 'text-gray-500'}>
          {actualizarPrecios ? '☑' : '☐'} Actualizar precios del catálogo
        </Text>
      </Pressable>

      {actualizarPrecios ? (
        <View className="gap-3 rounded-xl bg-blue-50 p-3">
          <Controller
            control={control}
            name="nuevoPrecioCosto"
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
            name="nuevoPrecioEfectivo"
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
