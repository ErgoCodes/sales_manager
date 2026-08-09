import { Pressable, Text } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { FontSize } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";

interface CheckboxProps {
  checked: boolean;
  onPress: () => void;
  label: string;
  activeColor?: string;
}

export function Checkbox({ checked, onPress, label, activeColor }: CheckboxProps) {
  const c = useAppColors();
  const tintColor = checked ? (activeColor ?? c.tint) : c.textMuted;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      hitSlop={12}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 44,
      }}
    >
      <IconSymbol
        name={checked ? "checkmark.square.fill" : "square"}
        size={22}
        color={tintColor}
      />
      <Text
        style={{
          fontSize: FontSize.md,
          fontWeight: "500",
          color: tintColor,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
