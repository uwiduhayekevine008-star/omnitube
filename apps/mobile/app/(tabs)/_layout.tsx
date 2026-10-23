import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { theme } from "../../src/theme";
const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: "compass-outline", shorts: "play-circle-outline", community: "people-outline",
  create: "add-circle-outline", live: "radio-outline", profile: "person-circle-outline",
};
export default function TabLayout() {
  return <Tabs screenOptions={({ route }) => ({
    headerShown: false, lazy: true,
    tabBarActiveTintColor: theme.mint, tabBarInactiveTintColor: theme.subtle,
    tabBarStyle: { backgroundColor: "#0D1018", borderTopColor: theme.line, height: 62, paddingTop: 7, paddingBottom: 7, elevation: 0 },
    tabBarLabelStyle: { fontSize: 9, fontWeight: "800", marginTop: 1 },
    tabBarIcon: ({ color, size, focused }) => <Ionicons name={icons[route.name] || "ellipse"} size={focused ? size + 1 : size} color={String(color)} />,
  })}>
    <Tabs.Screen name="index" options={{ title: "Discover" }} />
    <Tabs.Screen name="shorts" options={{ title: "Shorts" }} />
    <Tabs.Screen name="community" options={{ title: "Community" }} />
    <Tabs.Screen name="create" options={{ title: "Create" }} />
    <Tabs.Screen name="live" options={{ title: "Live" }} />
    <Tabs.Screen name="profile" options={{ title: "You" }} />
  </Tabs>;
}