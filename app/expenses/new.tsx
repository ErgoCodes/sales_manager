import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getExpenseById, registerExpense, updateExpense } from "@/db/expenses";
import { EXPENSE_TYPES, type ExpenseType } from "@/drizzle/constants/expenses";
import { useAppColors } from "@/hooks/use-app-colors";
import { safeWrite } from "@/lib/safe-write";

const schema = z.object({
  amount: z.string().refine((v) => Number(v) > 0, "Debe ser mayor que 0"),
  concept: z.string().optional(),
  date: z
    .string()
    .min(1, "La fecha es obligatoria")
    .refine(
      (v) => v <= format(new Date(), "yyyy-MM-dd"),
      "La fecha no puede ser futura"
    ),
});

type FormValues = z.infer<typeof schema>;

export default function NewExpenseScreen() {
  const c = useAppColors();
  const [type, setType] = useState<ExpenseType>("salario");
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: "",
      concept: "",
      date: format(new Date(), "yyyy-MM-dd"),
    },
  });

  useEffect(() => {
    if (id) {
      (async () => {
        const expense = await getExpenseById(Number(id));
        if (expense) {
          setType(expense.type as ExpenseType);
          reset({
            amount: String(expense.amount),
            concept: expense.concept ?? "",
            date: expense.date,
          });
        }
      })();
    }
  }, [id, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const result = await safeWrite(
      async () => {
        if (isEdit) {
          await updateExpense(Number(id), {
            type,
            concept: values.concept || null,
            amount: Number(values.amount),
            date: values.date,
          });
        } else {
          await registerExpense({
            type,
            concept: values.concept || null,
            amount: Number(values.amount),
            date: values.date,
          });
        }
      },
      isEdit ? "Error al guardar cambios" : "No se pudo guardar"
    );

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
        <Stack.Screen
          options={{ title: isEdit ? "Editar gasto" : "Nuevo gasto" }}
        />

        <Select
          label="Tipo de gasto"
          options={EXPENSE_TYPES}
          value={type}
          onChange={(v) => setType(v as ExpenseType)}
        />

        <Controller
          control={control}
          name="concept"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Concepto (opcional)"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="Ej. Salario de junio"
              error={errors.concept?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="amount"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Monto"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              keyboardType="numeric"
              placeholder="Ej. 5000"
              error={errors.amount?.message}
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

        <Button
          label={
            isSubmitting
              ? isEdit
                ? "Guardando…"
                : "Registrando…"
              : isEdit
                ? "Guardar cambios"
                : "Registrar gasto"
          }
          onPress={onSubmit}
          disabled={isSubmitting}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
