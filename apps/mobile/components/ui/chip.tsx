import { Pressable, Text, View } from "react-native";
import { Colors, FontSize, Radius, Overlay } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";

interface ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  count?: number;
  accent?: string;
}

export function Chip({
  label,
  active,
  onPress,
  count,
  accent,
}: ChipProps) {
  const c = useAppColors();
  const chipAccent = accent ?? c.tint;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: Radius.full,
        backgroundColor: active ? chipAccent : c.surface,
        borderWidth: 1,
        borderColor: active ? chipAccent : c.border,
        opacity: pressed ? 0.7 : 1,
        minHeight: 44,
        justifyContent: "center",
      })}
    >
      <Text
        style={{
          fontSize: FontSize.md,
          fontWeight: "600",
          color: active ? Colors.light.surface : c.text,
        }}
      >
        {label}
      </Text>
      {count !== undefined ? (
        <View
          style={{
            paddingHorizontal: 6,
            paddingVertical: 1,
            borderRadius: Radius.full,
            backgroundColor: active ? Overlay.strong : c.surfaceMuted,
            minWidth: 20,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              fontSize: FontSize.xs,
              fontWeight: "700",
              color: active ? Colors.light.surface : c.textMuted,
              fontVariant: ["tabular-nums"],
            }}
          >
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
