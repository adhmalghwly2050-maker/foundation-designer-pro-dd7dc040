import React from "react";
import {
  View, Text, StyleSheet, ScrollView, Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useProject } from "@/context/ProjectContext";
import { designBeam, designColumn } from "@/lib/structuralCalc";
import { UtilizationBar } from "@/components/UtilizationBar";
import { StatusBadge } from "@/components/StatusBadge";

export default function ResultsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentProject } = useProject();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (!currentProject) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons name="chart-bar" size={56} color={colors.mutedForeground} />
        <Text style={[styles.noProj, { color: colors.foreground }]}>لا يوجد مشروع محدد</Text>
      </View>
    );
  }

  const beamResults = currentProject.beams.map((b) => ({
    beam: b,
    result: designBeam(b.width, b.depth, b.span, b.deadLoad, b.liveLoad, b.fc, b.fy),
  }));
  const colResults = currentProject.columns.map((c) => ({
    col: c,
    result: designColumn(c.width, c.depth, c.height, c.axialLoad, c.momentX, c.momentY, c.fc, c.fy),
  }));

  const totalElements = beamResults.length + colResults.length;
  const safeCount = [...beamResults, ...colResults].filter((r) => r.result.status === "safe").length;
  const warnCount = [...beamResults, ...colResults].filter((r) => r.result.status === "warning").length;
  const dangerCount = [...beamResults, ...colResults].filter((r) => r.result.status === "danger").length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>النتائج التفصيلية</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>{currentProject.name}</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 100 }]}>
        {/* Summary */}
        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>ملخص المشروع</Text>
          <View style={styles.statsRow}>
            <StatBox label="إجمالي" value={totalElements} color={colors.primary} colors={colors} />
            <StatBox label="آمن" value={safeCount} color={colors.success} colors={colors} />
            <StatBox label="تحذير" value={warnCount} color={colors.warning} colors={colors} />
            <StatBox label="خطر" value={dangerCount} color={colors.danger} colors={colors} />
          </View>
        </View>

        {/* Beams */}
        {beamResults.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              الجسور ({beamResults.length})
            </Text>
            {beamResults.map(({ beam, result }, i) => (
              <View key={beam.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.iconBox, { backgroundColor: colors.beam + "20" }]}>
                    <Text style={[styles.indexText, { color: colors.beam }]}>B{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                      {beam.width}×{beam.depth} cm — L={beam.span}m
                    </Text>
                  </View>
                  <StatusBadge status={result.status} utilization={result.utilization} />
                </View>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <UtilizationBar
                  label="عزم الانحناء"
                  value={result.Mu / result.momentCapacity}
                  demand={result.Mu}
                  capacity={result.momentCapacity}
                  unit="kN·m"
                />
                <UtilizationBar
                  label="قوة القص"
                  value={result.Vu / result.shearCapacity}
                  demand={result.Vu}
                  capacity={result.shearCapacity}
                  unit="kN"
                />
                <View style={styles.pills}>
                  <InfoPill label="As المطلوب" value={`${result.As_req.toFixed(2)} cm²`} colors={colors} />
                  <InfoPill label="Av الكانات" value={`${result.Av_req.toFixed(2)} cm²/m`} colors={colors} />
                  <InfoPill label="الهبوط" value={`${result.maxDef.toFixed(1)} mm`} colors={colors} />
                </View>
                {result.messages.map((m, j) => (
                  <Text key={j} style={[styles.msg, { color: m.includes("✓") ? colors.success : colors.warning }]}>{m}</Text>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* Columns */}
        {colResults.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              الأعمدة ({colResults.length})
            </Text>
            {colResults.map(({ col, result }, i) => (
              <View key={col.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.iconBox, { backgroundColor: colors.column + "20" }]}>
                    <Text style={[styles.indexText, { color: colors.column }]}>C{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                      {col.width}×{col.depth} cm — H={col.height}m
                    </Text>
                  </View>
                  <StatusBadge status={result.status} utilization={result.utilization} />
                </View>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <UtilizationBar
                  label="الطاقة الاستيعابية"
                  value={result.utilization}
                  demand={result.Pu}
                  capacity={result.axialCapacity}
                  unit="kN"
                />
                <View style={styles.pills}>
                  <InfoPill label="As المطلوب" value={`${result.As_req.toFixed(2)} cm²`} colors={colors} />
                  <InfoPill label="نسبة التسليح" value={`${result.rho.toFixed(2)}%`} colors={colors} />
                  <InfoPill label="φPn" value={`${result.axialCapacity.toFixed(0)} kN`} colors={colors} />
                </View>
                {result.messages.map((m, j) => (
                  <Text key={j} style={[styles.msg, { color: m.includes("✓") ? colors.success : colors.warning }]}>{m}</Text>
                ))}
              </View>
            ))}
          </View>
        )}

        {totalElements === 0 && (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="chart-bar" size={56} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>لا توجد عناصر</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>أضف جسور أو أعمدة من شاشة التصميم</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function StatBox({ label, value, color, colors }: { label: string; value: number; color: string; colors: any }) {
  return (
    <View style={[styles.statBox, { backgroundColor: color + "15" }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function InfoPill({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={[styles.infoPill, { backgroundColor: colors.muted }]}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  noProj: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  header: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  content: { padding: 16, gap: 16 },
  summary: { borderRadius: 14, borderWidth: 1, padding: 16 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 12 },
  statsRow: { flexDirection: "row", gap: 8 },
  statBox: { flex: 1, alignItems: "center", borderRadius: 10, paddingVertical: 10 },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  section: { gap: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBox: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  indexText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  divider: { height: 1, marginVertical: 2 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  infoPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  infoLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  msg: { fontSize: 12, fontFamily: "Inter_400Regular" },
  emptyState: { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
});
