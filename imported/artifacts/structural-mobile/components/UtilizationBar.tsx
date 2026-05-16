import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  label: string;
  value: number; // 0–1
  capacity: number;
  demand: number;
  unit: string;
}

export function UtilizationBar({ label, value, capacity, demand, unit }: Props) {
  const colors = useColors();
  const clamped = Math.min(value, 1.2);
  const pct = Math.min(clamped / 1.2, 1) * 100;
  const color = value > 1 ? colors.danger : value > 0.85 ? colors.warning : colors.success;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.ratio, { color }]}>{(value * 100).toFixed(0)}%</Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        <View style={[styles.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
        <View style={[styles.limitLine, { left: "83.3%" as any, backgroundColor: colors.warning }]} />
      </View>
      <View style={styles.footer}>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {demand.toFixed(1)} / {capacity.toFixed(1)} {unit}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  ratio: { fontSize: 13, fontFamily: "Inter_700Bold" },
  track: { height: 8, borderRadius: 4, overflow: "hidden", position: "relative" },
  fill: { height: "100%", borderRadius: 4 },
  limitLine: { position: "absolute", top: 0, bottom: 0, width: 1.5 },
  footer: { marginTop: 3 },
  sub: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
