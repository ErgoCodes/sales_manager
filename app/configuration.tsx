import { zodResolver } from '@hookform/resolvers/zod';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { CONFIG_KEYS, getAllConfig, getConfig, setConfig } from '@/db/config';
import { BackupCancelledError, exportBackup, pickAndValidateBackupFile, restoreBackup } from '@/lib/backup';
import { useAppColors } from '@/hooks/use-app-colors';
import { safeWrite } from '@/lib/safe-write';
import { Semantic, Radius } from '@/constants/theme';

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
  const c = useAppColors();
  const [saved, setSaved] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);

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

  useEffect(() => {
    (async () => {
      setLastBackup(await getConfig(CONFIG_KEYS.lastBackup));
    })();
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    const result = await safeWrite(() =>
      Promise.all([
        setConfig(CONFIG_KEYS.businessName, values.businessName.trim()),
        setConfig(CONFIG_KEYS.cashDiscountPercent, String(Number(values.cashDiscountPercent))),
        setConfig(CONFIG_KEYS.generalStockThreshold, String(Number(values.generalStockThreshold))),
        setConfig(CONFIG_KEYS.stagnantDiscountPercent, String(Number(values.stagnantDiscountPercent))),
      ])
    );
    if (result.ok) {
      setSaved(true);
    }
  });

  async function handleExportBackup() {
    setExporting(true);
    try {
      await exportBackup();
      setLastBackup(await getConfig(CONFIG_KEYS.lastBackup));
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo exportar el respaldo.');
    } finally {
      setExporting(false);
    }
  }

  async function handleRestoreBackup() {
    let asset;
    try {
      asset = await pickAndValidateBackupFile();
    } catch (error) {
      if (error instanceof BackupCancelledError) return;
      Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo leer el archivo seleccionado.');
      return;
    }

    Alert.alert(
      'Restaurar respaldo',
      'Esta acción reemplazará todos los datos actuales por los del archivo seleccionado y no se puede deshacer. ¿Deseas continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Restaurar',
          style: 'destructive',
          onPress: async () => {
            setRestoring(true);
            try {
              await restoreBackup(asset);
              Alert.alert(
                'Respaldo restaurado',
                'Los datos se reemplazaron correctamente. Cierra la aplicación por completo y vuelve a abrirla para continuar.',
              );
            } catch (error) {
              Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo restaurar el respaldo.');
            } finally {
              setRestoring(false);
            }
          },
        },
      ],
    );
  }

  return (
    <KeyboardAwareScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>
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
        <View style={{ borderRadius: Radius.md, backgroundColor: c.cashSoft, padding: 12 }}>
          <Text variant="label" style={{ color: c.cash }}>
            ✓ Configuración guardada
          </Text>
        </View>
      ) : null}

      <Text variant="heading">Respaldo</Text>
      <Card style={{ gap: 12 }}>
        <Text variant="caption">
          Último respaldo:{' '}
          {lastBackup ? format(parseISO(lastBackup), "d 'de' MMMM 'de' yyyy", { locale: es }) : 'Nunca'}
        </Text>
        <Button
          label={exporting ? 'Exportando…' : 'Exportar respaldo'}
          variant="soft"
          onPress={handleExportBackup}
          disabled={exporting || restoring}
        />
        <Button
          label={restoring ? 'Restaurando…' : 'Restaurar respaldo'}
          variant="destructive"
          onPress={handleRestoreBackup}
          disabled={exporting || restoring}
        />
      </Card>
    </KeyboardAwareScrollView>
  );
}
