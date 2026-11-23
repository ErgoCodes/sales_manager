// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { SFSymbol, SymbolWeight } from 'expo-symbols';
import { ComponentProps } from 'react';
import type { ColorValue, StyleProp, TextStyle } from 'react-native';

type IconMapping = Partial<Record<SFSymbol, ComponentProps<typeof MaterialIcons>['name']>>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  'house.fill': 'home',
  'shippingbox.fill': 'inventory-2',
  'cart.fill': 'shopping-cart',
  'dollarsign.circle.fill': 'payments',
  'chart.bar.fill': 'bar-chart',
  'gearshape.fill': 'settings',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  'plus': 'add',
  'arrow.left.arrow.right.circle.fill': 'swap-horiz',
  'square.grid.2x2': 'apps',
  'clock.arrow.circlepath': 'history',
  'exclamationmark.triangle.fill': 'warning',
  'archivebox.fill': 'inbox',
  'creditcard.fill': 'credit-card',
  'bag.fill': 'shopping-bag',
  'tag.fill': 'sell',
  'sparkles': 'auto-awesome',
  'arrow.up.right': 'arrow-outward',
  'calendar': 'calendar-today',
  'magnifyingglass': 'search',
  'checkmark.circle.fill': 'check-circle',
  'xmark.circle.fill': 'cancel',
  'square.and.arrow.up': 'ios-share',
  'checkmark.square.fill': 'check-box',
  'square': 'check-box-outline-blank',
  'eye.fill': 'visibility',
  'eye.slash.fill': 'visibility-off',
} satisfies IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: ColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  // Navigators hand icons a generic ColorValue; MaterialIcons types a narrower one that renders the same.
  return <MaterialIcons color={color as ComponentProps<typeof MaterialIcons>['color']} size={size} name={MAPPING[name]} style={style} />;
}
