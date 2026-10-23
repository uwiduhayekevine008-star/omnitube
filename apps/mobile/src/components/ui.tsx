import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";
import { initials } from "../lib/media";
import type { Profile } from "../lib/types";
import { Image } from "expo-image";

export function AppScreen({ children, scroll = false, style }: { children: ReactNode; scroll?: boolean; style?: ViewStyle }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.screen, { paddingTop: Math.max(insets.top, 10) }, style]}>{children}</View>;
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return <View style={styles.brand}><View style={styles.brandMark}><Ionicons name="play" size={compact ? 13 : 17} color="#081510" /></View>{!compact && <Text style={styles.brandText}>omni<Text style={styles.brandAccent}>tube</Text></Text>}</View>;
}
export function Avatar({ profile, size = 42 }: { profile?: Profile | null; size?: number }) {
  return <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
    {profile?.avatar_url ? <Image source={{ uri: profile.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" /> :
      <Text style={[styles.avatarInitials, { fontSize: Math.max(10, size * 0.28) }]}>{initials(profile?.display_name)}</Text>}
  </View>;
}
type ButtonProps = PressableProps & { title: string; icon?: keyof typeof Ionicons.glyphMap; variant?: "primary" | "secondary" | "quiet" | "danger"; busy?: boolean; textStyle?: TextStyle };
const buttonVariantStyles = {
  primary: styles.button_primary,
  secondary: styles.button_secondary,
  quiet: styles.button_quiet,
  danger: styles.button_danger,
} as const;
export function ActionButton({ title, icon, variant = "primary", busy, disabled, textStyle, style, ...props }: ButtonProps) {
  return <Pressable accessibilityRole="button" disabled={disabled || busy} style={({ pressed }) => [
    styles.button, buttonVariantStyles[variant], pressed && !disabled ? styles.buttonPressed : null, typeof style === "function" ? style({ pressed }) : style,
  ]} {...props}>
    {busy ? <ActivityIndicator size="small" color={variant === "primary" ? "#071712" : theme.mint} /> : icon ? <Ionicons name={icon} size={17} color={variant === "primary" ? "#071712" : variant === "danger" ? theme.coral : theme.mint} /> : null}
    <Text style={[styles.buttonText, variant === "primary" ? styles.buttonTextPrimary : null, variant === "danger" ? { color: theme.coral } : null, textStyle]}>{busy ? "Please wait…" : title}</Text>
  </Pressable>;
}
export function Eyebrow({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[styles.eyebrow, style]}>{children}</Text>;
}
export function EmptyState({ icon = "sparkles-outline", title, detail, action }: { icon?: keyof typeof Ionicons.glyphMap; title: string; detail: string; action?: ReactNode }) {
  return <View style={styles.empty}>
    <View style={styles.emptyIcon}><Ionicons name={icon} size={25} color={theme.violet} /></View>
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyDetail}>{detail}</Text>
    {action}
  </View>;
}
export function SectionTitle({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <View style={styles.sectionTitle}>
    <View style={{ flex: 1 }}><Text style={styles.sectionTitleText}>{title}</Text>{detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}</View>
    {action}
  </View>;
}
export function Surface({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.surface, style]}>{children}</View>;
}
export const ui = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  grow: { flex: 1 },
  muted: { color: theme.muted },
  h2: { fontSize: 23, fontWeight: "800", color: theme.text, letterSpacing: -0.7 },
  small: { fontSize: 11, color: theme.muted },
  separator: { height: 1, backgroundColor: theme.line },
  input: { height: 48, paddingHorizontal: 14, borderWidth: 1, borderColor: theme.line, borderRadius: 13, backgroundColor: theme.panel, color: theme.text, fontSize: 14 },
  multiline: { minHeight: 100, paddingTop: 13, textAlignVertical: "top" },
  pill: { borderRadius: 99, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel2 },
  pillText: { color: theme.muted, fontSize: 11, fontWeight: "700" },
});
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  brand: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandMark: { width: 31, height: 31, borderRadius: 10, backgroundColor: theme.mint, justifyContent: "center", alignItems: "center" },
  brandText: { fontSize: 21, fontWeight: "900", letterSpacing: -1, color: theme.text },
  brandAccent: { color: theme.mint },
  avatar: { overflow: "hidden", borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel3, justifyContent: "center", alignItems: "center" },
  avatarInitials: { fontWeight: "800", color: theme.mint },
  button: { minHeight: 43, borderRadius: 13, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1 },
  button_primary: { backgroundColor: theme.mint, borderColor: theme.mint },
  button_secondary: { backgroundColor: theme.panel2, borderColor: theme.line },
  button_quiet: { backgroundColor: "transparent", borderColor: theme.line },
  button_danger: { backgroundColor: "#FF8A9D12", borderColor: "#FF8A9D45" },
  buttonPressed: { opacity: 0.84, transform: [{ scale: 0.985 }] },
  buttonText: { color: theme.text, fontWeight: "800", fontSize: 12 },
  buttonTextPrimary: { color: "#071712" },
  eyebrow: { color: theme.mint, fontSize: 9, fontWeight: "900", letterSpacing: 1.7, textTransform: "uppercase" },
  empty: { alignItems: "center", justifyContent: "center", paddingHorizontal: 27, paddingVertical: 42, minHeight: 260 },
  emptyIcon: { width: 54, height: 54, borderRadius: 17, backgroundColor: "#A99AFF14", borderWidth: 1, borderColor: "#A99AFF32", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: theme.text, fontSize: 17, fontWeight: "800", marginTop: 17, textAlign: "center" },
  emptyDetail: { color: theme.muted, fontSize: 12, lineHeight: 19, marginTop: 8, textAlign: "center", maxWidth: 330 },
  surface: { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel, borderRadius: 17, padding: 15 },
  sectionTitle: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 24, marginBottom: 13 },
  sectionTitleText: { color: theme.text, fontSize: 17, fontWeight: "800" },
  sectionDetail: { marginTop: 4, color: theme.muted, fontSize: 11, lineHeight: 17 },
});