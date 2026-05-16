import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  status: "safe" | "warning" | "danger";
  utilization?: number;
}

export function StatusBadge({ status, utilization }: Props) {
  const colors = useColors();

  const config = {
    safe: { bg: colors.success + "20", text: colors.success, label: "SAFE" },
    warning: { bg: colors.warning + "20", text: colors.warning, label: "WARN" },
    danger: { bg: colors.danger + "20", text: colors.danger, label: "DANGER" },
  }[status];

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.label, { color: config.text }]}>{config.label}</Text>
      {utilization !== undefined && (
        <Text style={[styles.util, { color: config.text }]}>
          {(utilization * 100).toFixed(0)}%
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    fontFamily: "Inter_700Bold",
  },
  util: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
