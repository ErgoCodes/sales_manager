import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, parseISO, startOfMonth, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { useCallback, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { FontSize, Radius } from '@/constants/theme';
import { useAppColors } from '@/hooks/use-app-colors';

interface DatePickerProps {
  label?: string;
  value?: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  error?: string;
  clearable?: boolean;
  maxDate?: string;
}

function formatDateCompact(iso: string): string {
  try {
    const d = parseISO(iso);
    return format(d, 'd MMM yyyy', { locale: es });
  } catch {
    return iso;
  }
}

export function DatePicker({ label, value, onChange, placeholder, error, clearable, maxDate }: DatePickerProps) {
  const c = useAppColors();
  const [isOpen, setIsOpen] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => {
    try {
      return value && value.length > 0 ? parseISO(value) : new Date();
    } catch {
      return new Date();
    }
  });

  const handleSelectDate = useCallback(
    (day: Date) => {
      onChange(format(day, 'yyyy-MM-dd'));
      setIsOpen(false);
    },
    [onChange]
  );

  const handleClear = useCallback(() => {
    onChange('');
    setIsOpen(false);
  }, [onChange]);

  const handlePrevMonth = useCallback(() => {
    setDisplayMonth((prev) => subMonths(prev, 1));
  }, []);

  const handleNextMonth = useCallback(() => {
    setDisplayMonth((prev) => addMonths(prev, 1));
  }, []);

  const days = eachDayOfInterval({
    start: startOfMonth(displayMonth),
    end: endOfMonth(displayMonth),
  });

  const firstDayOfWeek = getDay(startOfMonth(displayMonth));
  const calendarDays: (Date | null)[] = Array(firstDayOfWeek)
    .fill(null)
    .concat(days);

  const today = format(new Date(), 'yyyy-MM-dd');
  const selectedDate = value && value.length > 0 ? value : null;

  const isNextMonthDisabled = maxDate
    ? format(startOfMonth(addMonths(displayMonth, 1)), 'yyyy-MM-dd') > maxDate
    : false;

  return (
    <>
      <View style={{ gap: 6 }}>
        {label ? (
          <Text style={{ fontSize: FontSize.sm, fontWeight: '500', color: c.text }}>{label}</Text>
        ) : null}
        <Pressable
          onPress={() => setIsOpen(true)}
          style={({ pressed }) => ({
            borderWidth: 1.5,
            borderColor: error ? c.danger : c.border,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 12,
            backgroundColor: c.surface,
            borderCurve: 'continuous',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ fontSize: FontSize.base, color: value ? c.text : c.tabIconDefault }}>
            {value ? formatDateCompact(value) : placeholder || 'Seleccionar fecha'}
          </Text>
        </Pressable>
        {error ? <Text style={{ fontSize: FontSize.sm, color: c.danger }}>{error}</Text> : null}
      </View>

      <Modal visible={isOpen} transparent animationType="slide" onRequestClose={() => setIsOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View
            style={{
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              backgroundColor: c.surface,
              padding: 20,
              gap: 16,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Pressable
                onPress={handlePrevMonth}
                hitSlop={6}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  borderRadius: Radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? c.surfaceMuted : 'transparent',
                })}
              >
                <IconSymbol
                  name="chevron.right"
                  size={18}
                  color={c.textMuted}
                  style={{ transform: [{ rotate: '180deg' }] }}
                />
              </Pressable>
              <Text style={{ fontSize: FontSize.lg, fontWeight: '700', color: c.text }}>
                {format(displayMonth, 'MMMM yyyy', { locale: es })}
              </Text>
              <Pressable
                onPress={handleNextMonth}
                disabled={isNextMonthDisabled}
                hitSlop={6}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  borderRadius: Radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? c.surfaceMuted : 'transparent',
                  opacity: isNextMonthDisabled ? 0.3 : pressed ? 0.7 : 1,
                })}
              >
                <IconSymbol name="chevron.right" size={18} color={c.textMuted} />
              </Pressable>
            </View>

            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 4 }}>
                {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day) => (
                  <Text
                    key={day}
                    style={{
                      width: '14.285%',
                      textAlign: 'center',
                      fontSize: FontSize.xs,
                      fontWeight: '500',
                      color: c.textMuted,
                    }}
                  >
                    {day}
                  </Text>
                ))}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' }}>
                {calendarDays.map((day, idx) => {
                  if (day === null) {
                    return (
                      <View
                        key={`empty-${idx}`}
                        style={{
                          width: '14.285%',
                          aspectRatio: 1,
                        }}
                      />
                    );
                  }
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const isSelected = dateStr === selectedDate;
                  const isToday = dateStr === today;
                  const isDisabled = maxDate ? dateStr > maxDate : false;

                  return (
                    <Pressable
                      key={dateStr}
                      onPress={() => handleSelectDate(day)}
                      disabled={isDisabled}
                      style={({ pressed }) => ({
                        width: '14.285%',
                        aspectRatio: 1,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: Radius.md,
                        backgroundColor: isSelected ? c.tint : isToday ? c.surfaceMuted : 'transparent',
                        opacity: isDisabled ? 0.3 : pressed ? 0.7 : 1,
                      })}
                    >
                      <Text
                        style={{
                          fontSize: FontSize.md,
                          fontWeight: isSelected ? '700' : '400',
                          color: isSelected ? 'white' : c.text,
                        }}
                      >
                        {format(day, 'd')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <Pressable
                onPress={() => setIsOpen(false)}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: Radius.md,
                  borderWidth: 1,
                  borderColor: c.border,
                  alignItems: 'center',
                  backgroundColor: pressed ? c.surfaceMuted : 'transparent',
                })}
              >
                <Text style={{ fontSize: FontSize.base, fontWeight: '500', color: c.text }}>Cerrar</Text>
              </Pressable>
              {clearable ? (
                <Pressable
                  onPress={handleClear}
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: Radius.md,
                    alignItems: 'center',
                    backgroundColor: pressed ? c.dangerSoft : c.surface,
                    borderWidth: 1,
                    borderColor: c.danger,
                  })}
                >
                  <Text style={{ fontSize: FontSize.base, fontWeight: '500', color: c.danger }}>Borrar</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
