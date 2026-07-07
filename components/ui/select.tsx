import { Pressable, Text, View } from 'react-native';

export interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps {
  label?: string;
  options: readonly SelectOption[];
  value?: string;
  onChange: (value: string) => void;
  error?: string;
}

/** Selector de chips para conjuntos pequeños de opciones (unidad, categoría). */
export function Select({ label, options, value, onChange, error }: SelectProps) {
  return (
    <View className="gap-1.5">
      {label ? <Text className="text-sm font-medium text-gray-700 dark:text-slate-300">{label}</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              className={`rounded-full border px-3.5 py-2 ${
                selected
                  ? 'border-primary bg-primary'
                  : 'border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900'
              }`}>
              <Text className={selected ? 'text-white font-medium' : 'text-gray-700 dark:text-slate-300'}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text className="text-sm text-red-500">{error}</Text> : null}
    </View>
  );
}
