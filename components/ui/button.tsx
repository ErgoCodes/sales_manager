import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableProps,
} from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, FontSize, Radius } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";

type Variant = "default" | "soft" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends PressableProps {
  variant?: Variant;
  size?: Size;
  label: string;
  icon?: Parameters<typeof IconSymbol>[0]["name"];
  loading?: boolean;
}

const sizeStyles: Record<
  Size,
  {
    paddingHorizontal: number;
    paddingVertical: number;
    borderRadius: number;
    fontSize: number;
    iconSize: number;
    minHeight: number;
  }
> = {
  sm: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.md,
    fontSize: FontSize.sm,
    iconSize: 16,
    minHeight: 36,
  },
  md: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    fontSize: FontSize.base,
    iconSize: 18,
    minHeight: 46,
  },
  lg: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: Radius.xl,
    fontSize: FontSize.base,
    iconSize: 20,
    minHeight: 52,
  },
};

export function Button({
  variant = "default",
  size = "md",
  label,
  icon,
  loading,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const c = useAppColors();
  const sizing = sizeStyles[size];
  const isDisabled = disabled || loading;

  const iconColors: Record<Variant, string> = {
    default: Colors.light.surface,
    soft: c.tint,
    outline: c.tint,
    ghost: c.text,
    destructive: Colors.light.surface,
  };

  return (
    <Pressable
      style={(state) => {
        const { pressed } = state;
        let bg = "transparent";
        let borderColor = "transparent";
        let borderWidth = 0;

        if (variant === "default") {
          bg = pressed ? (c.scheme === "dark" ? "#2DD4BF" : "#115E59") : c.tint;
        } else if (variant === "soft") {
          bg = pressed
            ? c.scheme === "dark"
              ? "#0F766E"
              : "#CCFBF1"
            : c.tealSoft;
        } else if (variant === "outline") {
          bg = pressed ? c.surfaceMuted : c.surface;
          borderColor = c.tint;
          borderWidth = 1;
        } else if (variant === "ghost") {
          bg = pressed ? c.surfaceMuted : "transparent";
        } else if (variant === "destructive") {
          bg = pressed ? c.dangerDark : c.danger;
        }

        return [
          {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            backgroundColor: bg,
            borderColor,
            borderWidth,
            paddingHorizontal: sizing.paddingHorizontal,
            paddingVertical: sizing.paddingVertical,
            borderRadius: sizing.borderRadius,
            minHeight: sizing.minHeight,
            borderCurve: "continuous",
            opacity: isDisabled ? 0.5 : 1,
          },
          typeof style === "function" ? style(state) : style,
        ];
      }}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={iconColors[variant]} />
      ) : icon ? (
        <IconSymbol
          name={icon}
          size={sizing.iconSize}
          color={iconColors[variant]}
        />
      ) : null}

      <Text
        style={{
          color:
            variant === "default" || variant === "destructive"
              ? Colors.light.surface
              : variant === "ghost"
                ? c.text
                : c.tint,
          fontSize: sizing.fontSize,
          fontWeight: size === "lg" ? "700" : "600",
          letterSpacing: size === "lg" ? 0.3 : 0,
        }}
      >
        {label}
      </Text>
      <View />
    </Pressable>
  );
}
