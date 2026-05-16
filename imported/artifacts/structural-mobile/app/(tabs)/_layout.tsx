import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useColors } from "@/hooks/useColors";

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "folder", selected: "folder.fill" }} />
        <Label>المشاريع</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="design">
        <Icon sf={{ default: "square.and.pencil", selected: "square.and.pencil" }} />
        <Label>التصميم</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calculator">
        <Icon sf={{ default: "function", selected: "function" }} />
        <Label>الحاسبة</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="results">
        <Icon sf={{ default: "chart.bar", selected: "chart.bar.fill" }} />
        <Label>النتائج</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          height: isWeb ? 84 : 60,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : null,
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: "Inter_500Medium",
          marginBottom: isWeb ? 0 : 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "المشاريع",
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="folder" tintColor={color} size={size} />
            ) : (
              <Feather name="folder" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="design"
        options={{
          title: "التصميم",
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="square.and.pencil" tintColor={color} size={size} />
            ) : (
              <Feather name="edit-2" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="calculator"
        options={{
          title: "الحاسبة",
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="function" tintColor={color} size={size} />
            ) : (
              <MaterialCommunityIcons name="calculator-variant-outline" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="results"
        options={{
          title: "النتائج",
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="chart.bar.fill" tintColor={color} size={size} />
            ) : (
              <Feather name="bar-chart-2" size={size} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}

const styles = StyleSheet.create({});
