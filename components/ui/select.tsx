import { Pressable, Text, View } from "react-native";

import { FontSize, Radius } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";

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
export function Select({
  label,
  options,
  value,
  onChange,
  error,
}: SelectProps) {
  const c = useAppColors();

  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text
          style={{ fontSize: FontSize.sm, fontWeight: "500", color: c.text }}
        >
          {label}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={({ pressed }) => ({
                borderRadius: Radius.full,
                borderWidth: 1,
                paddingHorizontal: 14,
                paddingVertical: 8,
                backgroundColor: selected ? c.tint : c.surface,
                borderColor: selected ? c.tint : c.border,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  color: selected ? "white" : c.text,
                  fontWeight: "500",
                  fontSize: FontSize.sm,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text style={{ fontSize: FontSize.sm, color: c.danger }}>{error}</Text>
      ) : null}
    </View>
  );
}
