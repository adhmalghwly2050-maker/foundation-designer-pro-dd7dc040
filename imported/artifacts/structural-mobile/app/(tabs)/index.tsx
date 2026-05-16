import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, Platform, Modal, Pressable,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useProject, Project } from "@/context/ProjectContext";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

export default function ProjectsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { projects, currentProject, setCurrentProject, addProject, deleteProject } = useProject();
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const handleCreate = () => {
    if (!name.trim()) { Alert.alert("Enter project name"); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    addProject(name.trim(), desc.trim());
    setName(""); setDesc(""); setShowNew(false);
  };

  const handleDelete = (p: Project) => {
    Alert.alert("Delete Project", `Delete "${p.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); deleteProject(p.id); },
      },
    ]);
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 16, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Structural Master</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>{projects.length} project{projects.length !== 1 ? "s" : ""}</Text>
        </View>
        <TouchableOpacity
          style={[styles.newBtn, { backgroundColor: colors.primary }]}
          onPress={() => setShowNew(true)}
          activeOpacity={0.8}
        >
          <Feather name="plus" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 100 }]}>
        {projects.length === 0 && (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="office-building-outline" size={56} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No projects yet</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Create your first structural project</Text>
          </View>
        )}
        {projects.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: p.id === currentProject?.id ? colors.primary : colors.border },
            ]}
            onPress={() => { Haptics.selectionAsync(); setCurrentProject(p); router.push("/(tabs)/design"); }}
            activeOpacity={0.85}
          >
            <View style={styles.cardLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.primary + "18" }]}>
                <MaterialCommunityIcons name="office-building" size={24} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>{p.name}</Text>
                <Text style={[styles.cardDesc, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {p.beams.length} beams · {p.columns.length} columns
                </Text>
                <Text style={[styles.cardDate, { color: colors.mutedForeground }]}>
                  {new Date(p.updatedAt).toLocaleDateString("ar-SA")}
                </Text>
              </View>
            </View>
            <View style={styles.cardRight}>
              {p.id === currentProject?.id && (
                <View style={[styles.activeDot, { backgroundColor: colors.primary }]} />
              )}
              <TouchableOpacity onPress={() => handleDelete(p)} hitSlop={12}>
                <Feather name="trash-2" size={18} color={colors.danger} />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* New Project Modal */}
      <Modal visible={showNew} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={() => setShowNew(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>مشروع جديد</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
              placeholder="اسم المشروع"
              placeholderTextColor={colors.mutedForeground}
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={[styles.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border, height: 80 }]}
              placeholder="وصف (اختياري)"
              placeholderTextColor={colors.mutedForeground}
              value={desc}
              onChangeText={setDesc}
              multiline
            />
            <TouchableOpacity style={[styles.createBtn, { backgroundColor: colors.primary }]} onPress={handleCreate} activeOpacity={0.85}>
              <Text style={styles.createBtnText}>إنشاء المشروع</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  newBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, gap: 12 },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular" },
  card: {
    flexDirection: "row", alignItems: "center", borderRadius: 14,
    borderWidth: 1.5, padding: 14, gap: 12,
  },
  cardLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  iconBox: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  cardDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  cardRight: { alignItems: "center", gap: 8 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  sheetTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 8, textAlign: "center" },
  input: { borderRadius: 10, borderWidth: 1, padding: 14, fontSize: 15, fontFamily: "Inter_400Regular" },
  createBtn: { borderRadius: 12, padding: 16, alignItems: "center", marginTop: 4 },
  createBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
