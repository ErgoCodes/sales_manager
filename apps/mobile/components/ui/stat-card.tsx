import { Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { Shadows } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";

interface StatCardProps {
  label: string;
  value: string;
  accent?: string;
  icon?: Parameters<typeof IconSymbol>[0]["name"];
  iconBg?: string;
  caption?: string;
}

export function StatCard({
  label,
  value,
  accent,
  icon,
  iconBg,
  caption,
}: StatCardProps) {
  const c = useAppColors();
  const resolvedAccent = accent ?? c.text;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.surface,
        borderRadius: 20,
        padding: 14,
        gap: 10,
        borderCurve: "continuous",
        boxShadow: Shadows.md,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            color: c.textMuted,
            letterSpacing: 0.3,
            textTransform: "uppercase",
          }}
        >
          {label}
        </Text>
        {icon ? (
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 10,
              backgroundColor: iconBg ?? `${resolvedAccent}15`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconSymbol name={icon} size={18} color={resolvedAccent} />
          </View>
        ) : null}
      </View>
      <Text
        selectable
        style={{
          fontSize: 22,
          fontWeight: "700",
          color: resolvedAccent,
          letterSpacing: -0.5,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
      {caption ? (
        <Text style={{ fontSize: 11, color: c.tabIconDefault }}>{caption}</Text>
      ) : null}
    </View>
  );
}
