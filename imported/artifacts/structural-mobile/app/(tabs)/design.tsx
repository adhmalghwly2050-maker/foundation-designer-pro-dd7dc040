import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, Platform, Modal, Pressable,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useProject, Beam, Column } from "@/context/ProjectContext";
import { StatusBadge } from "@/components/StatusBadge";
import { designBeam, designColumn } from "@/lib/structuralCalc";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

type Tab = "beams" | "columns";

export default function DesignScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentProject, addBeam, deleteBeam, addColumn, deleteColumn } = useProject();
  const [tab, setTab] = useState<Tab>("beams");
  const [showBeamForm, setShowBeamForm] = useState(false);
  const [showColumnForm, setShowColumnForm] = useState(false);

  const [bf, setBf] = useState({ b: "30", d: "60", L: "6", wd: "20", wl: "10", fc: "25", fy: "420" });
  const [cf, setCf] = useState({ b: "40", h: "40", H: "3.5", Pu: "1000", Mux: "50", Muy: "30", fc: "25", fy: "420" });

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (!currentProject) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons name="folder-open-outline" size={56} color={colors.mutedForeground} />
        <Text style={[styles.noProj, { color: colors.foreground }]}>لا يوجد مشروع محدد</Text>
        <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={() => router.push("/(tabs)/")}>
          <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>فتح المشاريع</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleAddBeam = () => {
    const b = parseFloat(bf.b), d = parseFloat(bf.d), L = parseFloat(bf.L);
    const wd = parseFloat(bf.wd), wl = parseFloat(bf.wl);
    const fc = parseFloat(bf.fc), fy = parseFloat(bf.fy);
    if ([b, d, L, wd, wl, fc, fy].some(isNaN)) { Alert.alert("تحقق من القيم"); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    addBeam({ width: b, depth: d, span: L, deadLoad: wd, liveLoad: wl, fc, fy });
    setShowBeamForm(false);
  };

  const handleAddColumn = () => {
    const b = parseFloat(cf.b), h = parseFloat(cf.h), H = parseFloat(cf.H);
    const Pu = parseFloat(cf.Pu), Mux = parseFloat(cf.Mux), Muy = parseFloat(cf.Muy);
    const fc = parseFloat(cf.fc), fy = parseFloat(cf.fy);
    if ([b, h, H, Pu, Mux, Muy, fc, fy].some(isNaN)) { Alert.alert("تحقق من القيم"); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    addColumn({ width: b, depth: h, height: H, axialLoad: Pu, momentX: Mux, momentY: Muy, fc, fy });
    setShowColumnForm(false);
  };

  const beams = currentProject.beams;
  const columns = currentProject.columns;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>{currentProject.name}</Text>
        <View style={styles.tabs}>
          {(["beams", "columns"] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tabBtn, { backgroundColor: tab === t ? colors.primary : colors.muted }]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, { color: tab === t ? "#fff" : colors.mutedForeground }]}>
                {t === "beams" ? `الجسور (${beams.length})` : `الأعمدة (${columns.length})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 100 }]}>
        {tab === "beams" ? (
          <>
            {beams.length === 0 && <EmptyState type="beams" />}
            {beams.map((beam) => <BeamCard key={beam.id} beam={beam} colors={colors} onDelete={() => deleteBeam(beam.id)} />)}
          </>
        ) : (
          <>
            {columns.length === 0 && <EmptyState type="columns" />}
            {columns.map((col) => <ColumnCard key={col.id} col={col} colors={colors} onDelete={() => deleteColumn(col.id)} />)}
          </>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary, bottom: (Platform.OS === "web" ? 34 : insets.bottom) + 90 }]}
        onPress={() => tab === "beams" ? setShowBeamForm(true) : setShowColumnForm(true)}
        activeOpacity={0.85}
      >
        <Feather name="plus" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Beam Form Modal */}
      <FormModal
        visible={showBeamForm}
        title="جسر جديد"
        onClose={() => setShowBeamForm(false)}
        onSave={handleAddBeam}
        colors={colors}
        insets={insets}
        fields={[
          { label: "العرض b (cm)", key: "b", state: bf, setState: setBf },
          { label: "الارتفاع d (cm)", key: "d", state: bf, setState: setBf },
          { label: "البحر L (m)", key: "L", state: bf, setState: setBf },
          { label: "الحمل الميت wd (kN/m)", key: "wd", state: bf, setState: setBf },
          { label: "الحمل الحي wl (kN/m)", key: "wl", state: bf, setState: setBf },
          { label: "مقاومة الخرسانة fc (MPa)", key: "fc", state: bf, setState: setBf },
          { label: "مقاومة الحديد fy (MPa)", key: "fy", state: bf, setState: setBf },
        ]}
      />

      {/* Column Form Modal */}
      <FormModal
        visible={showColumnForm}
        title="عمود جديد"
        onClose={() => setShowColumnForm(false)}
        onSave={handleAddColumn}
        colors={colors}
        insets={insets}
        fields={[
          { label: "العرض b (cm)", key: "b", state: cf, setState: setCf },
          { label: "الارتفاع h (cm)", key: "h", state: cf, setState: setCf },
          { label: "ارتفاع الدور H (m)", key: "H", state: cf, setState: setCf },
          { label: "الحمل المحوري Pu (kN)", key: "Pu", state: cf, setState: setCf },
          { label: "عزم الانحناء Mux (kN.m)", key: "Mux", state: cf, setState: setCf },
          { label: "عزم الانحناء Muy (kN.m)", key: "Muy", state: cf, setState: setCf },
          { label: "مقاومة الخرسانة fc (MPa)", key: "fc", state: cf, setState: setCf },
          { label: "مقاومة الحديد fy (MPa)", key: "fy", state: cf, setState: setCf },
        ]}
      />
    </View>
  );
}

function BeamCard({ beam, colors, onDelete }: { beam: Beam; colors: any; onDelete: () => void }) {
  const result = designBeam(beam.width, beam.depth, beam.span, beam.deadLoad, beam.liveLoad, beam.fc, beam.fy);
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.iconBox, { backgroundColor: colors.beam + "20" }]}>
          <MaterialCommunityIcons name="minus-thick" size={22} color={colors.beam} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            {beam.width}×{beam.depth} cm — L={beam.span}m
          </Text>
          <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
            fc={beam.fc} MPa · fy={beam.fy} MPa
          </Text>
        </View>
        <StatusBadge status={result.status} utilization={result.utilization} />
        <TouchableOpacity onPress={onDelete} hitSlop={12}>
          <Feather name="trash-2" size={16} color={colors.danger} />
        </TouchableOpacity>
      </View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.results}>
        <ResultPill label="Mu" value={`${result.Mu.toFixed(1)} kN·m`} color={colors} />
        <ResultPill label="As" value={`${result.As_req.toFixed(2)} cm²`} color={colors} />
        <ResultPill label="Def" value={`${result.maxDef.toFixed(1)} mm`} color={colors} />
        <ResultPill label="Av" value={`${result.Av_req.toFixed(2)} cm²/m`} color={colors} />
      </View>
    </View>
  );
}

function ColumnCard({ col, colors, onDelete }: { col: Column; colors: any; onDelete: () => void }) {
  const result = designColumn(col.width, col.depth, col.height, col.axialLoad, col.momentX, col.momentY, col.fc, col.fy);
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.iconBox, { backgroundColor: colors.column + "20" }]}>
          <MaterialCommunityIcons name="alpha-c-box-outline" size={22} color={colors.column} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            {col.width}×{col.depth} cm — H={col.height}m
          </Text>
          <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
            Pu={col.axialLoad} kN · fc={col.fc} MPa
          </Text>
        </View>
        <StatusBadge status={result.status} utilization={result.utilization} />
        <TouchableOpacity onPress={onDelete} hitSlop={12}>
          <Feather name="trash-2" size={16} color={colors.danger} />
        </TouchableOpacity>
      </View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.results}>
        <ResultPill label="Pu" value={`${result.Pu.toFixed(0)} kN`} color={colors} />
        <ResultPill label="As" value={`${result.As_req.toFixed(2)} cm²`} color={colors} />
        <ResultPill label="ρ" value={`${result.rho.toFixed(2)}%`} color={colors} />
        <ResultPill label="φPn" value={`${result.axialCapacity.toFixed(0)} kN`} color={colors} />
      </View>
    </View>
  );
}

function ResultPill({ label, value, color }: { label: string; value: string; color: any }) {
  return (
    <View style={[styles.pill, { backgroundColor: color.muted }]}>
      <Text style={[styles.pillLabel, { color: color.mutedForeground }]}>{label}</Text>
      <Text style={[styles.pillValue, { color: color.foreground }]}>{value}</Text>
    </View>
  );
}

function EmptyState({ type }: { type: Tab }) {
  const colors = useColors();
  return (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons
        name={type === "beams" ? "minus-thick" : "alpha-c-box-outline"}
        size={48}
        color={colors.mutedForeground}
      />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        {type === "beams" ? "لا توجد جسور" : "لا توجد أعمدة"}
      </Text>
      <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
        اضغط + لإضافة عنصر جديد
      </Text>
    </View>
  );
}

function FormModal({ visible, title, onClose, onSave, colors, insets, fields }: any) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            {fields.map(({ label, key, state, setState }: any) => (
              <View key={key} style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
                <TextInput
                  style={[styles.fieldInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
                  keyboardType="numeric"
                  value={state[key]}
                  onChangeText={(v) => setState((s: any) => ({ ...s, [key]: v }))}
                />
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={[styles.createBtn, { backgroundColor: colors.primary }]} onPress={onSave} activeOpacity={0.85}>
            <Text style={styles.createBtnText}>احسب وأضف</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  noProj: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  btn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  header: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, gap: 10 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  tabs: { flexDirection: "row", gap: 8 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  list: { padding: 16, gap: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBox: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  divider: { height: 1 },
  results: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignItems: "center" },
  pillLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  pillValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", elevation: 4 },
  emptyState: { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  fieldRow: { marginBottom: 10 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  fieldInput: { borderRadius: 8, borderWidth: 1, padding: 10, fontSize: 15, fontFamily: "Inter_400Regular" },
  createBtn: { borderRadius: 12, padding: 16, alignItems: "center", marginTop: 4 },
  createBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
