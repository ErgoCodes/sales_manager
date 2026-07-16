import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  ProductPicker,
  type SelectedProduct,
} from "@/components/ui/product-picker";
import { Text } from "@/components/ui/text";
import { CONFIG_KEYS, getConfig } from "@/db/config";
import { registerEntry } from "@/db/movements";
import { updateProduct } from "@/db/products";
import { Radius, Shadows } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";
import { calculateTransferPrice } from "@/lib/pricing";
import { safeWrite } from "@/lib/safe-write";

const positivePrice = (msg: string) =>
  z.string().refine((v) => v.trim() !== "" && Number(v) > 0, msg);

const schema = z.object({
  quantity: z.string().refine((v) => Number(v) > 0, "Debe ser mayor que 0"),
  unitCostPrice: positivePrice(
    "El costo es obligatorio y debe ser mayor que 0"
  ),
  date: z
    .string()
    .min(1, "La fecha es obligatoria")
    .refine(
      (v) => v <= format(new Date(), "yyyy-MM-dd"),
      "La fecha no puede ser futura"
    ),
  notes: z.string().optional(),
  newCostPrice: z.string().optional(),
  newCashPrice: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function StockEntryScreen() {
  const c = useAppColors();
  const [product, setProduct] = useState<SelectedProduct | null>(null);
  const [productError, setProductError] = useState("");
  const [updatePrices, setUpdatePrices] = useState(false);
  const [transferSurchargePct, setTransferSurchargePct] = useState(10);

  useEffect(() => {
    (async () => {
      const surchargeStr = await getConfig(CONFIG_KEYS.transferSurchargePercent);
      if (surchargeStr) {
        setTransferSurchargePct(Number(surchargeStr));
      }
    })();
  }, []);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      quantity: "",
      unitCostPrice: "",
      date: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      newCostPrice: "",
      newCashPrice: "",
    },
  });

  function onProductSelected(p: SelectedProduct) {
    setProduct(p);
    setProductError("");
    if (p.costPrice != null) {
      setValue("unitCostPrice", String(p.costPrice));
    }
    if (updatePrices) {
      if (p.costPrice != null) setValue("newCostPrice", String(p.costPrice));
      if (p.cashPrice != null) setValue("newCashPrice", String(p.cashPrice));
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    if (!product) {
      setProductError("Selecciona un producto");
      return;
    }

    const result = await safeWrite(async () => {
      await registerEntry({
        productId: product.id,
        quantity: Number(values.quantity),
        unitCostPrice: Number(values.unitCostPrice),
        date: values.date,
        notes: values.notes || null,
      });

      if (updatePrices) {
        const cost = values.newCostPrice
          ? Number(values.newCostPrice)
          : undefined;
        const cash = values.newCashPrice
          ? Number(values.newCashPrice)
          : undefined;
        if (cost && cost > 0 && cash && cash > 0) {
          await updateProduct(product.id, {
            name: product.name,
            unitOfMeasure: product.unitOfMeasure,
            category: null,
            lowStockThreshold: null,
            costPrice: cost,
            cashPrice: cash,
            transferPrice: calculateTransferPrice(cash, transferSurchargePct),
          });
        }
      }
    });

    if (result.ok) {
      router.back();
    }
  });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Stack.Screen options={{ title: "Registrar entrada" }} />

        <ProductPicker
          label="Producto"
          value={product}
          onChange={onProductSelected}
          error={productError}
        />

        {product ? (
          <View
            style={{
              borderRadius: Radius.xl,
              backgroundColor: c.surface,
              padding: 12,
              boxShadow: Shadows.sm,
              gap: 4,
            }}
          >
            <Text variant="label">Precios actuales</Text>
            <Text variant="caption">
              Costo: ${product.costPrice ?? "—"} · Efectivo: $
              {product.cashPrice ?? "—"} · Transferencia: $
              {product.transferPrice ?? "—"}
            </Text>
          </View>
        ) : null}

        <Controller
          control={control}
          name="quantity"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label={`Cantidad${product ? ` (${product.unitOfMeasure})` : ""}`}
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
          render={({ field: { onChange, value } }) => (
            <DatePicker
              label="Fecha"
              value={value}
              onChange={onChange}
              placeholder="Seleccionar fecha"
              error={errors.date?.message}
              maxDate={format(new Date(), "yyyy-MM-dd")}
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

        <Checkbox
          checked={updatePrices}
          onPress={() => setUpdatePrices((v) => !v)}
          label="Actualizar precios del catálogo"
          activeColor={c.transfer}
        />

        {updatePrices ? (
          <View
            style={{
              gap: 12,
              borderRadius: Radius.xl,
              backgroundColor: c.transferSoft,
              padding: 12,
            }}
          >
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
          label={isSubmitting ? "Registrando…" : "Registrar entrada"}
          onPress={onSubmit}
          disabled={isSubmitting}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
