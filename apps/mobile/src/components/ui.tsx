import { type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, type TextStyle, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space, useTheme } from '../theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const style = { flex: 1, backgroundColor: t.bg } as const;
  if (!scroll) return <View style={[style, { paddingBottom: insets.bottom }]}>{children}</View>;
  return (
    <ScrollView style={style} contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 96, gap: space.lg }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.card, borderRadius: 14, padding: space.lg, gap: space.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border }, style]}>{children}</View>;
}

export function H1({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const t = useTheme();
  return <Text style={[{ fontSize: 28, fontWeight: '700', color: t.text }, style]}>{children}</Text>;
}
export function H2({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ fontSize: 13, fontWeight: '600', color: t.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{children}</Text>;
}
export function Body({ children, muted, style, numberOfLines }: { children: ReactNode; muted?: boolean; style?: TextStyle; numberOfLines?: number }) {
  const t = useTheme();
  return <Text numberOfLines={numberOfLines} style={[{ fontSize: 16, color: muted ? t.muted : t.text }, style]}>{children}</Text>;
}
export function Amount({ children, tone = 'neutral', size = 16 }: { children: ReactNode; tone?: 'positive' | 'negative' | 'neutral'; size?: number }) {
  const t = useTheme();
  const color = tone === 'positive' ? t.positive : tone === 'negative' ? t.negative : t.text;
  return <Text style={{ fontSize: size, fontWeight: '600', color, fontVariant: ['tabular-nums'] }}>{children}</Text>;
}

export function Chip({ label, selected, onPress, disabled }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected, disabled: disabled ?? false }}
      style={({ pressed }) => ({
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, minHeight: 44, justifyContent: 'center',
        backgroundColor: selected ? t.chipOn : t.chip, opacity: pressed || disabled ? 0.6 : 1,
      })}>
      <Text style={{ color: selected ? t.onPrimary : t.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Button({ label, onPress, kind = 'primary', disabled }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.primary : kind === 'danger' ? t.danger : t.chip;
  const fg = kind === 'secondary' ? t.text : t.onPrimary;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={({ pressed }) => ({ backgroundColor: bg, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12, alignItems: 'center', minHeight: 48, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 })}>
      <Text style={{ color: fg, fontWeight: '700', fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginVertical: space.xs }} />;
}
