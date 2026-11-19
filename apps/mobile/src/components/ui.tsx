import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { colors, radius, space, STATUS_COLORS } from '../lib/theme';

export function Screen({
  children,
  scroll = true,
  padded = true,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  if (!scroll) {
    return <View style={[styles.screen, padded && styles.padded]}>{children}</View>;
  }
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[padded && styles.padded, { paddingBottom: space.xxl }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={onRefresh}
            tintColor={colors.mat600}
            colors={[colors.mat600]}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <View style={{ marginBottom: space.sm }}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  const style =
    variant === 'primary' ? styles.btnPrimary : variant === 'danger' ? styles.btnDanger : styles.btnGhost;
  const textStyle =
    variant === 'ghost' ? styles.btnGhostText : variant === 'danger' ? styles.btnDangerText : styles.btnPrimaryText;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [style, (disabled || loading) && styles.btnDisabled, pressed && { opacity: 0.85 }]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'ghost' ? colors.mat700 : colors.white} />
      ) : (
        <Text style={textStyle}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Badge({ value }: { value: string | null | undefined }) {
  const tone = STATUS_COLORS[value ?? ''] ?? { bg: colors.ink100, fg: colors.ink600 };
  const label = (value ?? '—').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.badgeText, { color: tone.fg }]}>{label}</Text>
    </View>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.mat600} size="large" />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={[styles.muted, { textAlign: 'center' }]}>{message}</Text>
      {onRetry ? (
        <View style={{ marginTop: space.lg }}>
          <Button label="Try again" onPress={onRetry} variant="ghost" />
        </View>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={[styles.muted, { textAlign: 'center' }]}>{body}</Text> : null}
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric';
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.ink400}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink50 },
  padded: { padding: space.lg },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ink200,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.ink900 },
  sectionHint: { fontSize: 12, color: colors.ink500, marginTop: 2 },
  btnPrimary: {
    backgroundColor: colors.mat700,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.ink200,
  },
  btnDanger: {
    backgroundColor: colors.rose50,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  btnDisabled: { opacity: 0.45 },
  btnPrimaryText: { color: colors.white, fontWeight: '700', fontSize: 15 },
  btnGhostText: { color: colors.ink700, fontWeight: '700', fontSize: 15 },
  btnDangerText: { color: colors.rose700, fontWeight: '700', fontSize: 15 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  muted: { color: colors.ink500, fontSize: 13 },
  errorTitle: { fontSize: 16, fontWeight: '700', color: colors.ink800 },
  empty: {
    alignItems: 'center',
    padding: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.ink300,
    gap: 6,
  },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.ink700 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.ink500,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.ink200,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.ink900,
    backgroundColor: colors.white,
  },
});
