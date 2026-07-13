import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { Pressable, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, FontSize, Radius, Shadows } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";

const ISO = "yyyy-MM-dd";
const WEEK_OPTS = { weekStartsOn: 1 as const };

export type PeriodMode = "week" | "month" | "custom";

export interface Period {
  mode: PeriodMode;
  /** Inicio del período, 'yyyy-MM-dd' inclusive. */
  from: string;
  /** Fin del período, 'yyyy-MM-dd' inclusive. */
  to: string;
}

/** Semana (lunes a domingo) que contiene la fecha de referencia. */
export function makeWeek(ref: Date): Period {
  return {
    mode: "week",
    from: format(startOfWeek(ref, WEEK_OPTS), ISO),
    to: format(endOfWeek(ref, WEEK_OPTS), ISO),
  };
}

/** Mes calendario que contiene la fecha de referencia. */
export function makeMonth(ref: Date): Period {
  return {
    mode: "month",
    from: format(startOfMonth(ref), ISO),
    to: format(endOfMonth(ref), ISO),
  };
}

export function currentWeek(): Period {
  return makeWeek(new Date());
}

export function currentMonth(): Period {
  return makeMonth(new Date());
}

function isCurrent(period: Period): boolean {
  if (period.mode === "week") return period.from === currentWeek().from;
  if (period.mode === "month") return period.from === currentMonth().from;
  return false;
}

/** Etiqueta legible del período (rango de días para semana, mes+año para mes). */
function periodLabel(period: Period): string {
  const from = parseISO(period.from);
  const to = parseISO(period.to);
  if (period.mode === "month") {
    const txt = format(from, "MMMM yyyy", { locale: es });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }
  return `${format(from, "d 'de' MMM", { locale: es })} — ${format(to, "d 'de' MMM", { locale: es })}`;
}

interface PeriodBarProps {
  value: Period;
  onChange: (next: Period) => void;
}

/**
 * Selector de período para los reportes de rango (semana / mes / rango
 * personalizado). Análogo a `DateBar` pero sobre intervalos: los presets fijan
 * el granularidad y el stepper desplaza semana a semana o mes a mes. En modo
 * "Rango" se editan los extremos con dos steppers de un día.
 */
export function PeriodBar({ value, onChange }: PeriodBarProps) {
  const c = useAppColors();

  const modes: { key: PeriodMode; label: string }[] = [
    { key: "week", label: "Semana" },
    { key: "month", label: "Mes" },
    { key: "custom", label: "Rango" },
  ];

  const selectMode = (mode: PeriodMode) => {
    if (mode === value.mode) return;
    if (mode === "week") onChange(currentWeek());
    else if (mode === "month") onChange(currentMonth());
    else onChange({ mode: "custom", from: value.from, to: value.to });
  };

  const step = (direction: -1 | 1) => {
    const ref = parseISO(value.from);
    if (value.mode === "week") onChange(makeWeek(addWeeks(ref, direction)));
    else if (value.mode === "month")
      onChange(makeMonth(addMonths(ref, direction)));
  };

  const stepEndpoint = (endpoint: "from" | "to", direction: -1 | 1) => {
    const nextDate = format(addDays(parseISO(value[endpoint]), direction), ISO);
    const next: Period = { ...value, [endpoint]: nextDate };
    // Mantener el rango coherente (from <= to).
    if (next.from > next.to) {
      if (endpoint === "from") next.to = next.from;
      else next.from = next.to;
    }
    onChange(next);
  };

  const arrowButton = (direction: -1 | 1, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: Radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? c.surfaceMuted : "transparent",
      })}
    >
      <IconSymbol
        name="chevron.right"
        size={18}
        color={c.textMuted}
        style={
          direction === -1 ? { transform: [{ rotate: "180deg" }] } : undefined
        }
      />
    </Pressable>
  );

  return (
    <View style={{ gap: 8 }}>
      {/* Segmented mode selector */}
      <View
        style={{
          flexDirection: "row",
          backgroundColor: c.surface,
          borderRadius: Radius.lg,
          padding: 4,
          gap: 4,
          borderCurve: "continuous",
          boxShadow: Shadows.sm,
        }}
      >
        {modes.map((m) => {
          const active = m.key === value.mode;
          return (
            <Pressable
              key={m.key}
              onPress={() => selectMode(m.key)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: Radius.md,
                alignItems: "center",
                backgroundColor: active ? c.tint : "transparent",
              }}
            >
              <Text
                style={{
                  fontSize: FontSize.base,
                  fontWeight: "700",
                  color: active ? Colors.light.surface : c.textMuted,
                }}
              >
                {m.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {value.mode === "custom" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["from", "to"] as const).map((endpoint) => (
            <View
              key={endpoint}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: c.surface,
                borderRadius: Radius.lg,
                padding: 6,
                borderCurve: "continuous",
                boxShadow: Shadows.sm,
              }}
            >
              {arrowButton(-1, () => stepEndpoint(endpoint, -1))}
              <View style={{ flex: 1, alignItems: "center", gap: 1 }}>
                <Text
                  style={{ fontSize: FontSize.xs, color: c.tabIconDefault }}
                >
                  {endpoint === "from" ? "Desde" : "Hasta"}
                </Text>
                <Text
                  style={{
                    fontSize: FontSize.md,
                    fontWeight: "700",
                    color: c.text,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {format(parseISO(value[endpoint]), "d MMM", { locale: es })}
                </Text>
              </View>
              {arrowButton(1, () => stepEndpoint(endpoint, 1))}
            </View>
          ))}
        </View>
      ) : (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: c.surface,
            borderRadius: Radius.lg,
            padding: 6,
            gap: 4,
            borderCurve: "continuous",
            boxShadow: Shadows.sm,
          }}
        >
          {arrowButton(-1, () => step(-1))}
          <View style={{ flex: 1, alignItems: "center", gap: 1 }}>
            <Text
              style={{
                fontSize: FontSize.base,
                fontWeight: "700",
                color: c.text,
              }}
            >
              {periodLabel(value)}
            </Text>
            <Text
              style={{
                fontSize: FontSize.xs,
                color: c.tabIconDefault,
                fontVariant: ["tabular-nums"],
              }}
            >
              {value.from} → {value.to} {isCurrent(value) ? "· Actual" : ""}
            </Text>
          </View>
          {arrowButton(1, () => step(1))}
        </View>
      )}
    </View>
  );
}
