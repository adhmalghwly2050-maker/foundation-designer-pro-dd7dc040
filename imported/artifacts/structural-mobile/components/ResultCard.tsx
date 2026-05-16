import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

interface ResultRow {
  label: string;
  value: string;
  highlight?: boolean;
}

interface Props {
  rows: ResultRow[];
}

export function ResultCard({ rows }: Props) {
  const colors = useColors();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {rows.map((row, i) => (
        <View
          key={i}
          style={[
            styles.row,
            i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
            row.highlight && { backgroundColor: colors.primary + "10" },
          ]}
        >
          <Text style={[styles.label, { color: colors.mutedForeground }]}>{row.label}</Text>
          <Text style={[styles.value, { color: row.highlight ? colors.primary : colors.foreground }]}>
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  label: { fontSize: 13, fontFamily: "Inter_400Regular" },
  value: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
