import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ScrollView } from 'react-native';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EXPENSE_TYPES, type ExpenseType } from '@/constants/expenses';
import { registerExpense } from '@/db/expenses';

const schema = z.object({
  amount: z.string().refine((v) => Number(v) > 0, 'Debe ser mayor que 0'),
  concept: z.string().optional(),
  date: z.string().min(1, 'La fecha es obligatoria'),
});

type FormValues = z.infer<typeof schema>;

export default function NewExpenseScreen() {
  const [type, setType] = useState<ExpenseType>('salario');

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: '',
      concept: '',
      date: format(new Date(), 'yyyy-MM-dd'),
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    await registerExpense({
      type,
      concept: values.concept || null,
      amount: Number(values.amount),
      date: values.date,
    });
    router.back();
  });

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-slate-950" contentContainerClassName="p-4 gap-4">
      <Stack.Screen options={{ title: 'Nuevo gasto' }} />

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

      <Button
        label={isSubmitting ? 'Registrando…' : 'Registrar gasto'}
        onPress={onSubmit}
        disabled={isSubmitting}
      />
    </ScrollView>
  );
}
