import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { designBeam, designColumn } from "@/lib/structuralCalc";
import { StatusBadge } from "@/components/StatusBadge";
import { UtilizationBar } from "@/components/UtilizationBar";
import { ResultCard } from "@/components/ResultCard";
import * as Haptics from "expo-haptics";

type CalcType = "beam" | "column";

export default function CalculatorScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [calcType, setCalcType] = useState<CalcType>("beam");
  const [beamCalcDone, setBeamCalcDone] = useState(false);
  const [colCalcDone, setColCalcDone] = useState(false);

  const [bf, setBf] = useState({ b: "30", d: "60", L: "6", wd: "20", wl: "10", fc: "25", fy: "420" });
  const [cf, setCf] = useState({ b: "40", h: "40", H: "3.5", Pu: "1000", Mux: "50", Muy: "30", fc: "25", fy: "420" });

  const beamResult = beamCalcDone
    ? designBeam(+bf.b, +bf.d, +bf.L, +bf.wd, +bf.wl, +bf.fc, +bf.fy)
    : null;

  const colResult = colCalcDone
    ? designColumn(+cf.b, +cf.h, +cf.H, +cf.Pu, +cf.Mux, +cf.Muy, +cf.fc, +cf.fy)
    : null;

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const Field = ({ label, stateKey, state, setState, unit }: any) => (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.muted }]}>
        <TextInput
          style={[styles.input, { color: colors.foreground }]}
          keyboardType="numeric"
          value={state[stateKey]}
          onChangeText={(v) => { setState((s: any) => ({ ...s, [stateKey]: v })); setBeamCalcDone(false); setColCalcDone(false); }}
        />
        {unit && <Text style={[styles.unit, { color: colors.mutedForeground }]}>{unit}</Text>}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>الحاسبة الإنشائية</Text>
        <View style={styles.typeTabs}>
          {(["beam", "column"] as CalcType[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.typeTab, { backgroundColor: calcType === t ? colors.primary : colors.muted }]}
              onPress={() => setCalcType(t)}
            >
              <MaterialCommunityIcons
                name={t === "beam" ? "minus-thick" : "alpha-c-box-outline"}
                size={16}
                color={calcType === t ? "#fff" : colors.mutedForeground}
              />
              <Text style={[styles.typeTabText, { color: calcType === t ? "#fff" : colors.mutedForeground }]}>
                {t === "beam" ? "جسر" : "عمود"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 100 }]}>
        {calcType === "beam" ? (
          <>
            <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.formTitle, { color: colors.foreground }]}>مواصفات الجسر</Text>
              <Field label="عرض الجسر b" stateKey="b" state={bf} setState={setBf} unit="cm" />
              <Field label="ارتفاع الجسر d" stateKey="d" state={bf} setState={setBf} unit="cm" />
              <Field label="البحر L" stateKey="L" state={bf} setState={setBf} unit="m" />
              <Field label="الحمل الميت wd" stateKey="wd" state={bf} setState={setBf} unit="kN/m" />
              <Field label="الحمل الحي wl" stateKey="wl" state={bf} setState={setBf} unit="kN/m" />
              <Field label="مقاومة الخرسانة fc'" stateKey="fc" state={bf} setState={setBf} unit="MPa" />
              <Field label="مقاومة الحديد fy" stateKey="fy" state={bf} setState={setBf} unit="MPa" />
              <TouchableOpacity
                style={[styles.calcBtn, { backgroundColor: colors.primary }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setBeamCalcDone(true); }}
                activeOpacity={0.85}
              >
                <Text style={styles.calcBtnText}>احسب التصميم</Text>
              </TouchableOpacity>
            </View>

            {beamResult && (
              <View style={{ gap: 12 }}>
                <View style={[styles.statusRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.statusLabel, { color: colors.foreground }]}>الحالة العامة</Text>
                  <StatusBadge status={beamResult.status} utilization={beamResult.utilization} />
                </View>
                <View style={[styles.resultsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <UtilizationBar label="عزم الانحناء" value={beamResult.Mu / beamResult.momentCapacity}
                    demand={beamResult.Mu} capacity={beamResult.momentCapacity} unit="kN·m" />
                  <UtilizationBar label="قوة القص" value={beamResult.Vu / beamResult.shearCapacity}
                    demand={beamResult.Vu} capacity={beamResult.shearCapacity} unit="kN" />
                </View>
                <ResultCard rows={[
                  { label: "الحمل المصمم wu", value: `${(1.2 * +bf.wd + 1.6 * +bf.wl).toFixed(2)} kN/m` },
                  { label: "عزم الانحناء Mu", value: `${beamResult.Mu.toFixed(2)} kN·m` },
                  { label: "قوة القص Vu", value: `${beamResult.Vu.toFixed(2)} kN` },
                  { label: "مساحة التسليح As", value: `${beamResult.As_req.toFixed(2)} cm²`, highlight: true },
                  { label: "كانات Av/s", value: `${beamResult.Av_req.toFixed(2)} cm²/m`, highlight: true },
                  { label: "الهبوط الأقصى", value: `${beamResult.maxDef.toFixed(2)} mm` },
                  { label: "As_min", value: `${beamResult.minAs.toFixed(2)} cm²` },
                  { label: "As_max", value: `${beamResult.maxAs.toFixed(2)} cm²` },
                ]} />
                {beamResult.messages.map((m, i) => (
                  <Text key={i} style={[styles.msg, { color: m.includes("✓") ? colors.success : colors.warning }]}>{m}</Text>
                ))}
              </View>
            )}
          </>
        ) : (
          <>
            <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.formTitle, { color: colors.foreground }]}>مواصفات العمود</Text>
              <Field label="عرض العمود b" stateKey="b" state={cf} setState={setCf} unit="cm" />
              <Field label="عمق العمود h" stateKey="h" state={cf} setState={setCf} unit="cm" />
              <Field label="ارتفاع الدور H" stateKey="H" state={cf} setState={setCf} unit="m" />
              <Field label="الحمل المحوري Pu" stateKey="Pu" state={cf} setState={setCf} unit="kN" />
              <Field label="عزم Mux" stateKey="Mux" state={cf} setState={setCf} unit="kN·m" />
              <Field label="عزم Muy" stateKey="Muy" state={cf} setState={setCf} unit="kN·m" />
              <Field label="مقاومة الخرسانة fc'" stateKey="fc" state={cf} setState={setCf} unit="MPa" />
              <Field label="مقاومة الحديد fy" stateKey="fy" state={cf} setState={setCf} unit="MPa" />
              <TouchableOpacity
                style={[styles.calcBtn, { backgroundColor: colors.primary }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setColCalcDone(true); }}
                activeOpacity={0.85}
              >
                <Text style={styles.calcBtnText}>احسب التصميم</Text>
              </TouchableOpacity>
            </View>

            {colResult && (
              <View style={{ gap: 12 }}>
                <View style={[styles.statusRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.statusLabel, { color: colors.foreground }]}>الحالة العامة</Text>
                  <StatusBadge status={colResult.status} utilization={colResult.utilization} />
                </View>
                <View style={[styles.resultsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <UtilizationBar label="الطاقة الاستيعابية" value={colResult.utilization}
                    demand={colResult.Pu} capacity={colResult.axialCapacity} unit="kN" />
                </View>
                <ResultCard rows={[
                  { label: "الحمل المحوري Pu", value: `${colResult.Pu.toFixed(0)} kN` },
                  { label: "الطاقة φPn", value: `${colResult.axialCapacity.toFixed(0)} kN` },
                  { label: "مساحة التسليح As", value: `${colResult.As_req.toFixed(2)} cm²`, highlight: true },
                  { label: "نسبة التسليح ρ", value: `${colResult.rho.toFixed(2)}%`, highlight: true },
                  { label: "الانحراف ex", value: `${colResult.eccentricityX.toFixed(3)} m` },
                  { label: "الانحراف ey", value: `${colResult.eccentricityY.toFixed(3)} m` },
                ]} />
                {colResult.messages.map((m, i) => (
                  <Text key={i} style={[styles.msg, { color: m.includes("✓") ? colors.success : colors.warning }]}>{m}</Text>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 10 },
  typeTabs: { flexDirection: "row", gap: 8 },
  typeTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 10, gap: 6 },
  typeTabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  content: { padding: 16, gap: 16 },
  formCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  formTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 4 },
  fieldRow: { gap: 4 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 8, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", paddingVertical: 10 },
  unit: { fontSize: 12, fontFamily: "Inter_400Regular" },
  calcBtn: { borderRadius: 12, padding: 14, alignItems: "center", marginTop: 8 },
  calcBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14 },
  statusLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  resultsCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  msg: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
