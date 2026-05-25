import React, { useReducer, useMemo, useCallback, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Slab, Column, Beam, Frame, MatProps, SlabProps, FrameResult,
  generateColumns, generateBeams, generateFrames,
  calculateBeamLoads, analyzeFrame, designFlexure, designShear,
  designColumnETABS, designSlab, calculateColumnLoads, FlexureResult, ShearResult,
  detectBeamOnBeam, analyzeWithBeamOnBeam, BeamOnBeamConnection, ColumnResult,
  calculateDeflection, DeflectionResult, diagnoseBeam, BeamDiagnostic,
  calculateColumnLoadsBiaxial, designColumnBiaxial, BiaxialColumnResult,
  calculateFrameBentUp, FrameBentUpResult, Story,
  getJointConnectivityInfo, JointConnectivityInfo,
} from "@/lib/structuralEngine";
import { getColumnLoads3D, getFrameResults3D } from "@/lib/analyze3DColumns";
import ManualConnectionManager from "@/components/ManualConnectionManager";
import { adaptFEMResults, ENGINE_LABELS, type EngineType } from '@/lib/analysisController';
import { getFrameResultsGlobalFrame } from '@/lib/globalFrameBridge';
import { getConnectedSlabResults } from "@/slabFEMEngine";
import { ModelManager } from "@/structural/model/modelManager";
import { generateStructureFromSlabs } from "@/structural/generators/slabStructureGenerator";
import ToolPalette, { ToolType } from "@/components/ToolPalette";
import ModelCanvas from "@/components/ModelCanvas";
import PropertyPanel from "@/components/PropertyPanel";
import BuildingView from "@/components/BuildingView";
import RebarDetailModal from "@/components/RebarDetailModal";
import ElementMomentChartModal from "@/components/ElementMomentChartModal";
import ElementPropertiesDialog from "@/components/ElementPropertiesDialog";
import AnalysisDiagramDialog from "@/components/AnalysisDiagramDialog";
import {
  Building2, Layers, Calculator, BarChart3, Ruler, Eye,
  Grid3X3, Settings2, Download, Bot, Building, Zap, Plus, Trash2,
  Undo2, Save, Check, Wand2, Search, Compass, Merge, Crosshair, CheckSquare, Upload, Activity,
  Loader2, X as XIcon, RotateCcw,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import BottomNav, { type MainTab } from "@/components/BottomNav";
import AIAssistantPanel from "@/ai/structuralAssistant/AIAssistantPanel";
import MultiStoryDesigner from "@/building/MultiStoryDesigner";
import GenerativeDesignDashboard from "@/generative/GenerativeDesignDashboard";
import type { EvaluatedOption } from "@/generative/types";
import AutoDesignPanel from "@/components/AutoDesignPanel";
import type { AutoDesignResult } from "@/lib/autoDesigner";
import { generateStructuralDXF, generateReinforcementDXF, generateBeamLayoutDXF, generateColumnLayoutDXF, downloadDXF } from "@/export/dxfExporter";
import { generateStructuralReport } from "@/export/pdfReport";
import { exportStructuralDrawingPDF } from "@/export/drawingExporter";
import { generateAutoDrawings } from "@/drawings/autoDrawingGenerator";
import { generateConstructionSheets } from "@/drawings/constructionSheets";
import { generateBBS, exportBBSToPDF, exportBBSToExcel } from "@/rebar/bbsGenerator";
import BeamRebarDetailView from "@/components/BeamRebarDetailView";
import { findCollinearGroups, mergeCollinearBeams, detectBeamIntersections } from "@/lib/beamUtils";
import { extractRawStations, buildRawStationsCSV, downloadCSV, type EngineRawStations } from "@/lib/rawMomentStationsExporter";
import { appReducer, initialState, type AppAction } from "./indexReducer";
import { StorySelector, StoryManager } from "@/components/StorySelector";
import BeamDesignDetails from "@/components/BeamDesignDetails";
import ColumnDesignDetails from "@/components/ColumnDesignDetails";
import PMDiagramChart from "@/components/PMDiagramChart";
import ExportPanel from "@/components/ExportPanel";
import ETABSComparisonTable from "@/components/ETABSComparisonTable";
import ProjectManager from "@/components/ProjectManager";
import LevelPlanView from "@/components/LevelPlanView";
import LoadComparisonPanel from "@/components/LoadComparisonPanel";
import FEMComparisonPanel  from "@/components/FEMComparisonPanel";
import GlobalFrameSolverPanel from "@/components/GlobalFrameSolverPanel";
import AdvancedAnalysisPanel from "@/components/AdvancedAnalysisPanel";
import ETABSImportPanel from "@/components/ETABSImportPanel";
import BeamLoadDiagrams from "@/components/BeamLoadDiagrams";
import BOQPanel from "@/components/BOQPanel";
import SlabAnalysisPanel from "@/components/SlabAnalysisPanel";
import SlabLoadDiagnosticPanel from "@/components/SlabLoadDiagnosticPanel";
import ETABSFullImportPanel from "@/components/ETABSFullImportPanel";
import type { ETABSImportedData } from "@/components/ETABSFullImportPanel";
import ETABSEdbImportPanel from "@/components/ETABSEdbImportPanel";
import type { EdbImportedData } from "@/components/ETABSEdbImportPanel";
import ETABSAnalysisImport from "@/components/ETABSAnalysisImport";
import type { ETABSBeamResult, ETABSColumnResult, ETABSReaction } from "@/components/ETABSAnalysisImport";
import FoundationDesignPanel from "@/components/FoundationDesignPanel";
import LoadInputPanel from "@/components/LoadInputPanel";
import DesignComparisonPanel from "@/components/DesignComparisonPanel";
import type { FootingDesignResult, FootingMaterials } from "@/lib/foundationDesign";
import { useAnalysisWorker, type AnalysisInput as WorkerAnalysisInput } from '@/core/workers/useAnalysisWorker';
import type { WorkerDiagnostics } from '@/core/workers/workerTypes';
import AnalysisDiagnosticsPanel from '@/components/AnalysisDiagnosticsPanel';

const ParamInput = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
  <div className="space-y-1">
    <label className="property-label">{label}</label>
    <Input type="number" value={value}
      onChange={(e) => { onChange(parseFloat(e.target.value) || 0); }}
      className="font-mono h-10 text-sm" />
  </div>
);

type ReleaseDOF = 'ux' | 'uy' | 'uz' | 'rx' | 'ry' | 'rz';
type BeamEndReleaseState = Record<'nodeI' | 'nodeJ', Record<ReleaseDOF, boolean>>;

const EMPTY_BEAM_END_RELEASES: BeamEndReleaseState = {
  nodeI: { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false },
  nodeJ: { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false },
};

const RELEASE_DOF_META: { key: ReleaseDOF; etabs: string; desc: string }[] = [
  { key: 'ux', etabs: 'U1', desc: 'تحرير محوري' },
  { key: 'uy', etabs: 'U2', desc: 'تحرير قص محلي' },
  { key: 'uz', etabs: 'U3', desc: 'تحرير قص عمودي' },
  { key: 'rx', etabs: 'R1', desc: 'تحرير لَي' },
  { key: 'ry', etabs: 'R2', desc: 'تحرير عزم حول Y' },
  { key: 'rz', etabs: 'R3', desc: 'تحرير عزم حول Z' },
];

const createEmptyBeamEndReleases = (): BeamEndReleaseState => ({
  nodeI: { ...EMPTY_BEAM_END_RELEASES.nodeI },
  nodeJ: { ...EMPTY_BEAM_END_RELEASES.nodeJ },
});

const modelManager = new ModelManager();

const Index = () => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const {
    stories, selectedStoryId,
    slabs, mat, slabProps, beamB, beamH, colB, colH, colL, colLBelow, colTopEndCondition, colBottomEndCondition,
    analyzed, frameResults, bobConnections, selectedEngine, ignoreSlab, beamStiffnessFactor, colStiffnessFactor,
    activeTab, mode, activeTool, pendingNode,
    selectedNodeId, selectedFrameId, selectedAreaId,
    removedColumnIds, removedBeamIds, beamOverrides, colOverrides, slabPropsOverrides, extraBeams, extraColumns, etabsImportMode, etabsAnalysisData, titleBlockConfig, supportRestraints, frameEndReleases, transientFrameEndReleases,
    modalOpen, selectedElement, elemPropsOpen, elemPropsFrameId, elemPropsAreaId,
    diagramOpen, diagramData, savedMessage, bobManualPrimary, undoStack,
    colRigidEndOffsets,
    manualJointOverrides,
  } = state;

  /**
   * `frameEndReleases` (الدائم — يأتي من جدول جسور تبويب الإدخال) مدموجاً مع
   * `transientFrameEndReleases` (المؤقت — يأتي من تحرير الجسر في تبويب التحليل/
   * النمذجة عبر long-press → Element Properties). هذا هو **المصدر الوحيد**
   * الذي تقرأ منه كل المحلِّلات (2D/3D Legacy/Global Frame/Unified Core).
   * المؤقت لا يظهر في جدول جسور تبويب الإدخال ولا يُحفظ في الـ snapshot/undo.
   */
  const effectiveFrameEndReleases = React.useMemo(
    () => ({ ...frameEndReleases, ...transientFrameEndReleases }),
    [frameEndReleases, transientFrameEndReleases],
  );

  // Main bottom navigation tab
  const [mainTab, setMainTab] = React.useState<MainTab>('inputs');
  const [releaseEditorBeamId, setReleaseEditorBeamId] = React.useState<string | null>(null);
  const [releaseEditorData, setReleaseEditorData] = React.useState<BeamEndReleaseState>(createEmptyBeamEndReleases);
  const [releaseEditorDims, setReleaseEditorDims] = React.useState<{ b: number; h: number }>({ b: 200, h: 400 });
  const [releaseEditorApplyOtherFloors, setReleaseEditorApplyOtherFloors] = React.useState(false);

  // Duplicate check state
  const [dupCheckResult, setDupCheckResult] = React.useState<{ message: string; count: number; items: string[] } | null>(null);

  // FEM analysis error state
  const [femError, setFemError] = React.useState<string | null>(null);

  // Analysis progress overlay
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [analysisProgress, setAnalysisProgress] = React.useState(0);
  const [analysisStep, setAnalysisStep] = React.useState('');
  const [analysisDiagnostics, setAnalysisDiagnostics] = React.useState<WorkerDiagnostics | null>(null);
  const progressTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Web Worker for off-thread analysis
  const analysisWorker = useAnalysisWorker();

  // Pre-analysis validation state
  const [validationReport, setValidationReport] = React.useState<import('@/core/validation/preAnalysisValidator').ValidationReport | null>(null);
  const [validationRunning, setValidationRunning] = React.useState(false);
  const [showViewMoments, setShowViewMoments] = React.useState(false);
  const [viewMomentEngine, setViewMomentEngine] = React.useState<'active' | '2d' | '3d' | 'gf'>('active');

  // Modeler elevation filter state
  const [modelerElevation, setModelerElevation] = React.useState<number>(0);

  // Beam selection for merge/intersect
  const [selectedBeamIds, setSelectedBeamIds] = React.useState<Set<string>>(new Set());

  // ETABS beam data for comparison table persistence
  const [etabsCompBeamData, setEtabsCompBeamData] = React.useState<{ beamId: string; Mleft: number; Mmid: number; Mright: number }[]>([]);

  // Design tab: source selector + manual trigger
  const [designSource, setDesignSource] = React.useState<'app' | 'etabs'>('app');
  const [designExecuted, setDesignExecuted] = React.useState(false);

  // Design tab: sub-tab state
  const [designSubTab, setDesignSubTab] = React.useState<'beams_cols' | 'foundations' | 'comparison'>('beams_cols');

  // Biaxial column analysis: selected columns for bulk rotation + story filter
  const [biaxialSelectedCols, setBiaxialSelectedCols] = React.useState<Set<string>>(new Set());
  const [biaxialStoryFilter, setBiaxialStoryFilter] = React.useState<string>('');
  const [rotatedColIds, setRotatedColIds] = React.useState<Set<string>>(new Set());

  const [connectionManagerOpen, setConnectionManagerOpen] = React.useState(false);

  // Custom load combinations
  const [loadCombos, setLoadCombos] = React.useState([
    { id: 'combo_1_4dl',    label: '1.4DL',                   factorDL: 1.4, factorLL: 0.0, isDefault: true },
    { id: 'combo_12dl_16ll',label: '1.2DL + 1.6LL',           factorDL: 1.2, factorLL: 1.6, isDefault: true },
    { id: 'combo_1dl_1ll',  label: '1.0DL + 1.0LL (أساسات)', factorDL: 1.0, factorLL: 1.0, isDefault: true },
  ]);

  // Foundation design results (hoisted so ExportPanel can access them)
  const [foundationResults, setFoundationResults] = React.useState<FootingDesignResult[]>([]);
  const [foundationMat, setFoundationMat] = React.useState<FootingMaterials | null>(null);

  // ETABS column results and reactions
  const [etabsColumnResults, setEtabsColumnResults] = React.useState<ETABSColumnResult[]>([]);
  const [etabsReactions, setEtabsReactions] = React.useState<ETABSReaction[]>([]);

  // Computed: هل توجد نتائج تصميم (من التطبيق أو من ETABS)
  const hasDesignResults = analyzed || (designSource === 'etabs' && designExecuted && etabsAnalysisData.length > 0);

  // Available elevations from stories
  const availableElevations = useMemo(() => {
    const elevs = new Set<number>();
    elevs.add(0); // ground level
    for (const s of stories) {
      elevs.add(s.elevation ?? 0);
      elevs.add((s.elevation ?? 0) + s.height);
    }
    return [...elevs].sort((a, b) => a - b);
  }, [stories]);

  // Helper: filter slabs by selected story
  const isAllStories = selectedStoryId === '__ALL__';
  const storyFilteredSlabs = useMemo(() =>
    isAllStories ? slabs : slabs.filter(s => s.storyId === selectedStoryId),
    [slabs, selectedStoryId, isAllStories]
  );
  
  // Get story label for an element
  const getStoryLabel = useCallback((storyId?: string) => {
    if (!storyId) return stories[0]?.label || 'الدور 1';
    return stories.find(s => s.id === storyId)?.label || storyId;
  }, [stories]);

  // Handler for changing individual column support conditions.
  // SupportPlanView passes (colId, x, y, zBottom, endType, value) directly so we
  // do not need the `columns` array here (avoids a "used before declaration" error).
  const handleColumnSupportChange = useCallback(
    (
      _colId: string,
      x: number,
      y: number,
      zBottom: number,
      endType: 'top' | 'bottom',
      value: 'F' | 'P',
    ) => {
      if (endType !== 'bottom') return; // Only bottom (foundation) conditions
      const supportKey = `${x.toFixed(2)}_${y.toFixed(2)}_${zBottom}`;
      const restraints = value === 'F'
        ? { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }   // Fixed
        : { ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }; // Pinned
      dispatch({ type: 'SET_SUPPORT_RESTRAINTS', posKey: supportKey, restraints });
    },
    [],
  );

  // Per-DOF support restraints change
  const handleSupportRestraintsChange = useCallback((posKeys: string[], restraints: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean }) => {
    for (const key of posKeys) {
      dispatch({ type: 'SET_SUPPORT_RESTRAINTS', posKey: key, restraints });
    }
  }, []);

  useEffect(() => {
    if (!savedMessage) return;
    const t = setTimeout(() => dispatch({ type: 'CLEAR_SAVED_MESSAGE' }), 2000);
    return () => clearTimeout(t);
  }, [savedMessage]);

  // Keyboard shortcut: Ctrl+Z for undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (mode === 'auto') {
      modelManager.clear();
      const beamSection = modelManager.createSection('B-default', beamB, beamH, 'beam');
      const colSection = modelManager.createSection('C-default', colB, colH, 'column');
      generateStructureFromSlabs(
        modelManager,
        slabs.map(s => ({ id: s.id, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })),
        beamSection, colSection, slabProps.thickness, colL / 1000
      );
      // Reapply persisted frame end releases to modelManager nodes
      if (frameEndReleases) {
        for (const frame of modelManager.getAllFrames()) {
          const ni = modelManager.getNode(frame.nodeI);
          const nj = modelManager.getNode(frame.nodeJ);
          if (ni && nj) {
            const posKey = `${ni.x.toFixed(3)}_${ni.y.toFixed(3)}_${nj.x.toFixed(3)}_${nj.y.toFixed(3)}`;
            const posKeyRev = `${nj.x.toFixed(3)}_${nj.y.toFixed(3)}_${ni.x.toFixed(3)}_${ni.y.toFixed(3)}`;
            const rel = frameEndReleases[posKey] || frameEndReleases[posKeyRev];
            if (rel) {
              const isRev = !!frameEndReleases[posKeyRev] && !frameEndReleases[posKey];
              modelManager.setNodeRestraints(frame.nodeI, isRev ? rel.nodeJ : rel.nodeI);
              modelManager.setNodeRestraints(frame.nodeJ, isRev ? rel.nodeI : rel.nodeJ);
            }
          }
        }
      }
      dispatch({ type: 'INC_MODEL_VERSION' });
    }
  }, [slabs, beamB, beamH, colB, colH, colL, slabProps.thickness, mode, frameEndReleases]);

  const columns = useMemo(() => {
    // When ETABS import mode is active, skip auto-generation and use imported columns only
    if (etabsImportMode) {
      return extraColumns.map(c => {
        const ov = colOverrides[c.id];
        const cx = ov?.x ?? c.x;
        const cy = ov?.y ?? c.y;
        const zBot = c.zBottom ?? 0;
        // Apply supportRestraints for ETABS columns (same key format as regular mode)
        const supportKey = `${cx.toFixed(2)}_${cy.toFixed(2)}_${zBot}`;
        const sr = supportRestraints?.[supportKey];
        const bottomEnd: 'F' | 'P' = sr
          ? ((sr.ux && sr.uy && sr.uz && sr.rx && sr.ry && sr.rz) ? 'F' : 'P')
          : (c.bottomEndCondition ?? 'F');
        return {
          ...c,
          b: ov?.b ?? c.b,
          h: ov?.h ?? c.h,
          L: ov?.L ?? c.L,
          x: cx,
          y: cy,
          zBottom: zBot,
          zTop: c.zTop ?? (zBot + ((ov?.L ?? c.L) || 0)),
          bottomEndCondition: bottomEnd,
        };
      });
    }
    // Get unique column positions from slabs (ignoring storyId for position extraction)
    const uniqueSlabs = slabs.filter((s, i, arr) => {
      // Use first occurrence of each slab position pattern per story
      return true; // keep all slabs, generateColumns deduplicates by position
    });
    const baseCols = generateColumns(uniqueSlabs);
    
    // Create a column instance for EACH story with sequential naming from bottom up
    const allCols: Column[] = [];
    // Sort stories by elevation (bottom to top) for sequential naming
    const sortedStories = [...stories].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
    let colSeq = 1;
    for (const story of sortedStories) {
      const storyElev = story.elevation ?? 0; // mm
      const storyHeight = story.height ?? colL;
      for (const c of baseCols) {
        const colId = `C${colSeq}`;
        const legacyId = stories.length > 1 ? `${c.id}_${story.id}` : c.id;
        const ov = colOverrides[c.id] || colOverrides[legacyId] || colOverrides[colId];
        const colHeight = ov?.L ?? storyHeight;
        // Derive bottom end condition from per-support DOF restraints
        const supportKey = `${c.x.toFixed(2)}_${c.y.toFixed(2)}_${storyElev}`;
        const sr = supportRestraints?.[supportKey];
        const bottomEnd: 'F' | 'P' = sr
          ? ((sr.ux && sr.uy && sr.uz && sr.rx && sr.ry && sr.rz) ? 'F' : 'P')
          : colBottomEndCondition as 'F' | 'P';
        const colX = ov?.x ?? c.x;
        const colY = ov?.y ?? c.y;
        allCols.push({
          ...c,
          id: colId,
          storyId: story.id,
          x: colX, y: colY,
          b: ov?.b ?? colB,
          h: ov?.h ?? colH,
          L: colHeight,
          LBelow: colLBelow,
          zBottom: storyElev,
          zTop: storyElev + colHeight,
          isRemoved: removedColumnIds.includes(c.id) || removedColumnIds.includes(colId) || removedColumnIds.includes(legacyId),
          topEndCondition: colTopEndCondition as 'F' | 'P',
          bottomEndCondition: bottomEnd,
          orientAngle: ov?.orientAngle ?? (c as any).orientAngle,
        });
        colSeq++;
      }
    }
    // Add extra columns
    for (const c of extraColumns) {
      allCols.push({
        ...c,
        zBottom: c.zBottom ?? 0,
        zTop: c.zTop ?? (c.L || 0),
      });
    }
    return allCols;
  }, [slabs, colB, colH, colL, colLBelow, removedColumnIds, colOverrides, extraColumns, etabsImportMode, colTopEndCondition, colBottomEndCondition, stories, selectedStoryId, supportRestraints]);

  const beams = useMemo(() => {
    // When ETABS import mode is active, skip auto-generation and use imported beams only
    if (etabsImportMode) {
      return extraBeams.map(b => ({ ...b, z: b.z ?? 0 }));
    }
    // Deduplicate slabs by position to generate base beam topology (avoid multi-story duplication)
    const uniqueSlabsByPos = new Map<string, Slab>();
    for (const s of slabs) {
      const key = `${s.x1},${s.y1}-${s.x2},${s.y2}`;
      if (!uniqueSlabsByPos.has(key)) uniqueSlabsByPos.set(key, s);
    }
    const deduplicatedSlabs = [...uniqueSlabsByPos.values()];
    const baseCols = generateColumns(deduplicatedSlabs);
    const baseBeams = generateBeams(deduplicatedSlabs, baseCols);
    
    // Build a map from deduplicated slab ID -> story-specific slab IDs
    const slabsByStory = new Map<string, Slab[]>(); // storyId -> slabs
    for (const s of slabs) {
      const storyId = s.storyId || stories[0]?.id || '';
      if (!slabsByStory.has(storyId)) slabsByStory.set(storyId, []);
      slabsByStory.get(storyId)!.push(s);
    }
    
    // Create beam instances for each story with sequential naming from bottom up
    const allBeams: Beam[] = [];
    const sortedStoriesForBeams = [...stories].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
    let beamSeq = 1;
    // Build a map from (baseColId, storyId) -> sequential colId for proper references
    const colIdMap = new Map<string, string>();
    let colMapSeq = 1;
    for (const story of sortedStoriesForBeams) {
      for (const c of baseCols) {
        colIdMap.set(`${c.id}_${story.id}`, `C${colMapSeq}`);
        colMapSeq++;
      }
    }
    for (const story of sortedStoriesForBeams) {
      const storyElev = story.elevation ?? 0;
      const storyHeight = story.height ?? colL;
      const beamZ = storyElev + storyHeight; // Beam at top of story (slab level)
      
      // Get slabs for this story to properly reference them
      const storySlabs = slabsByStory.get(story.id) || [];
      
      for (const b of baseBeams) {
        const beamId = `B${beamSeq}`;
        const fromColId = colIdMap.get(`${b.fromCol}_${story.id}`) ?? b.fromCol;
        const toColId = colIdMap.get(`${b.toCol}_${story.id}`) ?? b.toCol;
        const legacyBeamId = stories.length > 1 ? `${b.id}_${story.id}` : b.id;
        const ov = beamOverrides[b.id] || beamOverrides[legacyBeamId] || beamOverrides[beamId];
        
        // Map base beam slab references to this story's slab IDs (match by position)
        const storySlabIds: string[] = [];
        for (const basSlabId of b.slabs) {
          const baseSlab = deduplicatedSlabs.find(s => s.id === basSlabId);
          if (!baseSlab) continue;
          const matchingSlab = storySlabs.find(s =>
            s.x1 === baseSlab.x1 && s.y1 === baseSlab.y1 &&
            s.x2 === baseSlab.x2 && s.y2 === baseSlab.y2
          );
          if (matchingSlab) storySlabIds.push(matchingSlab.id);
        }
        
        const beamX1 = ov?.x1 ?? b.x1;
        const beamY1 = ov?.y1 ?? b.y1;
        const beamX2 = ov?.x2 ?? b.x2;
        const beamY2 = ov?.y2 ?? b.y2;
        const beamZval = ov?.z ?? beamZ;
        const dx = beamX2 - beamX1;
        const dy = beamY2 - beamY1;
        const beamLength = Math.sqrt(dx * dx + dy * dy);
        allBeams.push({
          ...b,
          id: beamId,
          fromCol: fromColId,
          toCol: toColId,
          storyId: story.id,
          x1: beamX1, y1: beamY1, x2: beamX2, y2: beamY2,
          length: beamLength > 0 ? beamLength : b.length,
          b: ov?.b ?? beamB,
          h: ov?.h ?? beamH,
          z: beamZval,
          slabs: storySlabIds.length > 0 ? storySlabIds : b.slabs,
        });
        beamSeq++;
      }
    }
    // Add extra beams
    for (const eb of extraBeams) {
      allBeams.push({ ...eb, z: eb.z ?? 0 });
    }
    return allBeams;
  }, [slabs, columns, beamB, beamH, beamOverrides, extraBeams, etabsImportMode, stories, selectedStoryId, colL]);

  // Build model nodes map for looking up node IDs by coordinates
  const modelNodesMap = useMemo(() => {
    const nodeMap = new Map<string, string>();
    const tol = 0.001;
    const getKey = (x: number, y: number, z: number) =>
      `${Math.round(x / tol) * tol},${Math.round(y / tol) * tol},${Math.round(z / tol) * tol}`;
    let seq = 1;
    for (const c of columns.filter(cc => !cc.isRemoved)) {
      const zTop = (c.zTop ?? 0) / 1000;
      const zBot = (c.zBottom ?? 0) / 1000;
      if (!nodeMap.has(getKey(c.x, c.y, zTop))) nodeMap.set(getKey(c.x, c.y, zTop), `N${seq++}`);
      if (!nodeMap.has(getKey(c.x, c.y, zBot))) nodeMap.set(getKey(c.x, c.y, zBot), `N${seq++}`);
    }
    for (const b of beams.filter(bb => !removedBeamIds.includes(bb.id))) {
      const bz = (b.z ?? 0) / 1000;
      if (!nodeMap.has(getKey(b.x1, b.y1, bz))) nodeMap.set(getKey(b.x1, b.y1, bz), `N${seq++}`);
      if (!nodeMap.has(getKey(b.x2, b.y2, bz))) nodeMap.set(getKey(b.x2, b.y2, bz), `N${seq++}`);
    }
    return { map: nodeMap, getKey };
  }, [columns, beams, removedBeamIds]);

  const getBeamNodeId = useCallback((x: number, y: number, z: number) => {
    const key = modelNodesMap.getKey(x, y, (z ?? 0) / 1000);
    return modelNodesMap.map.get(key) || '—';
  }, [modelNodesMap]);

  const toggleBeamSelection = useCallback((id: string) => {
    setSelectedBeamIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const selectAllBeams = useCallback(() => {
    const activeBeamIds = beams.filter(b => !removedBeamIds.includes(b.id)).map(b => b.id);
    setSelectedBeamIds(new Set(activeBeamIds));
  }, [beams, removedBeamIds]);
  const clearBeamSelection = useCallback(() => setSelectedBeamIds(new Set()), []);

  const handleMergeBeams = useCallback(() => {
    const groups = findCollinearGroups(beams, [...selectedBeamIds]);
    if (groups.length === 0) return;
    for (const group of groups) {
      const result = mergeCollinearBeams(beams, group);
      if (result) {
        dispatch({ type: 'MERGE_BEAMS', mergedBeam: result.merged, removedIds: result.removedIds });
      }
    }
    setSelectedBeamIds(new Set());
  }, [beams, selectedBeamIds]);

  const handleIntersect = useCallback(() => {
    const activeBeams = beams.filter(b => !removedBeamIds.includes(b.id));
    const intersections = detectBeamIntersections(activeBeams, columns, removedColumnIds);
    if (intersections.length === 0) return;
    let vcIdx = 1;
    for (const int of intersections) {
      const vcId = `VC${Date.now()}_${vcIdx++}`;
      dispatch({ type: 'ADD_VIRTUAL_REMOVED_COLUMN', colId: vcId, x: int.point.x, y: int.point.y });
    }
    setSelectedBeamIds(new Set());
  }, [beams, columns, removedColumnIds, removedBeamIds]);
  const beamsWithLoads = useMemo(() => {
    const activeBeams = beams.filter(b => !removedBeamIds.includes(b.id));
    return activeBeams.map(b => {
      // Pass the active beams for the same story so adjacent-slab merging works correctly
      const storyActiveBeams = b.storyId
        ? activeBeams.filter(ab => ab.storyId === b.storyId)
        : activeBeams;
      const loads = calculateBeamLoads(b, slabs, slabProps, mat, storyActiveBeams);
      const wallLoad = beamOverrides[b.id]?.wallLoad || b.wallLoad || 0;
      return { ...b, deadLoad: loads.deadLoad + wallLoad, liveLoad: loads.liveLoad, wallLoad };
    });
  }, [beams, slabs, slabProps, mat, beamOverrides, removedBeamIds]);

  const frames = useMemo(() => generateFrames(beamsWithLoads), [beamsWithLoads]);

  const detectedConnections = useMemo(() => {
    if (removedColumnIds.length === 0) return [];
    return detectBeamOnBeam(beamsWithLoads, columns, removedColumnIds, bobManualPrimary);
  }, [beamsWithLoads, columns, removedColumnIds, bobManualPrimary]);

  // محرك 3D Legacy: لا يتأثر بالتحديد اليدوي للجسور الحاملة/المحمولة
  // ولا يتم إنشاء مفصلات بناءً على هذا التحديد اليدوي.
  // يستخدم الكشف التلقائي البحت (auto-detect فقط) دون تمرير bobManualPrimary.
  const autoDetectedConnections = useMemo(() => {
    if (removedColumnIds.length === 0) return [];
    return detectBeamOnBeam(beamsWithLoads, columns, removedColumnIds);
  }, [beamsWithLoads, columns, removedColumnIds]);

  const runAnalysis = () => {
    setFemError(null);
    setAnalysisDiagnostics(null);

    // ── حساب خريطة المفصلات 2D في الـ UI thread (يحتاج getBeamReleaseState) ──
    const beamHinges2DArr: Array<[string, 'I' | 'J' | 'BOTH']> = [];
    for (const beam of beamsWithLoads) {
      const rs = getBeamReleaseState(beam);
      const hasHingeI = rs.nodeI.rx || rs.nodeI.ry || rs.nodeI.rz;
      const hasHingeJ = rs.nodeJ.rx || rs.nodeJ.ry || rs.nodeJ.rz;
      if (hasHingeI && hasHingeJ) beamHinges2DArr.push([beam.id, 'BOTH']);
      else if (hasHingeI) beamHinges2DArr.push([beam.id, 'I']);
      else if (hasHingeJ) beamHinges2DArr.push([beam.id, 'J']);
    }

    // ── إظهار شاشة التحميل ───────────────────────────────────────────────────
    setIsAnalyzing(true);
    setAnalysisProgress(3);
    setAnalysisStep('تهيئة معالج التحليل (Web Worker)...');

    // ── إرسال النموذج إلى الـ Worker ────────────────────────────────────────
    const workerInput: WorkerAnalysisInput = {
      frames,
      beamsWithLoads,
      columns,
      mat,
      slabs,
      slabProps,
      selectedEngine,
      ignoreSlab,
      effectiveFrameEndReleases,
      beamStiffnessFactor,
      colStiffnessFactor,
      detectedConnections,
      removedColumnIds,
      beamHinges2D: beamHinges2DArr,
      colRigidEndOffsets,
    };

    analysisWorker.startAnalysis(workerInput, {
      onProgress: (prog, step) => {
        setAnalysisProgress(prog);
        setAnalysisStep(step);
      },
      onComplete: (result) => {
        // حفظ التشخيصات وتحديث النتائج
        setAnalysisDiagnostics(result.diagnostics);
        dispatch({ type: 'SET_FRAME_RESULTS', results: result.frameResults });
        dispatch({ type: 'SET_BOB_CONNECTIONS', connections: result.bobConnections });
        dispatch({ type: 'SET_ANALYZED', value: true });
        // إنهاء شاشة التحميل بنجاح
        setAnalysisProgress(100);
        setAnalysisStep('اكتمل التحليل بنجاح ✓');
        setTimeout(() => {
          setIsAnalyzing(false);
          setAnalysisProgress(0);
          setAnalysisStep('');
        }, 800);
      },
      onError: (message) => {
        setFemError(message);
        setIsAnalyzing(false);
        setAnalysisProgress(0);
        setAnalysisStep('');
      },
      onCancelled: () => {
        setIsAnalyzing(false);
        setAnalysisProgress(0);
        setAnalysisStep('');
      },
    });
  };

  const getBeamReleaseKey = useCallback((beam: Beam) => (
    `${beam.x1.toFixed(3)}_${beam.y1.toFixed(3)}_${beam.x2.toFixed(3)}_${beam.y2.toFixed(3)}`
  ), []);

  const getBeamReleaseState = useCallback((beam: Beam): BeamEndReleaseState => {
    const posKey = getBeamReleaseKey(beam);
    const posKeyRev = `${beam.x2.toFixed(3)}_${beam.y2.toFixed(3)}_${beam.x1.toFixed(3)}_${beam.y1.toFixed(3)}`;
    // يقرأ من effective (دائم + مؤقت) ليعكس تحرير تبويب التحليل في الرسوم/المنحنيات
    const rel = effectiveFrameEndReleases[posKey] || effectiveFrameEndReleases[posKeyRev];

    if (!rel) return createEmptyBeamEndReleases();

    const isReversed = !!effectiveFrameEndReleases[posKeyRev] && !effectiveFrameEndReleases[posKey];
    return isReversed
      ? { nodeI: { ...rel.nodeJ }, nodeJ: { ...rel.nodeI } }
      : { nodeI: { ...rel.nodeI }, nodeJ: { ...rel.nodeJ } };
  }, [effectiveFrameEndReleases, getBeamReleaseKey]);

  /**
   * مثل `getBeamReleaseState` لكن يقرأ فقط من `frameEndReleases` الدائم
   * (يُستخدم في جدول جسور تبويب الإدخال + Dialog محرر الإدخال).
   */
  const getPersistentBeamReleaseState = useCallback((beam: Beam): BeamEndReleaseState => {
    const posKey = getBeamReleaseKey(beam);
    const posKeyRev = `${beam.x2.toFixed(3)}_${beam.y2.toFixed(3)}_${beam.x1.toFixed(3)}_${beam.y1.toFixed(3)}`;
    const rel = frameEndReleases[posKey] || frameEndReleases[posKeyRev];
    if (!rel) return createEmptyBeamEndReleases();
    const isReversed = !!frameEndReleases[posKeyRev] && !frameEndReleases[posKey];
    return isReversed
      ? { nodeI: { ...rel.nodeJ }, nodeJ: { ...rel.nodeI } }
      : { nodeI: { ...rel.nodeI }, nodeJ: { ...rel.nodeJ } };
  }, [frameEndReleases, getBeamReleaseKey]);

  const openBeamReleaseEditor = useCallback((beam: Beam) => {
    // محرر تبويب الإدخال يقرأ ويكتب على `frameEndReleases` الدائم فقط
    setReleaseEditorBeamId(beam.id);
    setReleaseEditorData(getPersistentBeamReleaseState(beam));
    setReleaseEditorDims({ b: beam.b, h: beam.h });
    setReleaseEditorApplyOtherFloors(false);
  }, [getPersistentBeamReleaseState]);

  const handleEditBeamProperties = useCallback((beamId: string) => {
    const beam = beams.find(b => b.id === beamId);
    if (beam) openBeamReleaseEditor(beam);
  }, [beams, openBeamReleaseEditor]);

  const handleReleaseEditorToggle = useCallback((end: 'nodeI' | 'nodeJ', dof: ReleaseDOF, checked: boolean) => {
    setReleaseEditorData(prev => ({
      ...prev,
      [end]: { ...prev[end], [dof]: checked },
    }));
  }, []);

  const resetReleaseEditorEnd = useCallback((end: 'nodeI' | 'nodeJ') => {
    setReleaseEditorData(prev => ({
      ...prev,
      [end]: { ...EMPTY_BEAM_END_RELEASES[end] },
    }));
  }, []);

  const saveBeamReleaseEditor = useCallback(() => {
    if (!releaseEditorBeamId) return;
    const beam = beams.find(item => item.id === releaseEditorBeamId);
    if (!beam) return;

    dispatch({
      type: 'SET_FRAME_END_RELEASES',
      posKey: getBeamReleaseKey(beam),
      nodeIRestraints: releaseEditorData.nodeI,
      nodeJRestraints: releaseEditorData.nodeJ,
    });

    // Save dimensions (always dispatch — let the user decide what to save)
    const newB = Number(releaseEditorDims.b) || beam.b;
    const newH = Number(releaseEditorDims.h) || beam.h;
    if (releaseEditorApplyOtherFloors) {
      // Apply to all beams at same x1,y1,x2,y2 position (different floors)
      const samePosBeans = beams.filter(b =>
        Math.abs(b.x1 - beam.x1) < 0.01 && Math.abs(b.y1 - beam.y1) < 0.01 &&
        Math.abs(b.x2 - beam.x2) < 0.01 && Math.abs(b.y2 - beam.y2) < 0.01
      );
      for (const b of samePosBeans) {
        dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { b: newB, h: newH } });
      }
    } else {
      dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: beam.id, override: { b: newB, h: newH } });
    }

    dispatch({ type: 'RESET_ANALYSIS' });
    setReleaseEditorBeamId(null);
  }, [releaseEditorBeamId, beams, releaseEditorData, getBeamReleaseKey, releaseEditorDims, releaseEditorApplyOtherFloors]);

  const releaseEditorBeam = useMemo(
    () => beams.find(beam => beam.id === releaseEditorBeamId) || null,
    [beams, releaseEditorBeamId]
  );

  const releaseEditorWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (releaseEditorData.nodeI.ux && releaseEditorData.nodeJ.ux) warnings.push('لا يمكن تحرير U1 من الطرفين معاً لأنه يسبب عدم استقرار.');
    if (releaseEditorData.nodeI.uy && releaseEditorData.nodeJ.uy) warnings.push('لا يمكن تحرير U2 من الطرفين معاً لأنه يسبب عدم استقرار.');
    if (releaseEditorData.nodeI.uz && releaseEditorData.nodeJ.uz) warnings.push('لا يمكن تحرير U3 من الطرفين معاً لأنه يسبب عدم استقرار.');
    if (releaseEditorData.nodeI.rx && releaseEditorData.nodeJ.rx) warnings.push('لا يمكن تحرير R1 من الطرفين معاً لأنه يسبب عدم استقرار.');
    if (releaseEditorData.nodeI.ry && releaseEditorData.nodeJ.ry && (releaseEditorData.nodeI.uz || releaseEditorData.nodeJ.uz)) warnings.push('تحرير R2 من الطرفين مع U3 قد يجعل الجسر غير مستقر.');
    if (releaseEditorData.nodeI.rz && releaseEditorData.nodeJ.rz && (releaseEditorData.nodeI.uy || releaseEditorData.nodeJ.uy)) warnings.push('تحرير R3 من الطرفين مع U2 قد يجعل الجسر غير مستقر.');
    return warnings;
  }, [releaseEditorData]);

  const beamDesigns = useMemo(() => {
    // ── مسار ETABS: تصميم من نتائج ETABS المستوردة ──
    if (designSource === 'etabs' && designExecuted && etabsAnalysisData.length > 0) {
      const designs: {
        beamId: string; frameId: string; span: number;
        Mleft: number; Mmid: number; Mright: number; Vu: number;
        Rleft: number; Rright: number;
        flexLeft: FlexureResult; flexMid: FlexureResult; flexRight: FlexureResult;
        shear: ShearResult; deflection: DeflectionResult;
      }[] = [];

      for (const ed of etabsAnalysisData) {
        // تطابق الدور: تسمية مطابقة أو رقمية (Story1=الدور 1، وما إلى ذلك)
        const storyForED = stories.find(s =>
          s.label === ed.story ||
          s.label.toLowerCase() === ed.story.toLowerCase() ||
          s.label.replace(/\s+/g, '').toLowerCase() === ed.story.replace(/\s+/g, '').toLowerCase()
        ) || (() => {
          // تطابق رقمي: "Story3" → الدور الثالث
          const m = ed.story.match(/(\d+)$/);
          if (!m) return undefined;
          const idx = parseInt(m[1]) - 1;
          return idx >= 0 && idx < stories.length ? stories[idx] : undefined;
        })();

        // تطابق الجسر: دقيق أولاً، ثم تطابق بادئة (جسر مقسّم)، ثم تطابق جزئي
        let beam = beamsWithLoads.find(b =>
          b.id === ed.beamId && (storyForED ? b.storyId === storyForED.id : true)
        ) || beamsWithLoads.find(b => b.id === ed.beamId);

        // تطابق الجسور المقسّمة: ETABS "B1" ↔ التطبيق "B1-1" أو "B1-L" إلخ
        if (!beam) {
          beam = beamsWithLoads.find(b =>
            (b.id.startsWith(ed.beamId + '-') || b.id.startsWith(ed.beamId + '_')) &&
            (storyForED ? b.storyId === storyForED.id : true)
          ) || beamsWithLoads.find(b =>
            b.id.startsWith(ed.beamId + '-') || b.id.startsWith(ed.beamId + '_')
          );
        }

        // إذا لم يُوجد تطابق: استخدام أبعاد الجسر الافتراضية
        const effectiveBeam = beam || {
          id: ed.beamId,
          b: beamB, h: beamH,
          length: 5000,
          slabs: [] as string[],
          direction: 'horizontal' as const,
          deadLoad: 0, liveLoad: 0,
        };
        const span = effectiveBeam.length > 0 ? effectiveBeam.length / 1000 : 1;

        const hasSlabs = effectiveBeam.slabs.length > 0;
        let effectiveFlangeWidth = 0;
        if (hasSlabs) {
          const widths: number[] = [];
          for (const slabId of effectiveBeam.slabs) {
            const slab = slabs.find(s => s.id === slabId);
            if (slab) widths.push(effectiveBeam.direction === 'horizontal' ? Math.abs(slab.y2 - slab.y1) : Math.abs(slab.x2 - slab.x1));
          }
          effectiveFlangeWidth = Math.min(span * 1000 / 4, effectiveBeam.b + 16 * slabProps.thickness, widths.reduce((a, b) => a + b, 0) * 1000);
        }

        const flexLeft  = designFlexure(ed.Mleft,  effectiveBeam.b, effectiveBeam.h, mat.fc, mat.fy);
        const flexMid   = designFlexure(ed.Mmid,   effectiveBeam.b, effectiveBeam.h, mat.fc, mat.fy, 40, hasSlabs, slabProps.thickness, effectiveFlangeWidth, 4);
        const flexRight = designFlexure(ed.Mright, effectiveBeam.b, effectiveBeam.h, mat.fc, mat.fy);
        const wuBeam = 1.2 * (effectiveBeam.deadLoad || 0) + 1.6 * (effectiveBeam.liveLoad || 0);
        const AsForShear = Math.max(flexLeft.As, flexMid.As, flexRight.As);
        const shear = designShear(ed.Vu, effectiveBeam.b, effectiveBeam.h, mat.fc, mat.fyt, 40, mat.stirrupDia || 10, wuBeam, 300, AsForShear);
        const deflection = calculateDeflection(span, effectiveBeam.b, effectiveBeam.h, mat.fc, effectiveBeam.deadLoad || 0, effectiveBeam.liveLoad || 0, flexMid.As, 'both-ends', 'B', flexMid.As * 0.3, 1.0, 60);

        designs.push({
          beamId: ed.beamId, frameId: '', span,
          Mleft: ed.Mleft, Mmid: ed.Mmid, Mright: ed.Mright, Vu: ed.Vu,
          Rleft: 0, Rright: 0,
          flexLeft, flexMid, flexRight, shear, deflection,
        });
      }
      return designs;
    }

    // ── مسار التطبيق: تصميم من محركات التحليل الداخلية ──
    if (!analyzed || !designExecuted) return [];
    const designs: {
      beamId: string; frameId: string; span: number;
      Mleft: number; Mmid: number; Mright: number; Vu: number;
      Rleft: number; Rright: number;
      flexLeft: FlexureResult; flexMid: FlexureResult; flexRight: FlexureResult;
      shear: ShearResult;
      deflection: DeflectionResult;
      mergedCarrierIds?: string[]; // IDs of merged carrier beam segments
    }[] = [];

    // Track which beams have been merged as part of a carrier group
    const mergedBeamIds = new Set<string>();

    // First pass: identify carrier beam pairs and merge them
    for (const conn of bobConnections) {
      if (!conn.continuationBeamId) continue;
      const primaryId = conn.primaryBeamId;
      const contId = conn.continuationBeamId;
      mergedBeamIds.add(primaryId);
      mergedBeamIds.add(contId);

      // Find analysis results for both segments
      let primaryResult: typeof frameResults[0]['beams'][0] | undefined;
      let contResult: typeof frameResults[0]['beams'][0] | undefined;
      let primaryFrame: typeof frameResults[0] | undefined;
      for (const fr of frameResults) {
        for (const br of fr.beams) {
          if (br.beamId === primaryId) { primaryResult = br; primaryFrame = fr; }
          if (br.beamId === contId) { contResult = br; }
        }
      }
      if (!primaryResult || !contResult || !primaryFrame) continue;

      const beamA = beamsWithLoads.find(b => b.id === primaryId);
      const beamB = beamsWithLoads.find(b => b.id === contId);
      if (!beamA || !beamB) continue;

      // Merge: use envelope of both segments
      const totalSpan = primaryResult.span + contResult.span;
      const envMleft = Math.max(Math.abs(primaryResult.Mleft), Math.abs(contResult.Mleft));
      const envMright = Math.max(Math.abs(primaryResult.Mright), Math.abs(contResult.Mright));
      const envMmid = Math.max(primaryResult.Mmid, contResult.Mmid);
      const envVu = Math.max(
        Math.max(Math.abs(primaryResult.Rleft || 0), Math.abs(primaryResult.Rright || 0)),
        Math.max(Math.abs(contResult.Rleft || 0), Math.abs(contResult.Rright || 0))
      );

      // Use the larger cross-section for design
      const designBeam = beamA.b * beamA.h >= beamB.b * beamB.h ? beamA : beamB;

      // T-beam effective flange width
      const hasSlabs = designBeam.slabs.length > 0;
      let effectiveFlangeWidth = 0;
      if (hasSlabs) {
        const adjacentSlabWidths: number[] = [];
        for (const slabId of designBeam.slabs) {
          const slab = slabs.find(s => s.id === slabId);
          if (!slab) continue;
          if (designBeam.direction === 'horizontal') {
            adjacentSlabWidths.push(Math.abs(slab.y2 - slab.y1));
          } else {
            adjacentSlabWidths.push(Math.abs(slab.x2 - slab.x1));
          }
        }
        const ccSpacing = adjacentSlabWidths.reduce((a, b) => a + b, 0);
        effectiveFlangeWidth = Math.min(
          totalSpan * 1000 / 4,
          designBeam.b + 16 * slabProps.thickness,
          ccSpacing * 1000
        );
      }

      const flexLeft = designFlexure(envMleft, designBeam.b, designBeam.h, mat.fc, mat.fy);
      const flexMid = designFlexure(envMmid, designBeam.b, designBeam.h, mat.fc, mat.fy, 40,
        hasSlabs, slabProps.thickness, effectiveFlangeWidth, 4);
      const flexRight = designFlexure(envMright, designBeam.b, designBeam.h, mat.fc, mat.fy);
      const wuBeam = 1.2 * designBeam.deadLoad + 1.6 * designBeam.liveLoad;
      const AsForShear = Math.max(flexLeft.As, flexMid.As, flexRight.As);
      const shear = designShear(envVu, designBeam.b, designBeam.h, mat.fc, mat.fyt, 40, mat.stirrupDia || 10, wuBeam, 300, AsForShear);
      const AsPrimeForDefl = flexMid.As * 0.3;
      const deflection = calculateDeflection(totalSpan, designBeam.b, designBeam.h, mat.fc, designBeam.deadLoad, designBeam.liveLoad, flexMid.As, 'both-ends', 'B', AsPrimeForDefl, 1.0, 60);

      // Push ONE merged design entry for the primary beam ID
      designs.push({
        beamId: primaryId, frameId: primaryFrame.frameId, span: totalSpan,
        Mleft: primaryResult.Mleft, Mmid: envMmid, Mright: contResult.Mright,
        Vu: envVu,
        Rleft: primaryResult.Rleft || 0, Rright: contResult.Rright || 0,
        flexLeft, flexMid, flexRight, shear, deflection,
        mergedCarrierIds: [primaryId, contId],
      });
    }

    // ── اكتشاف مجموعات الجسور المقسّمة (مثل: 67-1, 67-2, 67-3) ──────────────
    // الجسور التي تحمل اسمًا مثل "X-N" حيث N رقم تسلسلي هي أجزاء جسر واحد
    // قُسّم أثناء النمذجة — نجمعها هنا ونصمّمها كجسر واحد في مرحلة ثالثة.
    const splitGroupMap = new Map<string, { beamId: string; frameIdx: number; beamIdx: number }[]>();
    for (let fi = 0; fi < frameResults.length; fi++) {
      for (let bi = 0; bi < frameResults[fi].beams.length; bi++) {
        const beamId = frameResults[fi].beams[bi].beamId;
        const m = beamId.match(/^(.+)-(\d+)$/);
        if (!m) continue;
        const baseId = m[1];
        if (!splitGroupMap.has(baseId)) splitGroupMap.set(baseId, []);
        splitGroupMap.get(baseId)!.push({ beamId, frameIdx: fi, beamIdx: bi });
      }
    }
    // احتفظ فقط بالمجموعات التي تحوي جزأين أو أكثر
    const splitPartIds = new Set<string>();
    for (const [baseId, parts] of splitGroupMap) {
      if (parts.length < 2) { splitGroupMap.delete(baseId); continue; }
      for (const p of parts) splitPartIds.add(p.beamId);
    }

    // Second pass: design non-carrier beams normally
    for (const fr of frameResults) {
      const numBeams = fr.beams.length;
      for (let bi = 0; bi < numBeams; bi++) {
        const br = fr.beams[bi];
        if (mergedBeamIds.has(br.beamId)) continue; // already merged
        if (splitPartIds.has(br.beamId)) continue;   // part of a split group — handled in 3rd pass
        const beam = beamsWithLoads.find(b => b.id === br.beamId);
        if (!beam) continue;

        const hasSlabs = beam.slabs.length > 0;
        let effectiveFlangeWidth = 0;
        if (hasSlabs) {
          const adjacentSlabWidths: number[] = [];
          for (const slabId of beam.slabs) {
            const slab = slabs.find(s => s.id === slabId);
            if (!slab) continue;
            if (beam.direction === 'horizontal') {
              adjacentSlabWidths.push(Math.abs(slab.y2 - slab.y1));
            } else {
              adjacentSlabWidths.push(Math.abs(slab.x2 - slab.x1));
            }
          }
          const ccSpacing = adjacentSlabWidths.reduce((a, b) => a + b, 0);
          effectiveFlangeWidth = Math.min(
            br.span * 1000 / 4,
            beam.b + 16 * slabProps.thickness,
            ccSpacing * 1000
          );
        }

        const flexLeft = designFlexure(Math.abs(br.Mleft), beam.b, beam.h, mat.fc, mat.fy);
        const flexMid = designFlexure(br.Mmid, beam.b, beam.h, mat.fc, mat.fy, 40,
          hasSlabs, slabProps.thickness, effectiveFlangeWidth, 4);
        const flexRight = designFlexure(Math.abs(br.Mright), beam.b, beam.h, mat.fc, mat.fy);
        const wuBeam = 1.2 * beam.deadLoad + 1.6 * beam.liveLoad;
        const AsForShear = Math.max(flexLeft.As, flexMid.As, flexRight.As);
        const shear = designShear(br.Vu, beam.b, beam.h, mat.fc, mat.fyt, 40, mat.stirrupDia || 10, wuBeam, 300, AsForShear);
        const isExteriorLeft = bi === 0;
        const isExteriorRight = bi === numBeams - 1;
        const endCondition: 'simple' | 'one-end' | 'both-ends' = 
          (isExteriorLeft && isExteriorRight) ? 'simple' :
          (isExteriorLeft || isExteriorRight) ? 'one-end' : 'both-ends';
        const AsPrimeForDefl = flexMid.As * 0.3;
        const deflection = calculateDeflection(br.span, beam.b, beam.h, mat.fc, beam.deadLoad, beam.liveLoad, flexMid.As, endCondition, 'B', AsPrimeForDefl, 1.0, 60);
        designs.push({
          beamId: br.beamId, frameId: fr.frameId, span: br.span,
          Mleft: br.Mleft, Mmid: br.Mmid, Mright: br.Mright, Vu: br.Vu,
          Rleft: br.Rleft || 0, Rright: br.Rright || 0,
          flexLeft, flexMid, flexRight, shear, deflection,
        });
      }
    }
    // ── المرحلة الثالثة: تصميم مجموعات الجسور المقسّمة كجسر واحد ─────────────
    for (const [baseId, parts] of splitGroupMap) {
      // جمع نتائج جميع الأجزاء
      const partData: Array<{
        br: typeof frameResults[0]['beams'][0];
        beam: typeof beamsWithLoads[0];
        frameId: string;
        posMin: number;
      }> = [];

      for (const p of parts) {
        const fr = frameResults[p.frameIdx];
        const br = fr.beams[p.beamIdx];
        const beam = beamsWithLoads.find(b => b.id === br.beamId);
        if (!beam) continue;
        // قيمة للفرز: الحد الأدنى لموضع الجسر (x1 أو y1 بحسب الاتجاه)
        const posMin = beam.direction === 'horizontal'
          ? Math.min(beam.x1, beam.x2)
          : Math.min(beam.y1, beam.y2);
        partData.push({ br, beam, frameId: fr.frameId, posMin });
      }
      if (partData.length === 0) continue;

      // ترتيب الأجزاء بحسب الموضع (يسار → يمين أو أسفل → أعلى)
      partData.sort((a, b) => a.posMin - b.posMin);

      const leftPart  = partData[0];
      const rightPart = partData[partData.length - 1];

      // الجسر المرجعي: أكبر مقطع
      const refBeam = partData.reduce((best, p) =>
        p.beam.b * p.beam.h >= best.b * best.h ? p.beam : best,
        partData[0].beam,
      );

      const totalSpan = partData.reduce((s, p) => s + p.br.span, 0);

      // العزوم: يسار من الجزء الأيسر، يمين من الجزء الأيمن، أقصى عزم موجب من الكل
      const Mleft  = Math.abs(leftPart.br.Mleft);
      const Mright = Math.abs(rightPart.br.Mright);
      const Mmid   = Math.max(...partData.map(p => p.br.Mmid));
      const Vu     = Math.max(...partData.flatMap(p => [
        Math.abs(p.br.Rleft ?? 0),
        Math.abs(p.br.Rright ?? 0),
      ]));

      // T-beam effective flange width
      const hasSlabs = refBeam.slabs.length > 0;
      let effectiveFlangeWidth = 0;
      if (hasSlabs) {
        const widths: number[] = [];
        for (const slabId of refBeam.slabs) {
          const slab = slabs.find(s => s.id === slabId);
          if (!slab) continue;
          widths.push(refBeam.direction === 'horizontal'
            ? Math.abs(slab.y2 - slab.y1)
            : Math.abs(slab.x2 - slab.x1));
        }
        effectiveFlangeWidth = Math.min(
          totalSpan * 1000 / 4,
          refBeam.b + 16 * slabProps.thickness,
          widths.reduce((a, b) => a + b, 0) * 1000,
        );
      }

      const flexLeft  = designFlexure(Mleft,  refBeam.b, refBeam.h, mat.fc, mat.fy);
      const flexMid   = designFlexure(Mmid,   refBeam.b, refBeam.h, mat.fc, mat.fy, 40,
        hasSlabs, slabProps.thickness, effectiveFlangeWidth, 4);
      const flexRight = designFlexure(Mright, refBeam.b, refBeam.h, mat.fc, mat.fy);
      const wuBeam = 1.2 * refBeam.deadLoad + 1.6 * refBeam.liveLoad;
      const AsForShear = Math.max(flexLeft.As, flexMid.As, flexRight.As);
      const shear = designShear(Vu, refBeam.b, refBeam.h, mat.fc, mat.fyt, 40,
        mat.stirrupDia || 10, wuBeam, 300, AsForShear);
      const deflection = calculateDeflection(totalSpan, refBeam.b, refBeam.h, mat.fc,
        refBeam.deadLoad, refBeam.liveLoad, flexMid.As, 'both-ends', 'B',
        flexMid.As * 0.3, 1.0, 60);

      designs.push({
        beamId: baseId,
        frameId: leftPart.frameId,
        span: totalSpan,
        Mleft: -Mleft,
        Mmid,
        Mright: -Mright,
        Vu,
        Rleft:  leftPart.br.Rleft  ?? 0,
        Rright: rightPart.br.Rright ?? 0,
        flexLeft, flexMid, flexRight, shear, deflection,
        mergedCarrierIds: parts.map(p => p.beamId),
      });
    }

    return designs;
  }, [frameResults, beamsWithLoads, mat, analyzed, bobConnections, slabs, slabProps, designSource, designExecuted, etabsAnalysisData]);

  // Map of canonical beamId → merged part IDs (for split beams like 67 → [67-1, 67-2, 67-3])
  const splitBeamGroups = useMemo<Record<string, string[]>>(() => {
    const groups: Record<string, string[]> = {};
    for (const d of beamDesigns) {
      const mids = (d as any).mergedCarrierIds as string[] | undefined;
      if (mids && mids.length >= 2) {
        groups[d.beamId] = mids;
      }
    }
    return groups;
  }, [beamDesigns]);

  // Beam diagnostics - detailed ACI 318-19 compliance check
  const beamDiagnostics = useMemo<Map<string, BeamDiagnostic>>(() => {
    const map = new Map<string, BeamDiagnostic>();
    for (const d of beamDesigns) {
      const beam = beamsWithLoads.find(b => b.id === d.beamId);
      if (!beam) continue;
      // ACI 318-19: each section designed independently; Mu_max for reporting only
      const Mu_max = Math.max(Math.abs(d.Mleft), Math.abs(d.Mmid), Math.abs(d.Mright));

      // Calculate effective flange width for T-beam diagnosis
      let effFlangeW = 0;
      if (beam.slabs.length > 0) {
        const adjacentWidths: number[] = [];
        for (const slabId of beam.slabs) {
          const slab = slabs.find(s => s.id === slabId);
          if (!slab) continue;
          if (beam.direction === 'horizontal') {
            adjacentWidths.push(Math.abs(slab.y2 - slab.y1));
          } else {
            adjacentWidths.push(Math.abs(slab.x2 - slab.x1));
          }
        }
        const ccSpacing = adjacentWidths.reduce((a, b) => a + b, 0);
        effFlangeW = Math.min(d.span * 1000 / 4, beam.b + 16 * slabProps.thickness, ccSpacing * 1000);
      }

      const diag = diagnoseBeam(
        d.beamId,
        { b: beam.b, h: beam.h, length: beam.length },
        d.flexLeft, d.flexMid, d.flexRight,
        d.shear, d.deflection,
        mat.fc, mat.fy, mat.fyt,
        d.span, Mu_max, d.Vu,
        effFlangeW, slabProps.thickness,
      );
      map.set(d.beamId, diag);
    }
    return map;
  }, [beamDesigns, beamsWithLoads, mat]);

  const colLoads = useMemo(() => {
    if (!analyzed) return new Map<string, { Pu: number; Mu: number }>();
    return calculateColumnLoads(columns, beamsWithLoads, frameResults);
  }, [analyzed, columns, beamsWithLoads, frameResults]);

  // 2D frame results (kept only for comparison/fallback paths)
  // MUST match runAnalysis logic for legacy_2d to produce consistent results
  const frameResults2D = useMemo(() => {
    if (!analyzed) return [] as FrameResult[];
    const bMap = new Map(beamsWithLoads.map(b => [b.id, b]));
    const beamHinges2D = new Map<string, 'I' | 'J' | 'BOTH'>();
    for (const beam of beamsWithLoads) {
      const rs = getBeamReleaseState(beam);
      const hasHingeI = rs.nodeI.rx || rs.nodeI.ry || rs.nodeI.rz;
      const hasHingeJ = rs.nodeJ.rx || rs.nodeJ.ry || rs.nodeJ.rz;
      if (hasHingeI && hasHingeJ) beamHinges2D.set(beam.id, 'BOTH');
      else if (hasHingeI) beamHinges2D.set(beam.id, 'I');
      else if (hasHingeJ) beamHinges2D.set(beam.id, 'J');
    }
    // Use beam-on-beam analysis when applicable (same as runAnalysis)
    if (removedColumnIds.length > 0 && detectedConnections.length > 0) {
      const result = analyzeWithBeamOnBeam(frames, bMap, columns, mat, removedColumnIds, detectedConnections, 10, 0.01, beamHinges2D, beamStiffnessFactor, colStiffnessFactor);
      return result.frameResults;
    }
    return frames.map(f => analyzeFrame(f, bMap, columns, mat, removedColumnIds, undefined, beamHinges2D, undefined, beamStiffnessFactor, colStiffnessFactor));
  }, [analyzed, frames, beamsWithLoads, columns, mat, getBeamReleaseState, removedColumnIds, detectedConnections, beamStiffnessFactor, colStiffnessFactor]);

  // Beam hinge map for diagram rendering
  const beamHingesMap = useMemo(() => {
    const m = new Map<string, 'I' | 'J' | 'BOTH'>();
    for (const beam of beamsWithLoads) {
      const rs = getBeamReleaseState(beam);
      const hi = rs.nodeI.rx || rs.nodeI.ry || rs.nodeI.rz;
      const hj = rs.nodeJ.rx || rs.nodeJ.ry || rs.nodeJ.rz;
      if (hi && hj) m.set(beam.id, 'BOTH');
      else if (hi) m.set(beam.id, 'I');
      else if (hj) m.set(beam.id, 'J');
    }
    return m;
  }, [beamsWithLoads, getBeamReleaseState]);


  // 3D frame results for COMPARISON / DIAGRAMS / VIEW tabs.
  //
  // ✅ سياسة جديدة (بناءً على طلب المستخدم):
  // **لا يوجد أي "تصفير قسري"** للعزوم عند النهايات المحررة في أي مكان.
  // كل المخرجات (جدول الفريمات، مقارنة ETABS، الرسوم البيانية BMD، تبويب
  // العرض) تعرض **القيمة الفعلية الناتجة من محرك التحليل 3D Legacy** كما هي.
  //
  // عند تحرير نهاية الجسر (مثلاً R3 = موقع مفصل) المحرك يطبّق static
  // condensation داخلياً، والقيمة المتبقية في الجدول قد تكون:
  //   • صفر تقريباً (لجسر بسيط بحمل متماثل)
  //   • قيمة سالبة صغيرة (هوغ متبقّي بسبب التوزيع الحقيقي للعزم بعد المفصل،
  //     خاصةً لجسر مستمر يحرَّر طرف واحد فقط منه — هذا سلوك فيزيائي صحيح).
  //
  // المحرك 3D Legacy لا يستخدم اتصالات beam-on-beam مطلقاً ⇒ نمرّر [].
  const frameResults3DRaw = useMemo(() => {
    if (!analyzed || frames.length === 0) return [] as FrameResult[];
    try {
      const conns3DLegacy: BeamOnBeamConnection[] = [];
      return getFrameResults3D(
        frames, beamsWithLoads, columns, mat, effectiveFrameEndReleases, conns3DLegacy,
        slabs, slabProps, false, beamStiffnessFactor, colStiffnessFactor,
        /* enforceReleasedZeros */ false, colRigidEndOffsets, manualJointOverrides,
      );
    } catch {
      return [] as FrameResult[];
    }
  }, [analyzed, frames, beamsWithLoads, columns, mat, effectiveFrameEndReleases, slabs, slabProps, beamStiffnessFactor, colStiffnessFactor, colRigidEndOffsets, manualJointOverrides]);

  // Global Frame results for comparison
  const frameResultsGF = useMemo(() => {
    if (!analyzed || frames.length === 0) return [] as FrameResult[];
    try {
      return getFrameResultsGlobalFrame(frames, beamsWithLoads, columns, mat, effectiveFrameEndReleases, autoDetectedConnections, slabs, slabProps, beamStiffnessFactor, colStiffnessFactor, colRigidEndOffsets);
    } catch {
      return [] as FrameResult[];
    }
  }, [analyzed, frames, beamsWithLoads, columns, mat, effectiveFrameEndReleases, autoDetectedConnections, slabs, slabProps, beamStiffnessFactor, colStiffnessFactor, colRigidEndOffsets]);

  // Unified Core = identical algorithm to Global Frame (both are aliases for getFrameResults3D).
  // Reuse the cached GF result to avoid a redundant full 3D solve.
  const frameResultsUC = frameResultsGF;

  // 2D column loads (kept for comparison/fallback)
  const colLoadsBiaxial = useMemo(() => {
    if (!analyzed) return new Map<string, { Pu: number; Mx: number; My: number; MxTop: number; MxBot: number; MyTop: number; MyBot: number }>();
    return calculateColumnLoadsBiaxial(columns, beamsWithLoads, frameResults2D, stories);
  }, [analyzed, columns, beamsWithLoads, frameResults2D, stories]);

  // 3D column loads — PRIMARY results for design
  const colLoads3D = useMemo(() => {
    if (!analyzed || frames.length === 0) return new Map();
    try {
      // 3D Legacy: نقل أحمال البلاطات إلى الجسور بنفس طريقة محرك 2D
      // (التوزيع الهندسي عبر buildSlabEdgeLoads + computeBeamLoadProfile — نظرية خط الانهيار/المساحة الرافدة)
      // وليس عبر FEM، لضمان تطابق الأحمال المنقولة بين 2D و 3D Legacy.
      return getColumnLoads3D(frames, beamsWithLoads, columns, mat, effectiveFrameEndReleases, autoDetectedConnections, slabs, slabProps, false, beamStiffnessFactor, colStiffnessFactor, colRigidEndOffsets, manualJointOverrides);
    } catch {
      // Fallback to 2D if 3D fails
      return colLoadsBiaxial;
    }
  }, [analyzed, frames, beamsWithLoads, columns, mat, colLoadsBiaxial, effectiveFrameEndReleases, autoDetectedConnections, slabs, slabProps, beamStiffnessFactor, colStiffnessFactor, colRigidEndOffsets, manualJointOverrides]);

  const jointConnectivity = useMemo(() => {
    if (!analyzed) return [] as JointConnectivityInfo[];
    return getJointConnectivityInfo(columns, beamsWithLoads, frameResults);
  }, [analyzed, columns, beamsWithLoads, frameResults]);

  const colDesigns = useMemo(() => {
    if (designSource === 'etabs' && designExecuted && etabsColumnResults.length > 0) {
      return columns.filter(c => !c.isRemoved).map(c => {
        const storyForCol = stories.find(s => s.id === c.storyId);
        const etabsData = etabsColumnResults.find(ec =>
          ec.colId === c.id && (storyForCol ? ec.story === storyForCol.label : true)
        ) || etabsColumnResults.find(ec => ec.colId === c.id);
        const Pu = etabsData ? Math.abs(etabsData.P) : 0;
        const Mx = etabsData?.M2 ?? 0;
        const My = etabsData?.M3 ?? 0;
        return {
          ...c, Pu, Mx, My, Mu: Math.max(Mx, My),
          design: designColumnBiaxial(Pu, Mx, My, c.b, c.h, mat.fc, mat.fy, c.L, undefined, undefined, undefined, undefined, undefined, undefined, false, c.orientAngle),
        };
      });
    }
    return columns.filter(c => !c.isRemoved).map(c => {
      const loads = colLoads3D.get(c.id) || { Pu: 0, Mx: 0, My: 0, MxTop: 0, MxBot: 0, MyTop: 0, MyBot: 0 };
      return {
        ...c, Pu: loads.Pu, Mx: loads.Mx, My: loads.My,
        Mu: Math.max(loads.Mx, loads.My),
        design: designColumnBiaxial(
          loads.Pu, loads.Mx, loads.My, c.b, c.h, mat.fc, mat.fy, c.L,
          undefined, undefined,
          loads.MxTop, loads.MxBot, loads.MyTop, loads.MyBot,
          false, c.orientAngle,
        ),
      };
    });
  }, [columns, colLoads3D, mat, designSource, designExecuted, etabsColumnResults, stories]);

  // Bent-up bars calculation
  const bentUpResults = useMemo(() => {
    if (!analyzed) return [] as FrameBentUpResult[];
    const bMap = new Map(beamsWithLoads.map(b => [b.id, b]));
    // Collect all secondary (carried) beam IDs from detected connections
    // Secondary beams must NOT have bent-up bars (they sit on hinges, bars run straight)
    const secBeamIds = new Set<string>();
    for (const conn of detectedConnections) {
      for (const id of conn.secondaryBeamIds) secBeamIds.add(id);
    }
    return frames.map(f => {
      const fr = frameResults.find(r => r.frameId === f.id);
      if (!fr) return null;
      return calculateFrameBentUp(f, bMap, fr, mat, frames, secBeamIds);
    }).filter(Boolean) as FrameBentUpResult[];
  }, [analyzed, frames, beamsWithLoads, frameResults, mat, detectedConnections]);

  const slabDesigns = useMemo(() =>
    slabs.map(s => ({ ...s, design: designSlab(s, slabProps, mat, slabs, columns) })),
    [slabs, slabProps, mat, columns]
  );

  const handleCanvasClick = useCallback((x: number, y: number) => {
    if (activeTool === 'node') {
      modelManager.createNode(x, y, 0);
      dispatch({ type: 'INC_MODEL_VERSION' });
    } else if (activeTool === 'beam' || activeTool === 'column') {
      if (!pendingNode) {
        dispatch({ type: 'SET_PENDING_NODE', node: { x, y } });
      } else {
        const ni = modelManager.createNode(pendingNode.x, pendingNode.y, 0);
        if (activeTool === 'beam') {
          const nj = modelManager.createNode(x, y, 0);
          const sections = modelManager.getAllSections();
          const beamSec = sections.find(s => s.type === 'beam') || modelManager.createSection('B', beamB, beamH, 'beam');
          modelManager.createBeam(ni.id, nj.id, beamSec.id);
        } else {
          const nj = modelManager.createNode(x, y, -(colL / 1000));
          const sections = modelManager.getAllSections();
          const colSec = sections.find(s => s.type === 'column') || modelManager.createSection('C', colB, colH, 'column');
          modelManager.createColumn(nj.id, ni.id, colSec.id);
        }
        dispatch({ type: 'SET_PENDING_NODE', node: null });
        dispatch({ type: 'INC_MODEL_VERSION' });
      }
    } else if (activeTool === 'delete') {
      const nearest = modelManager.getAllNodes().find(n =>
        Math.abs(n.x - x) < 0.3 && Math.abs(n.y - y) < 0.3
      );
      if (nearest) {
        modelManager.deleteNode(nearest.id);
        dispatch({ type: 'INC_MODEL_VERSION' });
      }
    }
  }, [activeTool, pendingNode, beamB, beamH, colB, colH, colL]);

  const handleNodeClick = useCallback((id: number) => {
    dispatch({ type: 'SELECT_NODE', id });
    if (activeTool === 'delete') {
      modelManager.deleteNode(id);
      dispatch({ type: 'SELECT_NODE', id: null });
      dispatch({ type: 'INC_MODEL_VERSION' });
    }
  }, [activeTool]);

  const handleFrameClick = useCallback((id: number) => {
    dispatch({ type: 'SELECT_FRAME', id });
    if (activeTool === 'delete') {
      modelManager.deleteElement(id);
      dispatch({ type: 'SELECT_FRAME', id: null });
      dispatch({ type: 'INC_MODEL_VERSION' });
    }
  }, [activeTool]);

  const handleAreaClick = useCallback((id: number) => {
    dispatch({ type: 'SELECT_AREA', id });
    if (activeTool === 'delete') {
      modelManager.deleteArea(id);
      dispatch({ type: 'SELECT_AREA', id: null });
      dispatch({ type: 'INC_MODEL_VERSION' });
    }
  }, [activeTool]);

  const handleNodeRestraintChange = useCallback((nodeId: number, restraints: any) => {
    modelManager.setNodeRestraints(nodeId, restraints);
    dispatch({ type: 'INC_MODEL_VERSION' });
  }, []);

  const handleFrameLongPress = useCallback((id: number) => {
    dispatch({ type: 'OPEN_ELEM_PROPS', frameId: id });
  }, []);

  const handleAreaLongPress = useCallback((id: number) => {
    dispatch({ type: 'OPEN_ELEM_PROPS', areaId: id });
  }, []);

  const handleElemPropsSave = useCallback((data: any) => {
    if (data.frameId != null) {
      modelManager.updateFrameSection(data.frameId, data.b, data.h);
      const frame = modelManager.getFrame(data.frameId);
      if (frame) {
        // Persist beam dimensions to React state so they survive model rebuilds
        if (frame.type === 'beam' && data.b != null && data.h != null) {
          const nodeI = modelManager.getNode(frame.nodeI);
          const nodeJ = modelManager.getNode(frame.nodeJ);
          if (nodeI && nodeJ) {
            const EPS = 0.005;
            const matchingBeam = beams.find(b =>
              (Math.abs(b.x1 - nodeI.x) < EPS && Math.abs(b.y1 - nodeI.y) < EPS &&
               Math.abs(b.x2 - nodeJ.x) < EPS && Math.abs(b.y2 - nodeJ.y) < EPS) ||
              (Math.abs(b.x1 - nodeJ.x) < EPS && Math.abs(b.y1 - nodeJ.y) < EPS &&
               Math.abs(b.x2 - nodeI.x) < EPS && Math.abs(b.y2 - nodeI.y) < EPS)
            );
            if (matchingBeam) {
              dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: matchingBeam.id, override: { b: Number(data.b), h: Number(data.h) } });
            }
          }
        }
        if (data.nodeIRestraints) {
          modelManager.setNodeRestraints(frame.nodeI, data.nodeIRestraints);
          modelManager.setNodeRestraints(frame.nodeJ, data.nodeJRestraints);
          // Persist end releases in state keyed by node positions so they survive model rebuilds
          const nodeI = modelManager.getNode(frame.nodeI);
          const nodeJ = modelManager.getNode(frame.nodeJ);
          if (nodeI && nodeJ) {
            const posKey = `${nodeI.x.toFixed(3)}_${nodeI.y.toFixed(3)}_${nodeJ.x.toFixed(3)}_${nodeJ.y.toFixed(3)}`;
            // التحرير من ElementPropertiesDialog (long-press في تبويبات النمذجة/العرض/التحليل)
            // يُحفظ دائماً في frameEndReleases ليظهر في جدول جسور تبويب الإدخال.
            dispatch({ type: 'SET_FRAME_END_RELEASES', posKey, nodeIRestraints: data.nodeIRestraints, nodeJRestraints: data.nodeJRestraints });
            dispatch({ type: 'SET_TRANSIENT_FRAME_END_RELEASES', posKey, nodeIRestraints: data.nodeIRestraints, nodeJRestraints: data.nodeJRestraints });
          }
        }
      }
    }
    if (data.areaId != null && data.thickness != null) {
      modelManager.updateAreaThickness(data.areaId, data.thickness);
    }
    if (data.areaId != null) {
      const override: any = {};
      if (data.thickness != null) override.thickness = data.thickness;
      if (data.finishLoad != null) override.finishLoad = data.finishLoad;
      if (data.liveLoad != null) override.liveLoad = data.liveLoad;
      if (data.cover != null) override.cover = data.cover;
      if (Object.keys(override).length > 0) {
        dispatch({ type: 'SET_SLAB_PROPS_OVERRIDE', areaId: data.areaId, override });
      }
    }
    dispatch({ type: 'INC_MODEL_VERSION' });
    dispatch({ type: 'RESET_ANALYSIS' });
  }, [beams]);

  const handleLevelElementDelete = useCallback((type: 'beam' | 'column' | 'slab', id: string) => {
    if (type === 'beam') {
      const isExtra = extraBeams.some(eb => eb.id === id);
      if (isExtra) {
        dispatch({ type: 'REMOVE_EXTRA_BEAM', id });
      } else if (!removedBeamIds.includes(id)) {
        dispatch({ type: 'TOGGLE_BEAM_REMOVAL', beamId: id });
      }
    } else if (type === 'column') {
      const isExtra = extraColumns.some(ec => ec.id === id);
      if (isExtra) {
        dispatch({ type: 'REMOVE_EXTRA_COLUMN', id });
      } else if (!removedColumnIds.includes(id)) {
        dispatch({ type: 'TOGGLE_COLUMN_REMOVAL', colId: id });
      }
    } else if (type === 'slab') {
      const idx = slabs.findIndex(s => s.id === id);
      if (idx !== -1) {
        dispatch({ type: 'REMOVE_SLAB', index: idx });
      }
    }
    dispatch({ type: 'RESET_ANALYSIS' });
  }, [extraBeams, extraColumns, slabs, removedBeamIds, removedColumnIds]);

  const handleElemPropsDelete = useCallback((data: { frameId?: number; areaId?: number }) => {
    if (data.frameId != null) {
      modelManager.deleteElement(data.frameId);
    }
    if (data.areaId != null) {
      modelManager.deleteArea(data.areaId);
    }
    dispatch({ type: 'CLOSE_ELEM_PROPS' });
    dispatch({ type: 'INC_MODEL_VERSION' });
    dispatch({ type: 'RESET_ANALYSIS' });
  }, []);

  const checkAndRemoveDuplicates = useCallback(() => {
    const EPS = 0.011;
    const items: string[] = [];

    const getNum = (id: string) => parseInt(id.replace(/\D/g, '') || '0', 10);

    // ---- فحص البلاطات المكررة ----
    const slabGroups = new Map<string, typeof slabs>();
    for (const s of slabs) {
      const x1 = Math.min(s.x1, s.x2), y1 = Math.min(s.y1, s.y2);
      const x2 = Math.max(s.x1, s.x2), y2 = Math.max(s.y1, s.y2);
      const key = `${s.storyId || ''}|${x1.toFixed(2)},${y1.toFixed(2)},${x2.toFixed(2)},${y2.toFixed(2)}`;
      if (!slabGroups.has(key)) slabGroups.set(key, []);
      slabGroups.get(key)!.push(s);
    }
    const slabIndicesToRemove: number[] = [];
    for (const [, group] of slabGroups) {
      if (group.length > 1) {
        const sorted = [...group].sort((a, b) => getNum(a.id) - getNum(b.id));
        const toRemove = sorted.slice(0, -1);
        for (const s of toRemove) {
          const idx = slabs.indexOf(s);
          if (idx !== -1) slabIndicesToRemove.push(idx);
          items.push(`بلاطة ${s.id} (مكررة مع ${sorted[sorted.length - 1].id})`);
        }
      }
    }
    const sortedSlabIndices = [...slabIndicesToRemove].sort((a, b) => b - a);
    for (const idx of sortedSlabIndices) {
      dispatch({ type: 'REMOVE_SLAB', index: idx });
    }

    // ---- فحص الجسور المكررة ----
    const beamGroups = new Map<string, typeof beamsWithLoads>();
    for (const b of beamsWithLoads) {
      const x1 = Math.min(b.x1, b.x2), y1 = Math.min(b.y1, b.y2);
      const x2 = Math.max(b.x1, b.x2), y2 = Math.max(b.y1, b.y2);
      const key = `${b.storyId || ''}|${x1.toFixed(2)},${y1.toFixed(2)},${x2.toFixed(2)},${y2.toFixed(2)}`;
      if (!beamGroups.has(key)) beamGroups.set(key, []);
      beamGroups.get(key)!.push(b);
    }
    for (const [, group] of beamGroups) {
      if (group.length > 1) {
        const sorted = [...group].sort((a, b) => getNum(a.id) - getNum(b.id));
        const toRemove = sorted.slice(0, -1);
        for (const b of toRemove) {
          const isExtra = extraBeams.some(eb => eb.id === b.id);
          if (isExtra) {
            dispatch({ type: 'REMOVE_EXTRA_BEAM', id: b.id });
          } else if (!removedBeamIds.includes(b.id)) {
            dispatch({ type: 'TOGGLE_BEAM_REMOVAL', beamId: b.id });
          }
          items.push(`جسر ${b.id} (مكرر مع ${sorted[sorted.length - 1].id})`);
        }
      }
    }

    // ---- فحص الأعمدة المكررة ----
    const colGroups = new Map<string, typeof columns>();
    for (const c of columns.filter(c2 => !c2.isRemoved)) {
      const key = `${c.storyId || ''}|${c.x.toFixed(2)},${c.y.toFixed(2)}`;
      if (!colGroups.has(key)) colGroups.set(key, []);
      colGroups.get(key)!.push(c);
    }
    for (const [, group] of colGroups) {
      if (group.length > 1) {
        const sorted = [...group].sort((a, b) => getNum(a.id) - getNum(b.id));
        const toRemove = sorted.slice(0, -1);
        for (const c of toRemove) {
          const isExtra = extraColumns.some(ec => ec.id === c.id);
          if (isExtra) {
            dispatch({ type: 'REMOVE_EXTRA_COLUMN', id: c.id });
          } else if (!removedColumnIds.includes(c.id)) {
            dispatch({ type: 'TOGGLE_COLUMN_REMOVAL', colId: c.id });
          }
          items.push(`عمود ${c.id} (مكرر مع ${sorted[sorted.length - 1].id})`);
        }
      }
    }

    // ---- فحص النقاط المكررة في ModelManager ----
    const allNodes = modelManager.getAllNodes();
    const nodeDups: number[] = [];
    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const ni = allNodes[i], nj = allNodes[j];
        const dist = Math.sqrt((ni.x - nj.x) ** 2 + (ni.y - nj.y) ** 2 + (ni.z - nj.z) ** 2);
        if (dist < EPS && !nodeDups.includes(ni.id)) {
          nodeDups.push(ni.id);
          items.push(`نقطة N${ni.id} مكررة مع N${nj.id}`);
        }
      }
    }
    for (const nid of nodeDups) {
      modelManager.deleteNode(nid);
    }
    if (nodeDups.length > 0) dispatch({ type: 'INC_MODEL_VERSION' });

    const count = items.length;
    if (count === 0) {
      setDupCheckResult({ message: '✅ لا توجد عناصر مكررة في النموذج', count: 0, items: [] });
    } else {
      dispatch({ type: 'RESET_ANALYSIS' });
      dispatch({ type: 'INC_MODEL_VERSION' });
      setDupCheckResult({ message: `تم حذف ${count} عنصر مكرر بنجاح`, count, items });
    }
  }, [slabs, beamsWithLoads, columns, extraBeams, extraColumns, removedBeamIds, removedColumnIds]);

  const handleAnalysisElementClick = useCallback((beamId: string) => {
    const design = beamDesigns.find(d => d.beamId === beamId);
    const beam = beamsWithLoads.find(b => b.id === beamId);

    // Fallback: search frameResults when design not yet executed (designExecuted === false)
    type FrBeam = typeof frameResults[number]['beams'][number];
    let frBeam: FrBeam | undefined;
    if (!design) {
      for (const fr of frameResults) {
        const found = fr.beams.find(b => b.beamId === beamId);
        if (found) { frBeam = found; break; }
      }
    }

    // Nothing found at all — nothing to show
    if (!design && !frBeam) return;

    const wu = beam ? 1.2 * beam.deadLoad + 1.6 * beam.liveLoad : 0;

    // Determine moment release (hinge) status at each end — يدوي فقط من محرر الإصدارات
    let hingeLeft = false;
    let hingeRight = false;
    if (beam) {
      const releaseState = getBeamReleaseState(beam);
      if (releaseState.nodeI.rz) hingeLeft  = true;
      if (releaseState.nodeJ.rz) hingeRight = true;
    }

    // Carrier-beam point load (from BOB connections on this beam as primary)
    const carrierConn = bobConnections.find(c => c.primaryBeamId === beamId);
    const contConn = bobConnections.find(c => c.continuationBeamId === beamId);
    // Determine if this beam is part of a carrier girder split into segments
    const isCarrierLeft = !!(carrierConn && carrierConn.continuationBeamId); // A1: right end connects to A2
    const isCarrierRight = !!contConn; // A2: left end connects to A1

    const effectiveSpan = design?.span ?? frBeam?.span ?? (beam ? beam.length / 1000 : 5);

    // Calculate total girder span for carrier beams
    let totalGirderSpan: number | undefined;
    if (carrierConn && carrierConn.continuationBeamId) {
      const contBeam = beamsWithLoads.find(b => b.id === carrierConn.continuationBeamId);
      if (contBeam) totalGirderSpan = effectiveSpan + contBeam.length / 1000;
    } else if (contConn) {
      const primaryBeam = beamsWithLoads.find(b => b.id === contConn.primaryBeamId);
      if (primaryBeam) totalGirderSpan = primaryBeam.length / 1000 + effectiveSpan;
    }

    dispatch({
      type: 'OPEN_DIAGRAM',
      data: {
        elementId: beamId,
        elementType: 'beam' as const,
        span:   effectiveSpan,
        Mleft:  design?.Mleft  ?? frBeam?.Mleft  ?? 0,
        Mmid:   design?.Mmid   ?? frBeam?.Mmid   ?? 0,
        Mright: design?.Mright ?? frBeam?.Mright ?? 0,
        Vu:     design?.Vu     ?? frBeam?.Vu     ?? 0,
        deflection: design?.deflection?.deflection,
        wu,
        Rleft:  design?.Rleft  ?? frBeam?.Rleft  ?? 0,
        Rright: design?.Rright ?? frBeam?.Rright ?? 0,
        hingeLeft,
        hingeRight,
        isCarrierLeft,
        isCarrierRight,
        totalGirderSpan,
        // Point-load info for carrier beams (distanceOnPrimary is in metres)
        ...(carrierConn ? {
          pointLoadP: carrierConn.reactionForce,
          pointLoadA: carrierConn.distanceOnPrimary,
        } : {}),
      },
    });
  }, [beamDesigns, beamsWithLoads, frameResults, detectedConnections, bobConnections, getBeamReleaseState]);

  const currentNodes = modelManager.getAllNodes();
  const currentFrames = modelManager.getAllFrames();
  const currentAreas = modelManager.getAllAreas();
  const modelStats = modelManager.getStats();

  // Handle long-press from LevelPlanView (maps string element IDs to frame/area numeric IDs)
  // Uses coordinate-based matching for beams (handles multi-story where UI beam IDs differ from modelManager frame IDs)
  const handleLevelElementLongPress = useCallback((type: 'beam' | 'column' | 'slab', id: string) => {
    if (type === 'slab') {
      const area = currentAreas.find(a => a.label === id || `A${a.id}` === id);
      if (area) dispatch({ type: 'OPEN_ELEM_PROPS', areaId: area.id });
    } else if (type === 'beam') {
      // Find the UI beam by its string ID first
      const uiBeam = beams.find(b => b.id === id);
      if (uiBeam) {
        // Match modelManager frame by coordinate proximity (robust for multi-story structures)
        const EPS = 0.005;
        const frame = currentFrames.find(f => {
          if (f.type !== 'beam') return false;
          const ni = currentNodes.find(n => n.id === f.nodeI);
          const nj = currentNodes.find(n => n.id === f.nodeJ);
          if (!ni || !nj) return false;
          return (
            (Math.abs(ni.x - uiBeam.x1) < EPS && Math.abs(ni.y - uiBeam.y1) < EPS &&
             Math.abs(nj.x - uiBeam.x2) < EPS && Math.abs(nj.y - uiBeam.y2) < EPS) ||
            (Math.abs(ni.x - uiBeam.x2) < EPS && Math.abs(ni.y - uiBeam.y2) < EPS &&
             Math.abs(nj.x - uiBeam.x1) < EPS && Math.abs(nj.y - uiBeam.y1) < EPS)
          );
        });
        if (frame) dispatch({ type: 'OPEN_ELEM_PROPS', frameId: frame.id });
      } else {
        // Fallback: label/id matching for extra beams
        const frame = currentFrames.find(f =>
          f.type === 'beam' && (f.label === id || `B${f.id}` === id || f.id.toString() === id)
        );
        if (frame) dispatch({ type: 'OPEN_ELEM_PROPS', frameId: frame.id });
      }
    } else {
      // column - match by label or coordinate
      const frame = currentFrames.find(f =>
        f.type === 'column' && (f.label === id || `C${f.id}` === id || f.id.toString() === id)
      );
      if (frame) dispatch({ type: 'OPEN_ELEM_PROPS', frameId: frame.id });
    }
  }, [currentFrames, currentAreas, currentNodes, beams]);

  // Build mapping from ModelManager column frame IDs to column labels (C1, C2...)
  // Filter by selected story so labels update when switching stories
  const columnLabels = useMemo(() => {
    const labelMap = new Map<number, string>();
    const columnFrames = currentFrames.filter(f => f.type === 'column');
    // Filter columns by selected story (or all)
    const storyCols = isAllStories ? columns : columns.filter(c => c.storyId === selectedStoryId);
    for (const frame of columnFrames) {
      const topNode = currentNodes.find(n => n.id === frame.nodeJ);
      if (!topNode) continue;
      const matchingCol = storyCols.find(c => 
        Math.abs(c.x - topNode.x) < 0.01 && Math.abs(c.y - topNode.y) < 0.01
      );
      if (matchingCol) {
        labelMap.set(frame.id, matchingCol.id);
      }
    }
    return labelMap;
  }, [currentFrames, currentNodes, columns, selectedStoryId, isAllStories]);

  const handleSelectElement = (type: 'beam' | 'column' | 'slab', id: string) => {
    dispatch({ type: 'OPEN_MODAL', element: { type, id } });
  };

  // View tab: open the bending-moment chart instead of the rebar modal.
  const [momentChartElement, setMomentChartElement] = React.useState<{ type: 'beam' | 'column' | 'slab'; id: string } | null>(null);
  const handleViewSelectElement = (type: 'beam' | 'column' | 'slab', id: string) => {
    setMomentChartElement({ type, id });
  };

  // Helper: get bent-up-adjusted top bars for a beam
  const getBentUpData = (beamId: string) => {
    for (const fr of bentUpResults) {
      const b = fr.beams.find(bb => bb.beamId === beamId);
      if (b) return b;
    }
    return null;
  };

  const getModalData = () => {
    if (!selectedElement) return null;
    const { type, id } = selectedElement;
    if (type === 'beam') {
      const beam = beamsWithLoads.find(b => b.id === id);
      const design = beamDesigns.find(d => d.beamId === id);
      if (!beam) return null;
      const bent = getBentUpData(id);
      const topDia = design ? design.flexLeft.dia : 12;
      // Use bent-up adjusted bars if available
      const topLeftBars = bent ? Math.max(bent.additionalTopLeft, 2) : (design ? design.flexLeft.bars : 3);
      const topRightBars = bent ? Math.max(bent.additionalTopRight, 2) : (design ? design.flexRight.bars : 3);
      const finalTopBars = bent ? bent.finalTopBars : Math.max(topLeftBars, topRightBars);
      const bottomMidBars = design ? design.flexMid.bars : 3;
      const bottomDia = design ? design.flexMid.dia : 12;
      const remainingBottom = bent ? bent.bentUp.remainingBottomBars : bottomMidBars;
      return {
        dimensions: { b: beam.b, h: beam.h, length: beam.length * 1000 },
        reinforcement: design ? {
          top: { bars: finalTopBars, dia: topDia },
          bottom: { bars: bottomMidBars, dia: bottomDia },
          topLeft: { bars: topLeftBars, dia: topDia },
          topRight: { bars: topRightBars, dia: topDia },
          topMid: { bars: 2, dia: topDia },
          bottomMid: { bars: bottomMidBars, dia: bottomDia },
          bottomSupport: { bars: remainingBottom, dia: bottomDia },
          bentUpBars: bent ? bent.bentUp.bentBarsCount : 0,
          bentUpDia: bent ? bent.bentUp.bentDia : 0,
          stirrups: design.shear.stirrups,
        } : { top: { bars: 3, dia: 12 }, bottom: { bars: 3, dia: 12 }, stirrups: 'Φ10@200mm' },
      };
    }
    if (type === 'column') {
      const col = colDesigns.find(c => c.id === id);
      if (!col) return null;
      return {
        dimensions: { b: col.b, h: col.h, length: col.L },
        reinforcement: { top: { bars: col.design.bars, dia: col.design.dia }, stirrups: col.design.stirrups },
      };
    }
    if (type === 'slab') {
      const slab = slabDesigns.find(s => s.id === id);
      if (!slab) return null;
      return {
        dimensions: { b: Math.abs(slab.x2 - slab.x1) * 1000, h: Math.abs(slab.y2 - slab.y1) * 1000 },
        reinforcement: { shortDir: slab.design.shortDir, longDir: slab.design.longDir },
      };
    }
    return null;
  };

  const modalData = getModalData();

  // ParamInput moved outside component to prevent focus loss

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* ── شاشة تقدم التحليل الإنشائي ── */}
      {isAnalyzing && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-background/80 backdrop-blur-sm" dir="rtl">
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4 space-y-5">
            {/* أيقونة متحركة */}
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Loader2 size={34} className="text-primary animate-spin" />
              </div>
            </div>

            {/* العنوان */}
            <div className="text-center space-y-1">
              <h3 className="text-base font-bold text-foreground">جارٍ التحليل الإنشائي</h3>
              <p className="text-xs text-muted-foreground">
                {stories.length} {stories.length === 1 ? 'دور' : 'أدوار'} &nbsp;•&nbsp; {beams.length} جسر &nbsp;•&nbsp; {columns.filter(c => !c.isRemoved).length} عمود
              </p>
            </div>

            {/* شريط التقدم */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate ml-2">{analysisStep}</span>
                <span className="font-mono font-bold text-primary shrink-0">{Math.round(analysisProgress)}%</span>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-200"
                  style={{
                    width: `${analysisProgress}%`,
                    background: analysisProgress === 100
                      ? 'hsl(var(--primary))'
                      : 'linear-gradient(90deg, hsl(var(--primary)/0.7), hsl(var(--primary)))',
                  }}
                />
              </div>
            </div>

            {/* رسالة الانتظار */}
            <p className="text-[10px] text-center text-muted-foreground leading-relaxed">
              يعمل التحليل في خيط منفصل (Web Worker)
              <br />
              الواجهة تبقى سريعة الاستجابة طوال فترة الحل
            </p>

            {/* زر الإلغاء */}
            {analysisProgress < 100 && (
              <button
                onClick={() => { analysisWorker.cancelAnalysis(); }}
                className="w-full flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-destructive transition-colors py-1.5 rounded-lg hover:bg-destructive/5"
              >
                <XIcon size={12} />
                إلغاء التحليل
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── لوحة تشخيصات أداء المحلل (تظهر بعد اكتمال التحليل) ── */}
      {analysisDiagnostics && !isAnalyzing && (
        <div className="fixed bottom-20 left-3 right-3 z-[100] animate-in slide-in-from-bottom-2 duration-300">
          <div className="relative">
            <AnalysisDiagnosticsPanel diagnostics={analysisDiagnostics} />
            <button
              onClick={() => setAnalysisDiagnostics(null)}
              className="absolute top-2 left-2 w-6 h-6 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 text-muted-foreground"
              aria-label="إغلاق"
            >
              <XIcon size={11} />
            </button>
          </div>
        </div>
      )}

      {/* Header - position:fixed, needs a spacer below */}
      <AppHeader 
        title="Structural Master"
        leftSlot={
          <div className="w-9 h-9 rounded-xl bg-primary-foreground/20 flex items-center justify-center shrink-0">
            <Building2 size={18} />
          </div>
        }
        rightSlot={
          <div className="flex items-center gap-2">
            <button
              onClick={() => dispatch({ type: 'UNDO' })}
              disabled={undoStack.length === 0}
              title={`تراجع (Ctrl+Z)${undoStack.length > 0 ? ` — ${undoStack.length} خطوة` : ''}`}
              className="flex items-center gap-1 px-2 h-8 rounded-lg bg-primary-foreground/10 text-primary-foreground disabled:opacity-30 hover:bg-primary-foreground/20 transition-colors text-xs font-medium"
            >
              <Undo2 size={15} />
              {undoStack.length > 0 && (
                <span className="min-w-[14px] text-center">{undoStack.length}</span>
              )}
            </button>
            <button className="w-8 h-8 rounded-lg bg-primary-foreground/10 flex items-center justify-center">
              <Search size={16} />
            </button>
            <div className="w-8 h-8 rounded-full bg-primary-foreground/20 flex items-center justify-center text-xs font-bold">
              <Compass size={16} />
            </div>
          </div>
        }
      />
      {/* Spacer that reserves space for the fixed header so content starts below it */}
      <div className="shrink-0" style={{ height: 'var(--header-height)' }} />

      {/* Main Content */}
      <div className="flex-1 overflow-hidden" style={{ marginBottom: 'calc(var(--nav-height) + var(--safe-bottom))' }}>
        <Tabs value={activeTab} onValueChange={tab => dispatch({ type: 'SET_ACTIVE_TAB', tab })} className="h-full flex flex-col">
          
          {/* Sub-tabs within each main section */}
          {mainTab === 'reports' && (
            <TabsList className="w-full justify-start rounded-none border-b border-border bg-card px-2 overflow-x-auto shrink-0 h-auto">
              <TabsTrigger value="design" className="text-xs gap-1 min-h-[40px]"><Ruler size={14} />التصميم</TabsTrigger>
              <TabsTrigger value="results" className="text-xs gap-1 min-h-[40px]"><BarChart3 size={14} />النتائج</TabsTrigger>
              <TabsTrigger value="export" className="text-xs gap-1 min-h-[40px]"><Download size={14} />التصدير</TabsTrigger>
            </TabsList>
          )}
          {mainTab === 'inputs' && (
            <TabsList className="w-full justify-start rounded-none border-b border-border bg-card px-2 overflow-x-auto shrink-0 h-auto">
              <TabsTrigger value="input" className="text-xs gap-1 min-h-[40px]"><Settings2 size={14} />المدخلات</TabsTrigger>
              <TabsTrigger value="slabs" className="text-xs gap-1 min-h-[40px]"><Layers size={14} />الإدخال</TabsTrigger>
              <TabsTrigger value="loads-input" className="text-xs gap-1 min-h-[40px]"><Zap size={14} />الأحمال</TabsTrigger>
              <TabsTrigger value="building" className="text-xs gap-1 min-h-[40px]"><Building size={14} />مبنى متعدد</TabsTrigger>
            </TabsList>
          )}
          {mainTab === 'modeling' && (
            <TabsList className="w-full justify-start rounded-none border-b border-border bg-card px-2 overflow-x-auto shrink-0 h-auto">
              <TabsTrigger value="modeler" className="text-xs gap-1 min-h-[40px]"><Grid3X3 size={14} />النمذجة</TabsTrigger>
              <TabsTrigger value="view" className="text-xs gap-1 min-h-[40px]"><Eye size={14} />العرض</TabsTrigger>
              <TabsTrigger value="analysis" className="text-xs gap-1 min-h-[40px]"><Calculator size={14} />التحليل</TabsTrigger>
            </TabsList>
          )}

          {/* MODELER TAB */}
          <TabsContent value="modeler" className="flex-1 overflow-hidden mt-0">
            <div className="flex flex-col h-full">
              {/* Level filter bar */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 shrink-0">
                <Layers size={14} className="text-muted-foreground" />
                <label className="text-xs font-medium text-muted-foreground">فلتر المنسوب:</label>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={modelerElevation}
                  onChange={e => setModelerElevation(Number(e.target.value))}
                >
                  <option value={-1}>الكل (مسقط أفقي)</option>
                  {availableElevations.map(elev => (
                    <option key={elev} value={elev}>
                      المنسوب {(elev / 1000).toFixed(1)} م
                      {elev === 0 ? ' (الأرض / الركائز)' : ''}
                    </option>
                  ))}
                </select>
                {modelerElevation >= 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {modelerElevation === 0 ? 'مسقط الأساسات' : `المنسوب ${(modelerElevation / 1000).toFixed(1)} م`}
                  </Badge>
                )}
              </div>

              {/* Show support plan view when ground level or specific elevation selected */}
              {modelerElevation >= 0 ? (
                <div className="flex-1 overflow-hidden">
                  <LevelPlanView
                    columns={columns}
                    beams={beamsWithLoads}
                    slabs={slabs}
                    stories={stories}
                    selectedElevation={modelerElevation}
                    onColumnSupportChange={handleColumnSupportChange}
                    onSupportRestraintsChange={handleSupportRestraintsChange}
                    supportRestraints={supportRestraints}
                    onElementLongPress={handleLevelElementLongPress}
                    onEditBeamProperties={handleEditBeamProperties}
                    onDeleteElement={handleLevelElementDelete}
                  />
                </div>
              ) : (
                <div className="flex flex-1 overflow-hidden">
                  <ToolPalette
                    activeTool={activeTool}
                    onToolChange={tool => dispatch({ type: 'SET_ACTIVE_TOOL', tool })}
                    mode={mode}
                    onModeChange={(m) => dispatch({ type: 'SET_MODE', mode: m })}
                  />
                  <ModelCanvas
                    nodes={currentNodes}
                    frames={currentFrames}
                    areas={[]}
                    activeTool={activeTool}
                    onCanvasClick={handleCanvasClick}
                    onNodeClick={handleNodeClick}
                    onFrameClick={handleFrameClick}
                    onAreaClick={handleAreaClick}
                    onFrameLongPress={handleFrameLongPress}
                    onAreaLongPress={handleAreaLongPress}
                    selectedNodeId={selectedNodeId}
                    selectedFrameId={selectedFrameId}
                    selectedAreaId={selectedAreaId}
                    pendingNode={pendingNode}
                    columnLabels={columnLabels}
                    frameEndReleases={effectiveFrameEndReleases}
                  />
                  <PropertyPanel
                    selectedNode={selectedNodeId ? currentNodes.find(n => n.id === selectedNodeId) : null}
                    selectedFrame={selectedFrameId ? currentFrames.find(f => f.id === selectedFrameId) : null}
                    selectedArea={selectedAreaId ? currentAreas.find(a => a.id === selectedAreaId) : null}
                    onNodeRestraintChange={handleNodeRestraintChange}
                    modelStats={modelStats}
                  />
                </div>
              )}
            </div>
          </TabsContent>

          {/* INPUT TAB - with sub-tabs for original + auto-design */}
          <TabsContent value="input" className="flex-1 overflow-hidden mt-0">
            <Tabs defaultValue="input-main" className="h-full flex flex-col">
              <TabsList className="w-full justify-start rounded-none border-b border-border bg-muted/30 px-2 shrink-0 h-auto">
                <TabsTrigger value="input-main" className="text-[11px] gap-1 min-h-[36px]"><Settings2 size={12} />المدخلات</TabsTrigger>
                <TabsTrigger value="input-auto" className="text-[11px] gap-1 min-h-[36px] text-accent"><Wand2 size={12} />تصميم تلقائي</TabsTrigger>
              </TabsList>
              <TabsContent value="input-main" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <div className="space-y-4 max-w-4xl">
                  {/* Story Management */}
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">إدارة الأدوار</CardTitle></CardHeader>
                    <CardContent>
                      <StoryManager
                        stories={stories}
                        selectedStoryId={selectedStoryId}
                        onSelectStory={id => dispatch({ type: 'SELECT_STORY', storyId: id })}
                        onAddStory={() => dispatch({ type: 'ADD_STORY' })}
                        onRemoveStory={id => dispatch({ type: 'REMOVE_STORY', storyId: id })}
                        onUpdateStory={(id, updates) => dispatch({ type: 'UPDATE_STORY', storyId: id, updates })}
                        onCopyElements={(from, to) => dispatch({ type: 'COPY_STORY_ELEMENTS', fromStoryId: from, toStoryId: to })}
                      />
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">خصائص المواد</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3">
                      <ParamInput label="f'c (MPa)" value={mat.fc} onChange={v => dispatch({ type: 'SET_MAT', mat: { fc: v } })} />
                      <ParamInput label="fy (MPa)" value={mat.fy} onChange={v => dispatch({ type: 'SET_MAT', mat: { fy: v } })} />
                      <ParamInput label="fyt (MPa)" value={mat.fyt} onChange={v => dispatch({ type: 'SET_MAT', mat: { fyt: v } })} />
                      <ParamInput label="γ (kN/m³)" value={mat.gamma} onChange={v => dispatch({ type: 'SET_MAT', mat: { gamma: v } })} />
                    </CardContent>
                    <CardFooter className="pt-2">
                      <Button size="sm" className="w-full h-9 text-xs" onClick={() => dispatch({ type: 'SAVE_SNAPSHOT', message: 'تم حفظ خصائص المواد ✓' })}>
                        <Save size={14} className="mr-1" />حفظ التغييرات
                      </Button>
                    </CardFooter>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">خصائص البلاطة</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3">
                      <ParamInput label="السماكة (مم)" value={slabProps.thickness} onChange={v => dispatch({ type: 'SET_SLAB_PROPS', props: { thickness: v } })} />
                      <ParamInput label="أحمال التشطيب (kN/m²)" value={slabProps.finishLoad} onChange={v => dispatch({ type: 'SET_SLAB_PROPS', props: { finishLoad: v } })} />
                      <ParamInput label="الحمل الحي (kN/m²)" value={slabProps.liveLoad} onChange={v => dispatch({ type: 'SET_SLAB_PROPS', props: { liveLoad: v } })} />
                      <ParamInput label="الغطاء (مم)" value={slabProps.cover} onChange={v => dispatch({ type: 'SET_SLAB_PROPS', props: { cover: v } })} />
                    </CardContent>
                    <CardFooter className="pt-2">
                      <Button size="sm" className="w-full h-9 text-xs" onClick={() => dispatch({ type: 'SAVE_SNAPSHOT', message: 'تم حفظ خصائص البلاطة ✓' })}>
                        <Save size={14} className="mr-1" />حفظ التغييرات
                      </Button>
                    </CardFooter>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">أبعاد العناصر</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3">
                      <ParamInput label="عرض الجسر (مم)" value={beamB} onChange={v => dispatch({ type: 'SET_BEAM_B', value: v })} />
                      <ParamInput label="ارتفاع الجسر (مم)" value={beamH} onChange={v => dispatch({ type: 'SET_BEAM_H', value: v })} />
                      <ParamInput label="عرض العمود (مم)" value={colB} onChange={v => dispatch({ type: 'SET_COL_B', value: v })} />
                      <ParamInput label="عمق العمود (مم)" value={colH} onChange={v => dispatch({ type: 'SET_COL_H', value: v })} />
                    </CardContent>
                    <CardFooter className="pt-2">
                      <Button size="sm" className="w-full h-9 text-xs" onClick={() => dispatch({ type: 'SAVE_SNAPSHOT', message: 'تم حفظ أبعاد العناصر ✓' })}>
                        <Save size={14} className="mr-1" />حفظ التغييرات
                      </Button>
                    </CardFooter>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">ملخص</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p>{stories.length} أدوار</p>
                      <p>{columns.filter(c => !c.isRemoved).length} أعمدة (لكل دور)</p>
                      <p>{beams.length} جسور (لكل دور)</p>
                      <p>{frames.length} إطارات (لكل دور)</p>
                      <Button onClick={runAnalysis} className="w-full min-h-[44px] mt-2">
                        <Calculator size={16} className="mr-2" />تشغيل التحليل (جميع الأدوار)
                      </Button>
                    </CardContent>
                  </Card>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="input-auto" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <AutoDesignPanel
                  slabs={slabs}
                  onApply={(result: AutoDesignResult) => {
                    dispatch({ type: 'SET_SLAB_PROPS', props: { thickness: result.slabThickness, finishLoad: result.slabProps.finishLoad, liveLoad: result.slabProps.liveLoad } });
                    dispatch({ type: 'SET_BEAM_B', value: result.beamB });
                    dispatch({ type: 'SET_BEAM_H', value: result.beamH });
                    dispatch({ type: 'SET_COL_B', value: result.colB });
                    dispatch({ type: 'SET_COL_H', value: result.colH });
                    dispatch({ type: 'SET_MAT', mat: result.matProps });
                    dispatch({ type: 'SET_COL_L', value: result.slabProps.thickness > 0 ? state.colL : 4000 });
                    dispatch({ type: 'SAVE_SNAPSHOT', message: 'تم تطبيق التصميم التلقائي ✓' });
                  }}
                />
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* SLABS / INPUT TAB - with sub-tabs for original + generative + ai-assistant */}
          <TabsContent value="slabs" className="flex-1 overflow-hidden mt-0">
            <Tabs defaultValue="slabs-main" className="h-full flex flex-col">
              <TabsList className="w-full justify-start rounded-none border-b border-border bg-muted/30 px-2 shrink-0 h-auto">
                <TabsTrigger value="slabs-main" className="text-[11px] gap-1 min-h-[36px]"><Layers size={12} />الإدخال</TabsTrigger>
                <TabsTrigger value="slabs-generative" className="text-[11px] gap-1 min-h-[36px] text-accent"><Zap size={12} />تصميم توليدي</TabsTrigger>
                <TabsTrigger value="slabs-ai" className="text-[11px] gap-1 min-h-[36px] text-accent"><Bot size={12} />المساعد الذكي</TabsTrigger>
                <TabsTrigger value="slabs-etabs-import" className="text-[11px] gap-1 min-h-[36px] text-orange-600 dark:text-orange-400"><Upload size={12} />ETABS (جداول Excel)</TabsTrigger>
                <TabsTrigger value="slabs-edb-import" className="text-[11px] gap-1 min-h-[36px] text-blue-600 dark:text-blue-400"><Upload size={12} />ETABS (ملف .e2k)</TabsTrigger>
              </TabsList>
              <TabsContent value="slabs-main" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <div className="space-y-4 max-w-5xl">
                  {/* Story filter for this tab */}
                  <StorySelector
                    stories={stories}
                    selectedStoryId={selectedStoryId}
                    onSelectStory={id => dispatch({ type: 'SELECT_STORY', storyId: id })}
                    onAddStory={() => dispatch({ type: 'ADD_STORY' })}
                    onRemoveStory={id => dispatch({ type: 'REMOVE_STORY', storyId: id })}
                    onUpdateStory={(id, updates) => dispatch({ type: 'UPDATE_STORY', storyId: id, updates })}
                    onCopyElements={(from, to) => dispatch({ type: 'COPY_STORY_ELEMENTS', fromStoryId: from, toStoryId: to })}
                    compact
                  />
                  
                  {/* Slabs table */}
                  <Card>
                    <CardHeader className="pb-2 flex-row items-center justify-between">
                      <CardTitle className="text-sm">إحداثيات البلاطات (م) - {isAllStories ? 'جميع الأدوار' : getStoryLabel(selectedStoryId)}</CardTitle>
                      <Button onClick={() => dispatch({ type: 'ADD_SLAB', slab: { id: `S${slabs.length + 1}`, x1: 0, y1: 0, x2: 5, y2: 4, storyId: selectedStoryId === '__ALL__' ? stories[0]?.id : selectedStoryId } })} size="sm" variant="outline" className="min-h-[44px] gap-1"><Plus size={14} /> إضافة بلاطة</Button>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {[...(isAllStories ? ['الدور'] : []),'الاسم','X1','Y1','X2','Y2','الدور / المنسوب Z','Lx','Ly','النوع','حذف'].map(h => (
                              <TableHead key={h} className="text-xs">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {storyFilteredSlabs.map((s) => {
                            const i = slabs.indexOf(s);
                            const sd = slabDesigns.find(sd => sd.id === s.id)?.design;
                            return (
                              <TableRow key={`${s.storyId}-${s.id}`}>
                                {isAllStories && <TableCell className="text-xs font-medium text-muted-foreground">{getStoryLabel(s.storyId)}</TableCell>}
                                <TableCell><Input value={s.id} onChange={e => dispatch({ type: 'UPDATE_SLAB', index: i, key: 'id', value: e.target.value })} className="h-10 w-16 font-mono text-xs" /></TableCell>
                                <TableCell><Input type="number" step="any" inputMode="decimal" value={s.x1} onChange={e => dispatch({ type: 'UPDATE_SLAB', index: i, key: 'x1', value: e.target.value })} className="h-10 w-16 font-mono text-xs" /></TableCell>
                                <TableCell><Input type="number" step="any" inputMode="decimal" value={s.y1} onChange={e => dispatch({ type: 'UPDATE_SLAB', index: i, key: 'y1', value: e.target.value })} className="h-10 w-16 font-mono text-xs" /></TableCell>
                                <TableCell><Input type="number" step="any" inputMode="decimal" value={s.x2} onChange={e => dispatch({ type: 'UPDATE_SLAB', index: i, key: 'x2', value: e.target.value })} className="h-10 w-16 font-mono text-xs" /></TableCell>
                                <TableCell><Input type="number" step="any" inputMode="decimal" value={s.y2} onChange={e => dispatch({ type: 'UPDATE_SLAB', index: i, key: 'y2', value: e.target.value })} className="h-10 w-16 font-mono text-xs" /></TableCell>
                                <TableCell>
                                  <select
                                    value={s.storyId || ''}
                                    onChange={e => dispatch({ type: 'UPDATE_SLAB', index: i, key: 'storyId', value: e.target.value })}
                                    className="h-10 text-xs border border-input rounded-md px-1 bg-background text-foreground w-28"
                                  >
                                    {stories.map(st => (
                                      <option key={st.id} value={st.id}>
                                        {st.label} (+{((st.elevation ?? 0) + st.height).toFixed(0)})
                                      </option>
                                    ))}
                                  </select>
                                </TableCell>
                                <TableCell className="font-mono text-xs">{sd?.lx.toFixed(1)}</TableCell>
                                <TableCell className="font-mono text-xs">{sd?.ly.toFixed(1)}</TableCell>
                                <TableCell className="text-xs">{sd?.isOneWay ? 'اتجاه واحد' : 'اتجاهين'}</TableCell>
                                <TableCell><Button onClick={() => dispatch({ type: 'REMOVE_SLAB', index: i })} variant="ghost" size="sm" className="text-destructive h-10 w-10 p-0"><Trash2 size={14} /></Button></TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  {/* Generate Beams Button */}
                  <Card>
                    <CardContent className="py-3">
                      <Button 
                        onClick={() => dispatch({ type: 'GENERATE_BEAMS_MANUAL' })} 
                        className="w-full min-h-[44px] gap-2"
                        variant="outline"
                      >
                        <Wand2 size={16} />إنشاء الجسور تلقائياً
                      </Button>
                      <p className="text-xs text-muted-foreground mt-2 text-center">
                        ينشئ الجسور بناءً على مواقع الأعمدة والبلاطات الحالية
                      </p>
                    </CardContent>
                  </Card>

                  {/* Beams table - Editable with Wall Loads */}
                  <Card>
                    <CardHeader className="pb-2 space-y-2">
                      <div className="flex flex-row items-center justify-between">
                        <CardTitle className="text-sm">الجسور ({beams.length})</CardTitle>
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => {
                          const id = `BM${extraBeams.length + 1}`;
                          dispatch({ type: 'ADD_EXTRA_BEAM', beam: {
                            id, fromCol: '', toCol: '', x1: 0, y1: 0, x2: 5, y2: 0,
                            length: 5, direction: 'horizontal', b: beamB, h: beamH,
                            deadLoad: 0, liveLoad: 0, wallLoad: 0, slabs: [],
                          }});
                        }}><Plus size={14} className="mr-1" />إضافة جسر</Button>
                      </div>
                      {/* Merge & Intersect toolbar */}
                      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                        <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={selectAllBeams}>
                          <CheckSquare size={12} />تحديد الكل
                        </Button>
                        {selectedBeamIds.size > 0 && (
                          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={clearBeamSelection}>
                            إلغاء التحديد ({selectedBeamIds.size})
                          </Button>
                        )}
                        <Button
                          size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                          disabled={selectedBeamIds.size < 2}
                          onClick={handleMergeBeams}
                        >
                          <Merge size={12} />دمج المستقيمة
                        </Button>
                        <Button
                          size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                          onClick={handleIntersect}
                        >
                          <Crosshair size={12} />Intersect
                        </Button>
                        {selectedBeamIds.size > 0 && (
                          <Badge variant="secondary" className="text-[10px]">
                            محدد: {selectedBeamIds.size} جسر
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {['✓','الجسر','عقدة البداية','عقدة النهاية','X1','Y1','X2','Y2','المنسوب Z','الدور','الطول','العرض','الارتفاع','حمل جدار (kN/m)','تحرير الأطراف','حذف'].map(h => (
                              <TableHead key={h} className="text-xs">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {beams.filter(b => !removedBeamIds.includes(b.id)).map(b => {
                            const isExtra = extraBeams.some(eb => eb.id === b.id);
                            const wallLoad = beamOverrides[b.id]?.wallLoad || b.wallLoad || 0;
                            const releaseState = getBeamReleaseState(b);
                            const hasRelease = Object.values(releaseState.nodeI).some(Boolean) || Object.values(releaseState.nodeJ).some(Boolean);
                            const releasedEndsCount = Number(Object.values(releaseState.nodeI).some(Boolean)) + Number(Object.values(releaseState.nodeJ).some(Boolean));
                            return (
                            <TableRow key={b.id} className={selectedBeamIds.has(b.id) ? 'bg-primary/10' : ''}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedBeamIds.has(b.id)}
                                  onCheckedChange={() => toggleBeamSelection(b.id)}
                                />
                              </TableCell>
                              <TableCell className="font-mono text-xs">{b.id}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{getBeamNodeId(b.x1, b.y1, b.z ?? 0)}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{getBeamNodeId(b.x2, b.y2, b.z ?? 0)}</TableCell>
                              <TableCell>
                                <Input type="number" value={b.x1} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { x1: val } });
                                    else dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { x1: val } });
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={b.y1} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { y1: val } });
                                    else dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { y1: val } });
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={b.x2} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { x2: val } });
                                    else dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { x2: val } });
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={b.y2} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { y2: val } });
                                    else dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { y2: val } });
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={b.z ?? 0} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { z: val } });
                                    else dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { z: val } });
                                  }} />
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{getStoryLabel(b.storyId)}</TableCell>
                              <TableCell className="font-mono text-xs">{b.length.toFixed(2)}</TableCell>
                              <TableCell>
                                <Input type="number" value={b.b} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { b: val } });
                                    } else {
                                      dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { b: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={b.h} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { h: val } });
                                    } else {
                                      dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { h: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={wallLoad} className="h-8 w-20 font-mono text-xs"
                                  placeholder="0"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { wallLoad: val } });
                                    } else {
                                      dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { wallLoad: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <div className="flex min-w-[150px] items-center gap-2">
                                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => openBeamReleaseEditor(b)}>
                                    تحرير
                                  </Button>
                                  <Badge variant={hasRelease ? 'default' : 'outline'} className="text-[10px] whitespace-nowrap">
                                    {hasRelease ? `محرر ${releasedEndsCount}/2` : 'بدون تحرير'}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Button onClick={() => {
                                    if (isExtra) {
                                      dispatch({ type: 'REMOVE_EXTRA_BEAM', id: b.id });
                                    } else {
                                      dispatch({ type: 'TOGGLE_BEAM_REMOVAL', beamId: b.id });
                                    }
                                  }}
                                    variant="ghost" size="sm" className="text-destructive h-8 w-8 p-0"><Trash2 size={14} /></Button>
                              </TableCell>
                            </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  {/* ── Beam-on-Beam Splitting Tool ── */}
                  {(() => {
                    const TOL = 0.005; // 5mm tolerance in meters

                    const pointOnSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean => {
                      const dAB = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
                      if (dAB < TOL) return false;
                      const dAP = Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
                      const dPB = Math.sqrt((bx - px) ** 2 + (by - py) ** 2);
                      if (dAP < TOL || dPB < TOL) return false; // ignore endpoints
                      return Math.abs(dAP + dPB - dAB) < TOL;
                    };

                    // For each active beam, find intersection points from other beams' endpoints
                    type SplitCandidate = {
                      primaryBeam: Beam;
                      secondaryBeams: { secId: string; px: number; py: number }[];
                    };

                    const activeBs = beams.filter(b => !removedBeamIds.includes(b.id));
                    const candidates: SplitCandidate[] = [];

                    for (const primary of activeBs) {
                      const intersections: { secId: string; px: number; py: number }[] = [];
                      for (const sec of activeBs) {
                        if (sec.id === primary.id) continue;
                        // Check both endpoints of the secondary beam
                        if (pointOnSegment(sec.x1, sec.y1, primary.x1, primary.y1, primary.x2, primary.y2)) {
                          // Check not already added
                          const key = `${sec.x1.toFixed(3)}_${sec.y1.toFixed(3)}`;
                          if (!intersections.some(i => `${i.px.toFixed(3)}_${i.py.toFixed(3)}` === key)) {
                            intersections.push({ secId: sec.id, px: sec.x1, py: sec.y1 });
                          }
                        }
                        if (pointOnSegment(sec.x2, sec.y2, primary.x1, primary.y1, primary.x2, primary.y2)) {
                          const key = `${sec.x2.toFixed(3)}_${sec.y2.toFixed(3)}`;
                          if (!intersections.some(i => `${i.px.toFixed(3)}_${i.py.toFixed(3)}` === key)) {
                            intersections.push({ secId: sec.id, px: sec.x2, py: sec.y2 });
                          }
                        }
                      }
                      if (intersections.length > 0) {
                        candidates.push({ primaryBeam: primary, secondaryBeams: intersections });
                      }
                    }

                    if (candidates.length === 0) return null;

                    const handleSplitBeam = (primary: Beam) => {
                      const candidate = candidates.find(c => c.primaryBeam.id === primary.id);
                      if (!candidate) return;

                      const isExtra = extraBeams.some(eb => eb.id === primary.id);

                      // Sort intersection points along the beam direction
                      const dx = primary.x2 - primary.x1;
                      const dy = primary.y2 - primary.y1;
                      const pts = candidate.secondaryBeams.map(s => ({
                        ...s,
                        t: Math.abs(dx) > Math.abs(dy)
                          ? (s.px - primary.x1) / (dx || 1)
                          : (s.py - primary.y1) / (dy || 1),
                      })).sort((a, b) => a.t - b.t);

                      // Build segment endpoints: start → pt1 → pt2 → ... → end
                      const segPoints: { x: number; y: number }[] = [
                        { x: primary.x1, y: primary.y1 },
                        ...pts.map(p => ({ x: p.px, y: p.py })),
                        { x: primary.x2, y: primary.y2 },
                      ];

                      // Remove original beam
                      if (isExtra) {
                        dispatch({ type: 'REMOVE_EXTRA_BEAM', id: primary.id });
                      } else {
                        dispatch({ type: 'TOGGLE_BEAM_REMOVAL', beamId: primary.id });
                      }

                      // Add split segments as extra beams
                      for (let i = 0; i < segPoints.length - 1; i++) {
                        const p1 = segPoints[i];
                        const p2 = segPoints[i + 1];
                        const segLen = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
                        const newId = `${primary.id}-${i + 1}`;
                        dispatch({
                          type: 'ADD_EXTRA_BEAM',
                          beam: {
                            id: newId,
                            fromCol: '', toCol: '',
                            x1: p1.x, y1: p1.y,
                            x2: p2.x, y2: p2.y,
                            z: primary.z,
                            length: segLen,
                            direction: primary.direction,
                            b: primary.b, h: primary.h,
                            deadLoad: primary.deadLoad ?? 0,
                            liveLoad: primary.liveLoad ?? 0,
                            wallLoad: primary.wallLoad ?? 0,
                            slabs: [],
                            storyId: primary.storyId,
                          },
                        });
                      }
                    };

                    const handleSplitAll = () => {
                      for (const c of candidates) {
                        handleSplitBeam(c.primaryBeam);
                      }
                    };

                    return (
                      <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800">
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="text-sm text-amber-700 dark:text-amber-400">
                                تقسيم الجسور الحاملة
                              </CardTitle>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                تم رصد {candidates.length} جسر حامل تستند عليه جسور محمولة — يجب تقسيمها لضمان صحة مصفوفة الجساءة
                              </p>
                            </div>
                            <Button size="sm" variant="default" className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white shrink-0" onClick={handleSplitAll}>
                              تقسيم الكل
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {['الجسر الحامل', 'الجسور المحمولة', 'نقاط الارتكاز (X, Y)', 'عدد الأجزاء', 'تقسيم'].map(h => (
                                  <TableHead key={h} className="text-xs">{h}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {candidates.map(({ primaryBeam: pb, secondaryBeams }) => (
                                <TableRow key={pb.id}>
                                  <TableCell className="font-mono text-xs font-bold">{pb.id}</TableCell>
                                  <TableCell className="text-xs">
                                    <div className="flex flex-wrap gap-1">
                                      {secondaryBeams.map(s => (
                                        <Badge key={s.secId} variant="outline" className="text-[10px] font-mono">{s.secId}</Badge>
                                      ))}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-xs font-mono text-muted-foreground">
                                    <div className="space-y-0.5">
                                      {secondaryBeams.map(s => (
                                        <div key={`${s.px}_${s.py}`}>({s.px.toFixed(2)}, {s.py.toFixed(2)})</div>
                                      ))}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">{secondaryBeams.length + 1}</TableCell>
                                  <TableCell>
                                    <Button size="sm" variant="outline" className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-100" onClick={() => handleSplitBeam(pb)}>
                                      تقسيم
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {/* ── Nodes Table (derived from model) ── */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">نقاط النموذج (العقد)</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      {(() => {
                        // Build unique nodes from columns and beams
                        const nodeMap = new Map<string, { id: string; x: number; y: number; z: number; elements: string[] }>();
                        const tol = 0.001; // m tolerance
                        const getKey = (x: number, y: number, z: number) =>
                          `${Math.round(x / tol) * tol},${Math.round(y / tol) * tol},${Math.round(z / tol) * tol}`;

                        // Add nodes from active columns
                        for (const c of columns.filter(cc => !cc.isRemoved)) {
                          const zTop = ((c.zTop ?? 0) / 1000);
                          const zBot = ((c.zBottom ?? 0) / 1000);
                          const keyTop = getKey(c.x, c.y, zTop);
                          const keyBot = getKey(c.x, c.y, zBot);
                          if (!nodeMap.has(keyTop)) nodeMap.set(keyTop, { id: `N-${nodeMap.size + 1}`, x: c.x, y: c.y, z: zTop, elements: [] });
                          nodeMap.get(keyTop)!.elements.push(c.id);
                          if (!nodeMap.has(keyBot)) nodeMap.set(keyBot, { id: `N-${nodeMap.size + 1}`, x: c.x, y: c.y, z: zBot, elements: [] });
                          nodeMap.get(keyBot)!.elements.push(c.id);
                        }

                        // Add nodes from active beams
                        for (const b of beams.filter(bb => !removedBeamIds.includes(bb.id))) {
                          const bz = ((b.z ?? 0) / 1000);
                          const key1 = getKey(b.x1, b.y1, bz);
                          const key2 = getKey(b.x2, b.y2, bz);
                          if (!nodeMap.has(key1)) nodeMap.set(key1, { id: `N-${nodeMap.size + 1}`, x: b.x1, y: b.y1, z: bz, elements: [] });
                          nodeMap.get(key1)!.elements.push(b.id);
                          if (!nodeMap.has(key2)) nodeMap.set(key2, { id: `N-${nodeMap.size + 1}`, x: b.x2, y: b.y2, z: bz, elements: [] });
                          nodeMap.get(key2)!.elements.push(b.id);
                        }

                        const modelNodes = [...nodeMap.values()];
                        // Re-number
                        modelNodes.forEach((n, i) => { n.id = `N${i + 1}`; });

                        return (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {['العقدة', 'X (م)', 'Y (م)', 'Z (م)', 'العناصر المتصلة'].map(h => (
                                  <TableHead key={h} className="text-xs">{h}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {modelNodes.map(n => (
                                <TableRow key={n.id}>
                                  <TableCell className="font-mono text-xs font-semibold">{n.id}</TableCell>
                                  <TableCell className="font-mono text-xs">{n.x.toFixed(2)}</TableCell>
                                  <TableCell className="font-mono text-xs">{n.y.toFixed(2)}</TableCell>
                                  <TableCell className="font-mono text-xs">{n.z.toFixed(2)}</TableCell>
                                  <TableCell className="text-xs">{n.elements.join(', ')}</TableCell>
                                </TableRow>
                              ))}
                              {modelNodes.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                                    لا توجد نقاط — أضف بلاطات وأعمدة أولاً
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  {/* Columns table - Editable */}
                  <Card>
                    <CardHeader className="pb-2 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">الأعمدة ({columns.filter(c => !c.isRemoved).length})</CardTitle>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => {
                        const id = `CM${extraColumns.length + 1}`;
                        dispatch({ type: 'ADD_EXTRA_COLUMN', column: { id, x: 0, y: 0, b: colB, h: colH, L: colL } });
                      }}><Plus size={14} className="mr-1" />إضافة عمود</Button>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                             {['العمود','X','Y','Z أسفل','Z أعلى','الدور','العرض','العمق','الارتفاع','زاوية (°)','الحالة','إزالة/استعادة','حذف'].map(h => (
                               <TableHead key={h} className="text-xs">{h}</TableHead>
                             ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {columns.map(c => {
                            const isExtra = extraColumns.some(ec => ec.id === c.id);
                            return (
                            <TableRow key={c.id} className={c.isRemoved ? 'opacity-40' : ''}>
                              <TableCell className="font-mono text-xs">{c.id}</TableCell>
                              <TableCell>
                                <Input type="number" value={c.x} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_COLUMN', id: c.id, updates: { x: val } });
                                    else dispatch({ type: 'SET_COL_OVERRIDE', colId: c.id, override: { x: val } });
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={c.y} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_COLUMN', id: c.id, updates: { y: val } });
                                    else dispatch({ type: 'SET_COL_OVERRIDE', colId: c.id, override: { y: val } });
                                  }} />
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {(c.zBottom ?? 0).toFixed(0)}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {(c.zTop ?? 0).toFixed(0)}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{getStoryLabel(c.storyId)}</TableCell>
                              <TableCell>
                                <Input type="number" value={c.b} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_COLUMN', id: c.id, updates: { b: val } });
                                    } else {
                                      dispatch({ type: 'SET_COL_OVERRIDE', colId: c.id, override: { b: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={c.h} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_COLUMN', id: c.id, updates: { h: val } });
                                    } else {
                                      dispatch({ type: 'SET_COL_OVERRIDE', colId: c.id, override: { h: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={c.L} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_COLUMN', id: c.id, updates: { L: val } });
                                    } else {
                                      dispatch({ type: 'SET_COL_OVERRIDE', colId: c.id, override: { L: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={c.orientAngle ?? 0} className="h-8 w-16 font-mono text-xs"
                                  title="زاوية توجيه المقطع: 0°=b على محور X، 90°=b على محور Y"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_COLUMN', id: c.id, updates: { orientAngle: val } });
                                    } else {
                                      dispatch({ type: 'SET_COL_OVERRIDE', colId: c.id, override: { orientAngle: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Badge variant={c.isRemoved ? "destructive" : "default"} className="text-[10px]">
                                  {c.isRemoved ? 'محذوف' : 'فعال'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {!isExtra && (
                                  <Button onClick={() => dispatch({ type: 'TOGGLE_COLUMN_REMOVAL', colId: c.id })} variant="ghost" size="sm" className="h-8 text-xs">
                                    {c.isRemoved ? 'استعادة' : 'إزالة'}
                                  </Button>
                                )}
                              </TableCell>
                              <TableCell>
                                {isExtra && (
                                  <Button onClick={() => dispatch({ type: 'REMOVE_EXTRA_COLUMN', id: c.id })}
                                    variant="ghost" size="sm" className="text-destructive h-8 w-8 p-0"><Trash2 size={14} /></Button>
                                )}
                              </TableCell>
                            </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
              <TabsContent value="slabs-generative" className="flex-1 overflow-hidden mt-0">
                <GenerativeDesignDashboard
                  onApplyOption={(ev: EvaluatedOption) => {
                    dispatch({
                      type: 'APPLY_GENERATIVE',
                      slabs: (ev.option.slabs?.length ? ev.option.slabs : slabs) as Slab[],
                      beamB: ev.option.sections.beamB,
                      beamH: ev.option.sections.beamH,
                      colB: ev.option.sections.colB,
                      colH: ev.option.sections.colH,
                    });
                  }}
                />
              </TabsContent>
              <TabsContent value="slabs-ai" className="flex-1 overflow-hidden mt-0">
                <AIAssistantPanel
                  onModelGenerated={(newSlabs) => {
                    dispatch({ type: 'SET_SLABS', slabs: newSlabs });
                    dispatch({ type: 'SET_MODE', mode: 'auto' });
                    dispatch({ type: 'SET_ACTIVE_TAB', tab: 'modeler' });
                  }}
                  onClose={() => dispatch({ type: 'SET_ACTIVE_TAB', tab: 'modeler' })}
                />
              </TabsContent>
              <TabsContent value="slabs-etabs-import" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <ETABSFullImportPanel stories={stories} onApply={(data) => {
                  const nodeMap = new Map(data.nodes.map(n => [n.id, n]));

                  // ── دالة اكتشاف الدور بحسب المنسوب (بالمتر) ──
                  const detectStoryId = (zMeters: number): string => {
                    if (!stories.length) return 'ST1';
                    const zMm = zMeters * 1000;
                    let bestId = stories[0].id;
                    let bestDiff = Infinity;
                    for (const s of stories) {
                      const topElev = (s.elevation ?? 0) + s.height;
                      const diff = Math.abs(topElev - zMm);
                      if (diff < bestDiff) { bestDiff = diff; bestId = s.id; }
                    }
                    return bestId;
                  };

                  // ── 1. تحويل البلاطات — الدور يُحدَّد من متوسط منسوب نقاطها ──
                  const newSlabs: Slab[] = [];
                  for (const s of data.slabs) {
                    const coords = s.nodes.map(nId => nodeMap.get(nId)).filter(Boolean);
                    if (coords.length >= 3) {
                      const xs = coords.map(c => c!.x);
                      const ys = coords.map(c => c!.y);
                      const avgZ = coords.reduce((sum, c) => sum + c!.z, 0) / coords.length;
                      const detectedStoryId = detectStoryId(avgZ);
                      newSlabs.push({
                        id: s.id,
                        x1: Math.min(...xs), y1: Math.min(...ys),
                        x2: Math.max(...xs), y2: Math.max(...ys),
                        storyId: detectedStoryId,
                      });
                    }
                  }

                  // ── 2. تحويل الجسور — الدور يُحدَّد من متوسط منسوب نقطتَي الجسر ──
                  const newBeams: Beam[] = [];
                  for (const b of data.beams) {
                    const ni = nodeMap.get(b.nodeI);
                    const nj = nodeMap.get(b.nodeJ);
                    if (!ni || !nj) continue;
                    const dx = nj.x - ni.x;
                    const dy = nj.y - ni.y;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    const direction: 'horizontal' | 'vertical' = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
                    const avgZ = (ni.z + nj.z) / 2;
                    const detectedStoryId = detectStoryId(avgZ);
                    newBeams.push({
                      id: b.id,
                      fromCol: b.nodeI,
                      toCol: b.nodeJ,
                      x1: ni.x, y1: ni.y,
                      x2: nj.x, y2: nj.y,
                      z: avgZ * 1000,                   // تحويل م → مم
                      length: len,
                      direction,
                      b: beamB,
                      h: beamH,
                      deadLoad: 0,
                      liveLoad: 0,
                      slabs: [],
                      storyId: detectedStoryId,
                    });
                  }

                  // ── 3. تحويل الأعمدة — الدور يُحدَّد من منسوب النقطة العلوية (nodeJ) ──
                  const newColumns: Column[] = [];
                  for (const c of data.columns) {
                    const ni = nodeMap.get(c.nodeI);
                    const nj = nodeMap.get(c.nodeJ);
                    if (!ni) continue;
                    const zBot = (ni.z ?? 0) * 1000;    // م → مم
                    const zTop = nj ? (nj.z ?? 0) * 1000 : zBot + colL;
                    const L = Math.max(zTop - zBot, colL);
                    // الدور يُحدَّد من النقطة العلوية للعمود
                    const topZ = nj ? nj.z : (zTop / 1000);
                    const detectedStoryId = detectStoryId(topZ);
                    newColumns.push({
                      id: c.id,
                      x: ni.x,
                      y: ni.y,
                      b: colB,
                      h: colH,
                      L,
                      zBottom: zBot,
                      zTop: zTop,
                      storyId: detectedStoryId,
                    });
                  }

                  // ── 4. رفع البيانات إلى الحالة مع تفعيل وضع الاستيراد ──
                  if (newSlabs.length > 0 || newBeams.length > 0 || newColumns.length > 0) {
                    if (newSlabs.length > 0) dispatch({ type: 'SET_SLABS', slabs: newSlabs });
                    dispatch({ type: 'SET_EXTRA_BEAMS', beams: newBeams });
                    dispatch({ type: 'SET_EXTRA_COLUMNS', columns: newColumns });
                    dispatch({ type: 'SET_ETABS_IMPORT_MODE', value: true });
                    dispatch({ type: 'SAVE_SNAPSHOT', message: `✓ ETABS: ${newColumns.length} عمود | ${newBeams.length} جسر | ${newSlabs.length} بلاطة` });
                  }
                }} />
              </TabsContent>

              {/* ── EDB / E2K File Import ── */}
              <TabsContent value="slabs-edb-import" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <ETABSEdbImportPanel
                  onApply={(edbData: EdbImportedData) => {
                    const jointMap = new Map(edbData.joints.map(j => [j.id, j]));

                    // ── تحديد الدور بناءً على المنسوب Z (بالمتر) ──
                    const detectStoryId = (zMeters: number): string => {
                      if (!stories.length) return 'ST1';
                      const zMm = zMeters * 1000;
                      let bestId = stories[0].id;
                      let bestDiff = Infinity;
                      for (const s of stories) {
                        const topElev = (s.elevation ?? 0) + s.height;
                        const diff = Math.abs(topElev - zMm);
                        if (diff < bestDiff) { bestDiff = diff; bestId = s.id; }
                      }
                      return bestId;
                    };

                    // ── استخراج fc وfy من المواد ──
                    const concMat = edbData.materials.find(m =>
                      m.type === 'CONCRETE' || m.type === 'CONC' || m.type.includes('CONC')
                    );
                    if (concMat?.fc && concMat.fc > 1) {
                      dispatch({ type: 'SET_MAT', mat: { ...mat, fc: concMat.fc } });
                    }
                    if (concMat?.fy && concMat.fy > 10) {
                      dispatch({ type: 'SET_MAT', mat: { ...mat, fy: concMat.fy } });
                    }

                    // ── خريطة المقاطع ──
                    const sectionMap = new Map(edbData.sections.map(s => [s.id, s]));
                    const areaSectionMap = new Map(edbData.areaSections.map(s => [s.id, s]));

                    // ── 1. تحويل الجسور ──
                    const newBeams: Beam[] = [];
                    for (const f of edbData.frames.filter(f => f.elementType === 'beam')) {
                      const ji = jointMap.get(f.jointI);
                      const jj = jointMap.get(f.jointJ);
                      if (!ji || !jj) continue;
                      const dx = jj.x - ji.x;
                      const dy = jj.y - ji.y;
                      const len = Math.sqrt(dx * dx + dy * dy);
                      if (len < 0.01) continue;
                      const direction: 'horizontal' | 'vertical' =
                        Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
                      const avgZ = (ji.z + jj.z) / 2;
                      const sec = sectionMap.get(f.section);
                      newBeams.push({
                        id: f.id,
                        fromCol: f.jointI,
                        toCol: f.jointJ,
                        x1: ji.x, y1: ji.y,
                        x2: jj.x, y2: jj.y,
                        z: avgZ * 1000,
                        length: len,
                        direction,
                        b: sec ? Math.round(sec.b) : beamB,
                        h: sec ? Math.round(sec.h) : beamH,
                        deadLoad: 0,
                        liveLoad: 0,
                        slabs: [],
                        storyId: detectStoryId(avgZ),
                      });
                    }

                    // ── 2. تحويل الأعمدة ──
                    const newColumns: Column[] = [];
                    for (const f of edbData.frames.filter(f => f.elementType === 'column')) {
                      const ji = jointMap.get(f.jointI);
                      const jj = jointMap.get(f.jointJ);
                      if (!ji || !jj) continue;
                      const zBot = Math.min(ji.z, jj.z);
                      const zTop = Math.max(ji.z, jj.z);
                      const height = (zTop - zBot) * 1000; // mm
                      if (height < 10) continue;
                      const sec = sectionMap.get(f.section);
                      const topJoint = zTop === jj.z ? jj : ji;
                      newColumns.push({
                        id: f.id,
                        x: topJoint.x,
                        y: topJoint.y,
                        b: sec ? Math.round(sec.b) : colB,
                        h: sec ? Math.round(sec.h) : colH,
                        L: Math.round(height),
                        zBottom: zBot * 1000,
                        zTop: zTop * 1000,
                        storyId: detectStoryId(zTop),
                      });
                    }

                    // ── 3. تحويل البلاطات ──
                    const newSlabs: Slab[] = [];
                    for (const a of edbData.areas) {
                      const coords = a.joints.map(jId => jointMap.get(jId)).filter(Boolean);
                      if (coords.length < 3) continue;
                      const xs = coords.map(c => c!.x);
                      const ys = coords.map(c => c!.y);
                      const avgZ = coords.reduce((sum, c) => sum + c!.z, 0) / coords.length;
                      const areaSec = areaSectionMap.get(a.section);
                      if (areaSec?.thickness && areaSec.thickness > 0) {
                        dispatch({ type: 'SET_SLAB_PROPS', props: { ...slabProps, thickness: Math.round(areaSec.thickness) } });
                      }
                      newSlabs.push({
                        id: a.id,
                        x1: Math.min(...xs), y1: Math.min(...ys),
                        x2: Math.max(...xs), y2: Math.max(...ys),
                        storyId: detectStoryId(avgZ),
                      });
                    }

                    // ── 4. تحويل ردود الأفعال لتصميم الأساسات ──
                    if (edbData.hasAnalysisResults && edbData.reactions.length > 0) {
                      // تجميع ردود الأفعال لكل عقدة (مجموع الحالات)
                      const reactionMap = new Map<string, { Fz: number; count: number }>();
                      for (const r of edbData.reactions) {
                        const lc = r.loadCase.toUpperCase();
                        if (lc.includes('DEAD') || lc.includes('LIVE') || lc.includes('DL') || lc.includes('LL')) {
                          const existing = reactionMap.get(r.joint) ?? { Fz: 0, count: 0 };
                          reactionMap.set(r.joint, {
                            Fz: existing.Fz + Math.abs(r.Fz),
                            count: existing.count + 1,
                          });
                        }
                      }
                      // تحويل إلى ETABSReaction format for FoundationDesignPanel
                      const etabsReacts = Array.from(reactionMap.entries())
                        .filter(([, v]) => v.Fz > 0.01)
                        .map(([joint, v]) => ({
                          joint,
                          P_DL: v.Fz * 0.6, // تقدير: 60% DL
                          P_LL: v.Fz * 0.4, // تقدير: 40% LL
                        }));
                      if (etabsReacts.length > 0) {
                        setEtabsReactions(etabsReacts as any);
                      }
                    }

                    // ── 5. تطبيق البيانات ──
                    if (newSlabs.length > 0) dispatch({ type: 'SET_SLABS', slabs: newSlabs });
                    if (newBeams.length > 0) dispatch({ type: 'SET_EXTRA_BEAMS', beams: newBeams });
                    if (newColumns.length > 0) dispatch({ type: 'SET_EXTRA_COLUMNS', columns: newColumns });
                    dispatch({ type: 'SET_ETABS_IMPORT_MODE', value: true });
                    dispatch({
                      type: 'SAVE_SNAPSHOT',
                      message: `✓ ETABS E2K: ${newColumns.length} عمود | ${newBeams.length} جسر | ${newSlabs.length} بلاطة`,
                    });
                  }}
                />
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* VIEW TAB */}
          <TabsContent value="view" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm">العرض ثنائي الأبعاد</CardTitle>
                  {analyzed && (
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showViewMoments}
                          onChange={e => setShowViewMoments(e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-[11px]">عرض العزوم</span>
                      </label>
                      {showViewMoments && (
                        <select
                          className="h-7 rounded border border-input bg-background px-2 text-[11px] min-w-[140px]"
                          value={viewMomentEngine}
                          onChange={e => setViewMomentEngine(e.target.value as 'active' | '2d' | '3d' | 'gf')}
                        >
                          <option value="active">المحرك النشط ({ENGINE_LABELS[selectedEngine]})</option>
                          <option value="2d">2D — صلابة المصفوفة</option>
                          <option value="3d">3D — إطارات ثلاثية</option>
                          <option value="gf">Global Frame — إطار عام</option>
                        </select>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!analyzed && <Button onClick={runAnalysis} className="mb-3 min-h-[44px]">تشغيل التحليل</Button>}
                <BuildingView
                  slabs={slabs} beams={beamsWithLoads} columns={columns}
                  analyzed={analyzed}
                  frameResults={
                    !showViewMoments ? frameResults :
                    viewMomentEngine === '2d' ? frameResults2D :
                    viewMomentEngine === '3d' ? frameResults3DRaw :
                    viewMomentEngine === 'gf' ? frameResultsGF :
                    frameResults
                  }
                  beamDesigns={beamDesigns} colDesigns={colDesigns}
                  onSelectElement={handleViewSelectElement}
                  removedColumnIds={removedColumnIds} bobConnections={bobConnections}
                  showMoments={showViewMoments}
                />
                {analyzed && showViewMoments && (
                  <div className="mt-2 p-2 rounded bg-muted/50 text-[10px] text-muted-foreground">
                    <p><strong>محرك العزوم: {
                      viewMomentEngine === '2d' ? '2D — صلابة المصفوفة' :
                      viewMomentEngine === '3d' ? '3D — إطارات ثلاثية' :
                      viewMomentEngine === 'gf' ? 'Global Frame — إطار عام' :
                      ENGINE_LABELS[selectedEngine]
                    }</strong></p>
                    <p>• الجسور الأفقية: M⁻ فوق الجسر، M⁺ تحت الجسر</p>
                    <p>• الجسور العمودية: M⁻ يمين الجسر، M⁺ يسار الجسر</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ANALYSIS TAB */}
          <TabsContent value="analysis" className="flex-1 overflow-hidden mt-0">
            <Tabs defaultValue="analysis-main" className="flex-1 flex flex-col h-full overflow-hidden">
              <TabsList className="w-full justify-start rounded-none border-b border-border bg-muted/30 px-2 shrink-0 h-auto overflow-x-auto flex-nowrap">
                <TabsTrigger value="analysis-main" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap"><Calculator size={12} />التحليل الرئيسي</TabsTrigger>
                <TabsTrigger value="analysis-compare" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap text-blue-600 dark:text-blue-400"><BarChart3 size={12} />مقارنة توزيع الأحمال</TabsTrigger>
                <TabsTrigger value="analysis-fem-compare" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap text-emerald-600 dark:text-emerald-400"><BarChart3 size={12} />Comparison</TabsTrigger>
                <TabsTrigger value="analysis-etabs-import" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap text-orange-600 dark:text-orange-400"><BarChart3 size={12} />مقارنة ETABS</TabsTrigger>
                <TabsTrigger value="analysis-beam-loads" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap text-purple-600 dark:text-purple-400"><Ruler size={12} />أحمال الجسور</TabsTrigger>
                <TabsTrigger value="analysis-slab" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap text-teal-600 dark:text-teal-400"><Layers size={12} />تحليل البلاطات</TabsTrigger>
                <TabsTrigger value="analysis-slab-load-diag" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap text-cyan-600 dark:text-cyan-400"><Activity size={12} />تشخيص نقل أحمال البلاطة</TabsTrigger>
                <TabsTrigger value="analysis-biaxial" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap text-orange-600 dark:text-orange-400"><RotateCcw size={12} />الأعمدة ثنائية المحور</TabsTrigger>
              </TabsList>
              <TabsContent value="analysis-main" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
            {/* ── Analysis Engine Selector ──────────────────────────────── */}
            <Card className="mb-3 border-blue-200 dark:border-blue-800 bg-blue-500/5">
              <CardContent className="py-3 px-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Zap size={14} className="text-blue-500 shrink-0" />
                  <span className="text-xs font-semibold text-foreground">محرك التحليل</span>
                  <select
                    className="h-8 rounded border border-input bg-background px-2 text-xs flex-1 min-w-[160px] max-w-[240px]"
                    value={selectedEngine}
                    onChange={e => {
                      dispatch({ type: 'SET_ENGINE', engine: e.target.value as EngineType });
                      setFemError(null);
                    }}
                  >
                    <option value="legacy_2d">2D — طريقة صلابة المصفوفة (كلاسيكي)</option>
                    <option value="legacy_3d">3D Unified — محرك ثلاثي الأبعاد موحّد (Legacy + GF + UC)</option>
                    <option value="fem_coupled">FEM (Coupled) — جسور-بلاطات مقترن</option>
                  </select>
                  <Badge
                    className={`text-[10px] shrink-0 ${
                      selectedEngine === 'fem_coupled'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-400/40'
                        : selectedEngine === 'legacy_2d'
                          ? 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-400/40'
                          : 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-400/40'
                    }`}
                  >
                    {ENGINE_LABELS[selectedEngine]}
                  </Badge>
                  {selectedEngine === 'fem_coupled' && !ignoreSlab && (
                    <span className="text-[10px] text-muted-foreground">
                      يتطلب وجود بلاطات وأعمدة — يستغرق وقتاً أطول
                    </span>
                  )}
                </div>

                {/* ── زر إهمال جساءة البلاطات ── */}
                <div className="mt-3 pt-3 border-t border-border/50">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative mt-0.5">
                      <input
                        type="checkbox"
                        checked={ignoreSlab}
                        onChange={e => dispatch({ type: 'SET_IGNORE_SLAB', value: e.target.checked })}
                        className="sr-only"
                      />
                      <div
                        onClick={() => dispatch({ type: 'SET_IGNORE_SLAB', value: !ignoreSlab })}
                        className={`w-9 h-5 rounded-full transition-colors cursor-pointer flex items-center px-0.5 ${
                          ignoreSlab
                            ? 'bg-amber-500'
                            : 'bg-muted border border-border'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                          ignoreSlab ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">
                          إهمال جساءة البلاطات
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                          ignoreSlab
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-400/40'
                            : 'bg-muted text-muted-foreground border border-border'
                        }`}>
                          {ignoreSlab ? 'مُفعّل' : 'غير مُفعّل'}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                        {ignoreSlab
                          ? '⚠️ البلاطات تنقل الأحمال فقط — الجسور والأعمدة تحمل كل الجساءة (مطابق لـ ETABS "No Slab Stiffness")'
                          : 'البلاطات تُشارك في الجساءة الإنشائية للإطار (التحليل الكامل المقترن)'}
                      </p>
                      {ignoreSlab && selectedEngine === 'fem_coupled' && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 font-medium">
                          ↳ سيُستخدم محرك 3D (إطار نقي) مع أحمال المنطقة التأثيرية
                        </p>
                      )}
                    </div>
                  </label>

                  {/* معاملات تخفيض الجساءة — قابلة للتعديل */}
                  <div className="mt-2 rounded-md bg-blue-500/5 border border-blue-200/50 dark:border-blue-800/50 px-3 py-2">
                    <p className="text-[10px] text-blue-700 dark:text-blue-400 font-semibold mb-1">
                      معاملات تخفيض الجساءة (ACI 318-19 §6.6.3):
                    </p>
                    <div className="grid grid-cols-3 gap-1 text-[10px] text-center">
                      <div className="rounded bg-background border border-border px-1 py-1">
                        <input
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="1.0"
                          value={beamStiffnessFactor}
                          onChange={e => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v >= 0.1 && v <= 1.0) dispatch({ type: 'SET_BEAM_STIFFNESS_FACTOR', value: v });
                          }}
                          className="w-full text-center font-bold text-foreground bg-transparent border-none outline-none text-[11px] p-0"
                        />
                        <div className="text-muted-foreground">جسور</div>
                      </div>
                      <div className="rounded bg-background border border-border px-1 py-1">
                        <input
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="1.0"
                          value={colStiffnessFactor}
                          onChange={e => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v >= 0.1 && v <= 1.0) dispatch({ type: 'SET_COL_STIFFNESS_FACTOR', value: v });
                          }}
                          className="w-full text-center font-bold text-foreground bg-transparent border-none outline-none text-[11px] p-0"
                        />
                        <div className="text-muted-foreground">أعمدة</div>
                      </div>
                      <div className={`rounded border px-1 py-1 ${ignoreSlab ? 'bg-amber-500/10 border-amber-400/40' : 'bg-background border-border'}`}>
                        <div className={`font-bold ${ignoreSlab ? 'text-amber-600 dark:text-amber-400 line-through' : 'text-foreground'}`}>
                          {ignoreSlab ? '0' : '0.25'}
                        </div>
                        <div className="text-muted-foreground">بلاطات</div>
                      </div>
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-1">
                      غيّر القيم أعلاه للتحكم بجساءة الجسور والأعمدة عند التحليل
                    </p>
                  </div>

                  {/* إزاحات النهايات الصلبة (ETABS End Length Offsets) */}
                  <div className="mt-2 rounded-md bg-orange-500/5 border border-orange-200/50 dark:border-orange-800/50 px-3 py-2">
                    <p className="text-[10px] text-orange-700 dark:text-orange-400 font-semibold mb-1">
                      إزاحات النهايات الصلبة (ETABS End Length Offsets):
                    </p>
                    <p className="text-[9px] text-muted-foreground mb-2 leading-relaxed">
                      تُقلِّص البحر الفعّال للجسر إلى حافة العمود بدلاً من مركزه — تُقلِّل العزوم عند الوجوه.
                    </p>
                    {columns.filter(c => !c.isRemoved).length === 0 ? (
                      <p className="text-[9px] text-muted-foreground italic">لا توجد أعمدة</p>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="mb-1.5 text-[9px] px-2 py-0.5 rounded border border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors"
                          onClick={() => {
                            const allCols = columns.filter(c => !c.isRemoved);
                            const allEnabled = allCols.every(c => colRigidEndOffsets[c.id]);
                            allCols.forEach(c => dispatch({ type: 'SET_COL_RIGID_OFFSET', colId: c.id, enabled: !allEnabled }));
                          }}
                        >
                          {columns.filter(c => !c.isRemoved).every(c => colRigidEndOffsets[c.id]) ? '⬜ إلغاء الكل' : '☑ تفعيل الكل'}
                        </button>
                        <div className="flex flex-wrap gap-1">
                          {columns.filter(c => !c.isRemoved).map(c => (
                            <label key={c.id} className="flex items-center gap-1 text-[9px] cursor-pointer select-none bg-background border border-border rounded px-1.5 py-0.5 hover:bg-accent/20 transition-colors">
                              <input
                                type="checkbox"
                                className="w-3 h-3 accent-orange-500"
                                checked={!!colRigidEndOffsets[c.id]}
                                onChange={e => dispatch({ type: 'SET_COL_RIGID_OFFSET', colId: c.id, enabled: e.target.checked })}
                              />
                              <span className="font-mono">{c.id} <span className="text-muted-foreground">({c.b}×{c.h})</span></span>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {femError && (
                  <div className="mt-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
                    ⚠️ {femError}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── تصدير عزوم 7 محطات (خام) من جميع المحركات ────────────── */}
            <Card className="mb-3 border-indigo-200 dark:border-indigo-800 bg-indigo-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Download size={14} className="text-indigo-500" />
                  تصدير عزوم 7 محطات (خام بدون معالجة)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  يصدّر العزوم عند 7 محطات (0, L/6, 2L/6, L/2, 4L/6, 5L/6, L) لكل جسر
                  من جميع المحركات (2D, 3D, GF, UC, FEM) <b>كما أنتجها المحرك تماماً</b> —
                  بدون قلب إشارة، وبدون فرض موجب في الوسط أو سالب عند الركيزة، وبدون قيمة مطلقة.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!analyzed}
                  onClick={() => {
                    const engines: EngineRawStations[] = [];
                    if (frameResults2D.length)    engines.push({ engine: '2D',  data: extractRawStations(frameResults2D,    beamsWithLoads) });
                    if (frameResults3DRaw.length) engines.push({ engine: '3D',  data: extractRawStations(frameResults3DRaw, beamsWithLoads) });
                    if (frameResultsGF.length)    engines.push({ engine: 'GF',  data: extractRawStations(frameResultsGF,    beamsWithLoads) });
                    if (frameResultsUC.length)    engines.push({ engine: 'UC',  data: extractRawStations(frameResultsUC,    beamsWithLoads) });
                    if (selectedEngine === 'fem_coupled' && frameResults.length) {
                      engines.push({ engine: 'FEM', data: extractRawStations(frameResults, beamsWithLoads) });
                    }
                    const csv = buildRawStationsCSV(engines);
                    const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    downloadCSV(`raw_moment_stations_${ts}.csv`, csv);
                  }}
                  className="w-full min-h-[40px]"
                >
                  <Download size={14} className="mr-2" />
                  تصدير CSV — عزوم 7 محطات لكل جسر (كل المحركات)
                </Button>
                {!analyzed && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">
                    ⚠️ يجب تشغيل التحليل أولاً
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Duplicate Check Card - always visible */}
            <Card className="mb-3 border-orange-200 dark:border-orange-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Search size={14} className="text-orange-500" />
                  فحص تكرار العناصر
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  يفحص هذا الأداء وجود جسور أو أعمدة أو بلاطات أو نقاط متكررة (نفس الإحداثيات)، ويحذف العنصر الأقدم تسمية تلقائياً ويُبقي الأحدث.
                </p>
                {dupCheckResult && (
                  <div className={`rounded-lg p-3 text-xs space-y-1 ${dupCheckResult.count === 0 ? 'bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400' : 'bg-orange-500/10 border border-orange-500/30 text-orange-800 dark:text-orange-300'}`}>
                    <p className="font-semibold">{dupCheckResult.message}</p>
                    {dupCheckResult.items.length > 0 && (
                      <ul className="mt-1 space-y-0.5 list-disc list-inside text-[11px] text-muted-foreground">
                        {dupCheckResult.items.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <Button
                  onClick={checkAndRemoveDuplicates}
                  variant="outline"
                  className="w-full min-h-[44px] border-orange-300 text-orange-700 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-700 dark:hover:bg-orange-950"
                >
                  <Search size={14} className="mr-2" />
                  فحص التكرارات وحذفها
                </Button>
              </CardContent>
            </Card>

            {/* ── بطاقة التحقق من النموذج (Pre-Analysis Validation) ── */}
            <Card className="mb-3 border-teal-200 dark:border-teal-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckSquare size={14} className="text-teal-500" />
                  التحقق من سلامة النموذج
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  يفحص: العقد المكررة، العناصر الصفرية الطول، الاتصالية، الاستقرار، والعقد المعلقة.
                </p>
                {validationReport && (
                  <div className={`rounded-lg p-3 text-xs space-y-2 ${
                    validationReport.status === 'ok'
                      ? 'bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400'
                      : validationReport.status === 'warning'
                        ? 'bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300'
                        : 'bg-destructive/10 border border-destructive/30 text-destructive'
                  }`}>
                    <p className="font-semibold">
                      {validationReport.status === 'ok' ? '✅ النموذج سليم — جاهز للتحليل' :
                       validationReport.status === 'warning' ? '⚠️ النموذج به تحذيرات' :
                       '❌ النموذج به أخطاء تمنع التحليل'}
                    </p>
                    <div className="text-[10px] text-muted-foreground">
                      العقد المدمجة: {validationReport.mergedNodeMap.size > 0 ?
                        [...validationReport.mergedNodeMap.entries()].filter(([k, v]) => k !== v).length : 0}
                      {' | '}المكونات المتصلة: {validationReport.connectedComponents}
                    </div>
                    {validationReport.issues.map((issue, i) => (
                      <div key={i} className="mt-1">
                        {/* ── عرض عادي لجميع أنواع المشاكل عدا انفصال النموذج ── */}
                        {issue.type !== 'disconnected_model' && (
                          <>
                            <span className="font-medium">
                              {issue.type === 'duplicate_nodes' && `🔗 عقد مكررة: ${issue.count}`}
                              {issue.type === 'dangling_nodes' && `⚡ عقد معلقة: ${issue.count}`}
                              {issue.type === 'zero_length_elements' && `📏 عناصر صفرية الطول: ${issue.count}`}
                              {issue.type === 'no_supports' && `🏗️ لا توجد مساند`}
                              {issue.type === 'unstable_system' && `⚠️ تحذير استقرار`}
                            </span>
                            {issue.details && issue.details.length > 0 && (
                              <ul className="mt-0.5 space-y-0.5 list-disc list-inside text-[10px]">
                                {issue.details.slice(0, 5).map((d, j) => <li key={j}>{d}</li>)}
                                {issue.details.length > 5 && <li>... و{issue.details.length - 5} أخرى</li>}
                              </ul>
                            )}
                          </>
                        )}

                        {/* ── عرض تفصيلي لخطأ انفصال النموذج ── */}
                        {issue.type === 'disconnected_model' && (() => {
                          const colMap  = new Map(columns.filter(c => !c.isRemoved).map(c => [c.id, c]));
                          const beamMap = new Map(beams.map(b => [b.id, b]));
                          const storyMap = new Map(stories.map(s => [s.id, s.label]));
                          const comps   = issue.componentElements ?? [];
                          const maxSize = Math.max(...comps.map(c => c.length));

                          return (
                            <div className="space-y-2">
                              <span className="font-medium text-red-700 dark:text-red-400">
                                🔌 النموذج غير متصل — {issue.components} أجزاء منفصلة
                              </span>
                              <div className="space-y-1.5 mt-1">
                                {comps.map((compElems, idx) => {
                                  const isMain = compElems.length === maxSize;

                                  if (isMain) {
                                    const nCols  = compElems.filter(e => e.type === 'column').length;
                                    const nBeams = compElems.filter(e => e.type === 'beam').length;
                                    return (
                                      <div key={idx} className="text-[10px] text-muted-foreground border border-dashed border-border rounded px-2 py-1">
                                        ✅ الجزء الرئيسي — {nCols} عمود، {nBeams} جسر (الإطار المتصل)
                                      </div>
                                    );
                                  }

                                  // جزء معزول — فكّ رموز العناصر
                                  const isolCols = compElems
                                    .filter(e => e.type === 'column')
                                    .map(e => colMap.get(e.id.replace(/^col_/, '')))
                                    .filter((c): c is NonNullable<typeof c> => !!c);
                                  const isolBeams = compElems
                                    .filter(e => e.type === 'beam')
                                    .map(e => beamMap.get(e.id.replace(/^beam_/, '')))
                                    .filter((b): b is NonNullable<typeof b> => !!b);

                                  return (
                                    <div key={idx} className="rounded-lg border border-red-300 dark:border-red-800 bg-red-500/8 p-2 text-[10px] space-y-1">
                                      <div className="font-semibold text-red-700 dark:text-red-400">
                                        ⛔ جزء معزول {idx + 1} — {compElems.length} عنصر غير متصل بالإطار الرئيسي
                                      </div>

                                      {isolCols.length > 0 && (
                                        <div className="space-y-0.5">
                                          <div className="font-medium text-muted-foreground">الأعمدة المعزولة:</div>
                                          {isolCols.map((c, ci) => {
                                            const storyLabel = c.storyId ? (storyMap.get(c.storyId) ?? c.storyId) : null;
                                            return (
                                              <div key={ci} className="flex items-center gap-1">
                                                <span>📌</span>
                                                <span>عمود عند موضع ({c.x.toFixed(2)} m، {c.y.toFixed(2)} m)</span>
                                                {storyLabel && <span className="text-muted-foreground">— {storyLabel}</span>}
                                                <span className="text-muted-foreground">({c.b}×{c.h} مم)</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}

                                      {isolBeams.length > 0 && (
                                        <div className="space-y-0.5">
                                          <div className="font-medium text-muted-foreground">الجسور المعزولة:</div>
                                          {isolBeams.map((b, bi) => {
                                            const storyLabel = b.storyId ? (storyMap.get(b.storyId) ?? b.storyId) : null;
                                            return (
                                              <div key={bi} className="flex items-center gap-1">
                                                <span>📐</span>
                                                <span>جسر من ({b.x1.toFixed(2)}, {b.y1.toFixed(2)}) إلى ({b.x2.toFixed(2)}, {b.y2.toFixed(2)}) م</span>
                                                {storyLabel && <span className="text-muted-foreground">— {storyLabel}</span>}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}

                                      <div className="text-[9px] text-muted-foreground border-t border-red-200 dark:border-red-800 pt-1 mt-1">
                                        💡 الحل: تأكد من وجود جسر أو عمود يربط هذه العناصر بالإطار الرئيسي — أو تحقق من تطابق الإحداثيات عند نقاط الوصل.
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  onClick={() => {
                    setValidationRunning(true);
                    import('@/core/validation/preAnalysisValidator').then(({ runPreAnalysisChecks }) => {
                      const vNodes = [];
                      const vElements = [];
                      // Build validation nodes from columns
                      for (const c of columns.filter(cc => !cc.isRemoved)) {
                        const zBot = c.zBottom ?? 0;
                        const zTop = c.zTop ?? (zBot + c.L);
                        vNodes.push({ id: `${c.id}_bot`, x: c.x * 1000, y: c.y * 1000, z: zBot, restraints: [true, true, true, true, true, true] as [boolean,boolean,boolean,boolean,boolean,boolean] });
                        vNodes.push({ id: `${c.id}_top`, x: c.x * 1000, y: c.y * 1000, z: zTop, restraints: [false, false, false, false, false, false] as [boolean,boolean,boolean,boolean,boolean,boolean] });
                        vElements.push({ id: `col_${c.id}`, nodeI: `${c.id}_bot`, nodeJ: `${c.id}_top`, type: 'column' as const });
                      }
                      // Build validation elements from beams
                      for (const b of beams.filter(bb => !removedBeamIds.includes(bb.id))) {
                        const zMm = b.z ?? 0;
                        const niId = `beam_${b.id}_I`;
                        const njId = `beam_${b.id}_J`;
                        vNodes.push({ id: niId, x: b.x1 * 1000, y: b.y1 * 1000, z: zMm, restraints: [false, false, false, false, false, false] as [boolean,boolean,boolean,boolean,boolean,boolean] });
                        vNodes.push({ id: njId, x: b.x2 * 1000, y: b.y2 * 1000, z: zMm, restraints: [false, false, false, false, false, false] as [boolean,boolean,boolean,boolean,boolean,boolean] });
                        vElements.push({ id: `beam_${b.id}`, nodeI: niId, nodeJ: njId, type: 'beam' as const });
                      }
                      const result = runPreAnalysisChecks(vNodes, vElements);
                      setValidationReport(result.report);
                      setValidationRunning(false);
                    });
                  }}
                  disabled={validationRunning}
                  variant="outline"
                  className="w-full min-h-[44px] border-teal-300 text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:border-teal-700 dark:hover:bg-teal-950"
                >
                  <CheckSquare size={14} className="mr-2" />
                  {validationRunning ? 'جارٍ الفحص...' : 'فحص سلامة النموذج'}
                </Button>
              </CardContent>
            </Card>

            {(detectedConnections.length > 0 || (analyzed && bobConnections.length > 0)) && (
              <Card className="border-indigo-200 dark:border-indigo-800 bg-indigo-500/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <span className="text-indigo-500">⇅</span>
                    اتصالات الجسور الحاملة / المحمولة
                    <span className="text-[10px] font-normal text-muted-foreground">
                      ({detectedConnections.length} اتصال مكتشف)
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {detectedConnections.map((conn, i) => {
                    const analyzedConn = bobConnections.find(c => c.removedColumnId === conn.removedColumnId);
                    const primaryBeam = beamsWithLoads.find(b => b.id === conn.primaryBeamId);
                    const contBeam = conn.continuationBeamId ? beamsWithLoads.find(b => b.id === conn.continuationBeamId) : undefined;
                    const isManualOverride = bobManualPrimary[conn.removedColumnId] !== undefined;

                    // Determine criterion label
                    const criterion = (() => {
                      if (isManualOverride) return 'تعيين يدوي ✎';
                      const hB = beamsWithLoads.filter(b =>
                        (b.fromCol === conn.removedColumnId || b.toCol === conn.removedColumnId) && b.direction === 'horizontal'
                      );
                      const vB = beamsWithLoads.filter(b =>
                        (b.fromCol === conn.removedColumnId || b.toCol === conn.removedColumnId) && b.direction === 'vertical'
                      );
                      if (conn.primaryDirection === 'horizontal' && hB.length >= 2 && vB.length === 1) return 'استمرارية (2 أفقي + 1 رأسي)';
                      if (conn.primaryDirection === 'vertical' && vB.length >= 2 && hB.length === 1) return 'استمرارية (2 رأسي + 1 أفقي)';
                      return 'صلابة EI/L';
                    })();

                    // Collect beams at this column for SVG
                    const hBeamsAtCol = beamsWithLoads.filter(b =>
                      (b.fromCol === conn.removedColumnId || b.toCol === conn.removedColumnId) && b.direction === 'horizontal'
                    );
                    const vBeamsAtCol = beamsWithLoads.filter(b =>
                      (b.fromCol === conn.removedColumnId || b.toCol === conn.removedColumnId) && b.direction === 'vertical'
                    );
                    const primaryIsH = conn.primaryDirection === 'horizontal';

                    return (
                      <div key={i} className="rounded-lg border border-indigo-200/60 dark:border-indigo-800/60 bg-background p-3 space-y-3">

                        {/* ── SVG diagram + text info side-by-side ── */}
                        <div className="flex gap-3 items-start flex-wrap">

                          {/* SVG cross diagram */}
                          <div className="shrink-0">
                            <svg width="110" height="110" viewBox="0 0 110 110" className="rounded border border-border bg-muted/30">
                              {/* Horizontal beam arm(s) */}
                              {hBeamsAtCol.map((hb, hi) => {
                                const isCarrier = primaryIsH;
                                const color = isCarrier ? '#22c55e' : '#ef4444';
                                const strokeW = isCarrier ? 5 : 3;
                                // slight vertical offset for multiple beams
                                const yOff = (hi - (hBeamsAtCol.length - 1) / 2) * 6;
                                return (
                                  <g key={hb.id}>
                                    <line x1={5} y1={55 + yOff} x2={105} y2={55 + yOff} stroke={color} strokeWidth={strokeW} strokeLinecap="round" />
                                    <text x={8} y={55 + yOff - 3} fontSize={7} fill={color} fontWeight="bold">{hb.id}</text>
                                  </g>
                                );
                              })}
                              {/* Vertical beam arm(s) */}
                              {vBeamsAtCol.map((vb, vi) => {
                                const isCarrier = !primaryIsH;
                                const color = isCarrier ? '#22c55e' : '#ef4444';
                                const strokeW = isCarrier ? 5 : 3;
                                const xOff = (vi - (vBeamsAtCol.length - 1) / 2) * 6;
                                return (
                                  <g key={vb.id}>
                                    <line x1={55 + xOff} y1={5} x2={55 + xOff} y2={105} stroke={color} strokeWidth={strokeW} strokeLinecap="round" />
                                    <text x={55 + xOff + 3} y={14} fontSize={7} fill={color} fontWeight="bold">{vb.id}</text>
                                  </g>
                                );
                              })}
                              {/* Removed column dot at intersection */}
                              <circle cx={55} cy={55} r={6} fill="#6366f1" stroke="white" strokeWidth={1.5} />
                              <text x={55} y={55 + 3.5} textAnchor="middle" fontSize={6} fill="white" fontWeight="bold">✕</text>
                              {/* Legend labels */}
                              <text x={55} y={106} textAnchor="middle" fontSize={6} fill="#6366f1">{conn.removedColumnId}</text>
                              {/* Carrier/carried corner labels */}
                              <text x={4} y={108} fontSize={6} fill="#22c55e">حامل</text>
                              <text x={75} y={108} fontSize={6} fill="#ef4444">محمول</text>
                            </svg>
                          </div>

                          {/* Text details */}
                          <div className="flex-1 min-w-0 space-y-2">
                            {/* Header */}
                            <div className="flex items-center justify-between flex-wrap gap-1">
                              <span className="text-[10px] text-muted-foreground leading-relaxed">
                                عمود محذوف: <span className="font-mono font-bold text-foreground">{conn.removedColumnId}</span>
                                <span className="mx-1 opacity-40">·</span>
                                ({conn.point.x.toFixed(1)}، {conn.point.y.toFixed(1)}) م
                                <br />
                                معيار: <span className={`font-semibold ${isManualOverride ? 'text-violet-600 dark:text-violet-400' : ''}`}>{criterion}</span>
                              </span>
                              {analyzedConn && analyzedConn.reactionForce > 0 && (
                                <span className="text-[10px] font-bold bg-amber-500/15 border border-amber-400/40 text-amber-700 dark:text-amber-400 rounded px-2 py-0.5">
                                  حِمل منقول: {analyzedConn.reactionForce.toFixed(1)} kN
                                </span>
                              )}
                            </div>

                            {/* Manual override flip button */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] text-muted-foreground">الجسر الحامل:</span>
                              <button
                                onClick={() => {
                                  const currentForced = bobManualPrimary[conn.removedColumnId];
                                  if (currentForced === undefined) {
                                    // First flip: override to opposite of auto
                                    dispatch({ type: 'SET_BOB_MANUAL_PRIMARY', colId: conn.removedColumnId, direction: primaryIsH ? 'vertical' : 'horizontal' });
                                  } else if (currentForced !== conn.primaryDirection as 'horizontal' | 'vertical') {
                                    // Second flip: back to auto (remove override)
                                    dispatch({ type: 'SET_BOB_MANUAL_PRIMARY', colId: conn.removedColumnId, direction: null });
                                  } else {
                                    // Flip to opposite
                                    dispatch({ type: 'SET_BOB_MANUAL_PRIMARY', colId: conn.removedColumnId, direction: currentForced === 'horizontal' ? 'vertical' : 'horizontal' });
                                  }
                                }}
                                className={`inline-flex items-center gap-1 text-[10px] font-bold rounded border px-2 py-0.5 transition-colors cursor-pointer
                                  ${isManualOverride
                                    ? 'bg-violet-500/15 border-violet-400/50 text-violet-700 dark:text-violet-400 hover:bg-violet-500/25'
                                    : 'bg-muted border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                                  }`}
                                title="اضغط لتبديل الجسر الحامل / المحمول يدوياً"
                              >
                                <span>{primaryIsH ? 'أفقي ↔' : 'رأسي ↕'}</span>
                                {isManualOverride ? <span>· يدوي ✎</span> : <span>· تلقائي</span>}
                              </button>
                              {isManualOverride && (
                                <button
                                  onClick={() => dispatch({ type: 'SET_BOB_MANUAL_PRIMARY', colId: conn.removedColumnId, direction: null })}
                                  className="text-[9px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                                >
                                  إعادة تعيين تلقائي
                                </button>
                              )}
                            </div>

                            {/* Primary beam row */}
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-16 text-[10px] font-bold rounded bg-green-500/15 border border-green-400/40 text-green-700 dark:text-green-400 px-1 py-0.5">
                                حامل ✓
                              </span>
                              <div className="flex-1 min-w-0">
                                <span className="font-mono text-xs font-bold text-foreground">{conn.primaryBeamId}</span>
                                {primaryBeam && (
                                  <span className="text-[10px] text-muted-foreground mr-2">
                                    {conn.primaryDirection === 'horizontal' ? 'أفقي' : 'رأسي'} —
                                    بحر {(primaryBeam.length / 1000).toFixed(2)} م —
                                    {primaryBeam.b}×{primaryBeam.h} مم
                                  </span>
                                )}
                                {analyzedConn && analyzedConn.reactionForce > 0 && (
                                  <span className="text-[10px] text-muted-foreground mr-2">
                                    @ {(conn.distanceOnPrimary / 1000).toFixed(2)} م من الطرف
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Continuation beam */}
                            {contBeam && (
                              <div className="flex items-start gap-2">
                                <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-16 text-[10px] font-bold rounded bg-green-500/10 border border-green-400/30 text-green-600 dark:text-green-500 px-1 py-0.5">
                                  حامل A2
                                </span>
                                <div className="flex-1 min-w-0">
                                  <span className="font-mono text-xs font-bold text-foreground">{conn.continuationBeamId}</span>
                                  <span className="text-[10px] text-muted-foreground mr-2">
                                    استمرار — {(contBeam.length / 1000).toFixed(2)} م — {contBeam.b}×{contBeam.h} مم
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Secondary beams */}
                            {conn.secondaryBeamIds.map(sid => {
                              const sb = beamsWithLoads.find(b => b.id === sid);
                              const isHingedAtI = sb?.fromCol === conn.removedColumnId;
                              return (
                                <div key={sid} className="flex items-start gap-2">
                                  <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-16 text-[10px] font-bold rounded bg-red-500/15 border border-red-400/40 text-red-700 dark:text-red-400 px-1 py-0.5">
                                    محمول ⭕
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <span className="font-mono text-xs font-bold text-foreground">{sid}</span>
                                    {sb && (
                                      <span className="text-[10px] text-muted-foreground mr-2">
                                        {sb.direction === 'horizontal' ? 'أفقي' : 'رأسي'} —
                                        {(sb.length / 1000).toFixed(2)} م —
                                        {sb.b}×{sb.h} مم —
                                        مفصلة عند {isHingedAtI ? 'البداية (I)' : 'النهاية (J)'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!analyzed && (
                    <p className="text-[10px] text-muted-foreground text-center pt-1">
                      شغّل التحليل لحساب قيم ردود الأفعال المنقولة
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {!analyzed ? (
              <Card><CardContent className="py-12 text-center">
                <p className="text-muted-foreground mb-4">يرجى تشغيل التحليل أولاً</p>
                <Button onClick={runAnalysis} className="min-h-[44px]">تشغيل التحليل</Button>
              </CardContent></Card>
            ) : (
              <div className="space-y-4">
                {/* ── مؤشر وضع التحليل ── */}
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] border ${
                  ignoreSlab
                    ? 'bg-amber-500/10 border-amber-400/40 text-amber-700 dark:text-amber-400'
                    : selectedEngine === 'fem_coupled'
                      ? 'bg-emerald-500/10 border-emerald-400/40 text-emerald-700 dark:text-emerald-400'
                      : selectedEngine === 'legacy_2d'
                        ? 'bg-violet-500/10 border-violet-400/40 text-violet-700 dark:text-violet-400'
                        : 'bg-blue-500/10 border-blue-400/40 text-blue-700 dark:text-blue-400'
                }`}>
                  <Zap size={12} className="shrink-0" />
                  <span className="font-semibold">
                    {ignoreSlab
                      ? 'تحليل إطار نقي — جساءة البلاطات مُهملة'
                      : selectedEngine === 'fem_coupled'
                        ? 'تحليل FEM مقترن (جسور + بلاطات)'
                        : selectedEngine === 'legacy_2d'
                          ? 'تحليل 2D — طريقة صلابة المصفوفة'
                          : 'تحليل 3D — إطارات ثلاثية الأبعاد'}
                  </span>
                  <span className="opacity-70 mr-auto text-[10px]">
                    {ignoreSlab
                      ? '0.35 جسور · 0.65 أعمدة · 0 بلاطات'
                      : '0.35 جسور · 0.65 أعمدة · 0.25 بلاطات'}
                  </span>
                </div>

                {/* Story filter for analysis */}
                <StorySelector
                  stories={stories} selectedStoryId={selectedStoryId}
                  onSelectStory={id => dispatch({ type: 'SELECT_STORY', storyId: id })}
                  onAddStory={() => dispatch({ type: 'ADD_STORY' })}
                  onRemoveStory={id => dispatch({ type: 'REMOVE_STORY', storyId: id })}
                  onUpdateStory={(id, updates) => dispatch({ type: 'UPDATE_STORY', storyId: id, updates })}
                  onCopyElements={(from, to) => dispatch({ type: 'COPY_STORY_ELEMENTS', fromStoryId: from, toStoryId: to })}
                  compact
                />

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">الأحمال على الجسور (kN/m)</CardTitle>
                    {/* Beam-on-beam diagnostic banner */}
                    {bobConnections.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {bobConnections.map((c, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 rounded px-2 py-0.5 font-mono">
                            <span className="font-bold">{c.primaryBeamId}</span>
                            <span className="opacity-60">←</span>
                            <span>{c.secondaryBeamIds.join('+')}</span>
                            {c.reactionForce > 0 && <span className="text-amber-600 font-bold ml-1">{c.reactionForce.toFixed(1)} kN</span>}
                          </span>
                        ))}
                      </div>
                    ) : detectedConnections.length > 0 ? (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        🔄 تم اكتشاف {detectedConnections.length} اتصال جسر-على-جسر، تشغيل التحليل لحساب الأحمال...
                      </p>
                    ) : removedColumnIds.length === 0 ? (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        ⚠️ لا توجد اتصالات جسر-على-جسر — لاكتشافها يجب حذف عمود عند نقطة تقاطع جسرين متعاكسين
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        ℹ️ {removedColumnIds.length} عمود محذوف — لم يُكتشف أي تقاطع جسرين متعاكسين عنده
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','الجسر','DL','LL','1.4D','1.2D+1.6L','البلاطات','أحمال مركزة من جسور (kN)'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map(story => 
                          (isAllStories || story.id === selectedStoryId) &&
                          beamsWithLoads.filter(b => b.storyId === story.id).map(b => {
                            const pointLoads = bobConnections.filter(c => c.primaryBeamId === b.id);
                            return (
                              <TableRow key={`${story.id}-${b.id}`}>
                                <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                                <TableCell className="font-mono text-xs">{b.id}</TableCell>
                                <TableCell className="font-mono text-xs">{b.deadLoad.toFixed(2)}</TableCell>
                                <TableCell className="font-mono text-xs">{b.liveLoad.toFixed(2)}</TableCell>
                                <TableCell className="font-mono text-xs">{(1.4 * b.deadLoad).toFixed(2)}</TableCell>
                                <TableCell className="font-mono text-xs">{(1.2 * b.deadLoad + 1.6 * b.liveLoad).toFixed(2)}</TableCell>
                                <TableCell className="text-xs">{(b.slabs ?? []).join(', ') || '—'}</TableCell>
                                <TableCell className="text-xs">
                                  {pointLoads.length === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <div className="flex flex-col gap-1">
                                      {pointLoads.map((c, i) => (
                                        <span key={i} className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 font-mono">
                                          <span className="text-amber-600 font-bold">{c.reactionForce.toFixed(1)} kN</span>
                                          <span className="text-muted-foreground">من</span>
                                          <span className="text-blue-600 font-semibold">{c.secondaryBeamIds.join('+')}</span>
                                          <span className="text-muted-foreground">@ {c.distanceOnPrimary.toFixed(2)}م</span>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                {/* زر تصدير عزوم الجسور إلى Excel */}
                {frameResults.length > 0 && (
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => {
                        import('xlsx').then(XLSX => {
                          const data: any[] = [];
                          // Build set of split-part IDs to skip
                          const splitPartIdsXls = new Set<string>();
                          for (const parts of Object.values(splitBeamGroups)) {
                            for (const p of parts) splitPartIdsXls.add(p);
                          }
                          for (const fr of frameResults) {
                            // Collect canonical beams (merge split parts)
                            const seen = new Set<string>();
                            for (const b of fr.beams) {
                              let canonId = b.beamId;
                              if (splitPartIdsXls.has(b.beamId)) {
                                const base = Object.entries(splitBeamGroups).find(([, parts]) => parts.includes(b.beamId))?.[0];
                                if (base) canonId = base;
                              }
                              if (seen.has(canonId)) continue;
                              seen.add(canonId);
                              // Aggregate across all parts
                              const partIds = splitBeamGroups[canonId] || [canonId];
                              const allParts = fr.beams.filter(x => partIds.includes(x.beamId));
                              const aggMleft = allParts.reduce((m, x) => Math.max(m, Math.abs(x.Mleft)), 0);
                              const aggMmid  = allParts.reduce((m, x) => Math.max(m, x.Mmid), 0);
                              const aggMright = allParts.reduce((m, x) => Math.max(m, Math.abs(x.Mright)), 0);
                              const aggVu    = allParts.reduce((m, x) => Math.max(m, x.Vu), 0);
                              const aggSpan  = allParts.reduce((s, x) => s + x.span, 0) || b.span;
                              const repBeam = beamsWithLoads.find(bw => bw.id === canonId) || beamsWithLoads.find(bw => partIds.includes(bw.id));
                              const story = repBeam ? stories.find(s => s.id === repBeam.storyId) : null;
                              data.push({
                                'الإطار': fr.frameId,
                                'الدور': story?.label ?? '',
                                'الجسر': canonId,
                                'البحر (م)': +aggSpan.toFixed(2),
                                'M يسار (kN·m)': +aggMleft.toFixed(2),
                                'M منتصف (kN·m)': +aggMmid.toFixed(2),
                                'M يمين (kN·m)': +aggMright.toFixed(2),
                                'Vu (kN)': +aggVu.toFixed(2),
                              });
                            }
                          }
                          const ws = XLSX.utils.json_to_sheet(data);
                          const wb = XLSX.utils.book_new();
                          XLSX.utils.book_append_sheet(wb, ws, 'عزوم الجسور');
                          XLSX.writeFile(wb, 'beam_moments.xlsx');
                        });
                      }}
                    >
                      <Download size={14} />
                      تصدير العزوم إلى Excel
                    </Button>
                  </div>
                )}
                {frameResults.map(fr => {
                  // Build merged beam list — one row per canonical beam
                  const splitPartIdsTable = new Set<string>();
                  for (const parts of Object.values(splitBeamGroups)) {
                    for (const p of parts) splitPartIdsTable.add(p);
                  }
                  const mergedBeams: Array<{
                    canonId: string; span: number;
                    Mleft: number; Mmid: number; Mright: number; Vu: number;
                    firstPartId: string;
                  }> = [];
                  const seenIds = new Set<string>();
                  for (const b of fr.beams) {
                    let canonId = b.beamId;
                    if (splitPartIdsTable.has(b.beamId)) {
                      const base = Object.entries(splitBeamGroups).find(([, parts]) => parts.includes(b.beamId))?.[0];
                      if (base) canonId = base;
                    }
                    if (seenIds.has(canonId)) continue;
                    seenIds.add(canonId);
                    const partIds = splitBeamGroups[canonId] || [canonId];
                    const allParts = fr.beams.filter(x => partIds.includes(x.beamId));
                    mergedBeams.push({
                      canonId,
                      firstPartId: b.beamId,
                      span: allParts.reduce((s, x) => s + x.span, 0) || b.span,
                      Mleft:  allParts.reduce((m, x) => { const v = Math.abs(x.Mleft);  return v > Math.abs(m) ? -v : m; }, b.Mleft),
                      Mmid:   allParts.reduce((m, x) => Math.abs(x.Mmid) > Math.abs(m) ? x.Mmid : m, b.Mmid),
                      Mright: allParts.reduce((m, x) => { const v = Math.abs(x.Mright); return v > Math.abs(m) ? -v : m; }, b.Mright),
                      Vu:     allParts.reduce((m, x) => Math.max(m, x.Vu), b.Vu),
                    });
                  }
                  return (
                  <Card key={fr.frameId}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">إطار {fr.frameId} <span className="text-muted-foreground text-xs">(اضغط على جسر لعرض الرسومات)</span></CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow>
                          {['الجسر','البحر','M علوي يسار','M سفلي أقصى','M علوي يمين','Vu','📊'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                        </TableRow></TableHeader>
                        <TableBody>
                          {mergedBeams.map(b => {
                            const midMoment = b.Mmid;
                            const bBeam = beamsWithLoads.find(bw => bw.id === b.canonId)
                              || beamsWithLoads.find(bw => (splitBeamGroups[b.canonId] || [b.canonId]).includes(bw.id));
                            let bHingeLeft = false, bHingeRight = false;
                            if (bBeam) {
                              for (const conn of detectedConnections) {
                                if (conn.secondaryBeamIds.includes(b.firstPartId)) {
                                  if (bBeam.fromCol === conn.removedColumnId) bHingeLeft  = true;
                                  if (bBeam.toCol   === conn.removedColumnId) bHingeRight = true;
                                }
                              }
                              const rs = getBeamReleaseState(bBeam);
                              if (rs.nodeI.rz) bHingeLeft  = true;
                              if (rs.nodeJ.rz) bHingeRight = true;
                            }
                            return (
                            <TableRow key={b.canonId} className="cursor-pointer hover:bg-accent/10" onClick={() => handleAnalysisElementClick(b.firstPartId)}>
                              <TableCell className="font-mono text-xs">{b.canonId}</TableCell>
                              <TableCell className="font-mono text-xs">{b.span.toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs" style={{ color: b.Mleft < 0 ? 'hsl(0 84.2% 60.2%)' : 'hsl(142 71% 45%)' }}>
                                {b.Mleft.toFixed(2)}{bHingeLeft ? ' ⭕' : ''}
                              </TableCell>
                              <TableCell className="font-mono text-xs font-bold" style={{ color: midMoment > 0 ? 'hsl(142 71% 45%)' : 'hsl(0 84.2% 60.2%)' }}>{midMoment.toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs" style={{ color: b.Mright < 0 ? 'hsl(0 84.2% 60.2%)' : 'hsl(142 71% 45%)' }}>
                                {b.Mright.toFixed(2)}{bHingeRight ? ' ⭕' : ''}
                              </TableCell>
                              <TableCell className="font-mono text-xs">{b.Vu.toFixed(2)}</TableCell>
                              <TableCell><Badge variant="outline" className="text-[10px] cursor-pointer">رسومات</Badge></TableCell>
                            </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                  );
                })}

                {/* ── الجدول ثنائي المحور نُقل إلى تبويب "الأعمدة ثنائية المحور" ── */}

                {/* Joint Connectivity - Column Above/Below at each joint */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">تفاصيل اتصال الأعمدة بالركائز (العمود العلوي والسفلي)</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الفريم','الركيزة','X','Y','Z','العمود العلوي','b×h علوي','طول علوي','Z علوي','العمود السفلي','b×h سفلي','طول سفلي','Z سفلي','نسبة علوي','نسبة سفلي'].map((h, i) => <TableHead key={`${h}-${i}`} className="text-xs whitespace-nowrap">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {jointConnectivity.map((j, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-xs font-bold">{j.frameId}</TableCell>
                            <TableCell className="font-mono text-xs">{j.jointColId}</TableCell>
                            <TableCell className="font-mono text-xs">{j.jointX.toFixed(2)}</TableCell>
                            <TableCell className="font-mono text-xs">{j.jointY.toFixed(2)}</TableCell>
                            <TableCell className="font-mono text-xs">{j.jointZ.toFixed(0)}</TableCell>
                            <TableCell className="font-mono text-xs text-blue-600 dark:text-blue-400">{j.colAboveId ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.colAboveB && j.colAboveH ? `${j.colAboveB}×${j.colAboveH}` : '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.colAboveL?.toFixed(0) ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.colAboveZBot != null && j.colAboveZTop != null ? `${j.colAboveZBot.toFixed(0)}→${j.colAboveZTop.toFixed(0)}` : '—'}</TableCell>
                            <TableCell className="font-mono text-xs text-orange-600 dark:text-orange-400">{j.colBelowId ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.colBelowB && j.colBelowH ? `${j.colBelowB}×${j.colBelowH}` : '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.colBelowL?.toFixed(0) ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.colBelowZBot != null && j.colBelowZTop != null ? `${j.colBelowZBot.toFixed(0)}→${j.colBelowZTop.toFixed(0)}` : '—'}</TableCell>
                            <TableCell className="font-mono text-xs font-bold">{(j.distributionTop * 100).toFixed(1)}%</TableCell>
                            <TableCell className="font-mono text-xs font-bold">{(j.distributionBot * 100).toFixed(1)}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                {/* ETABS Comparison Table */}
                <ETABSComparisonTable
                  frames={frames}
                  beams={beamsWithLoads}
                  columns={columns}
                  stories={stories}
                  frameResults3D={frameResults3DRaw}
                  frameResults2D={frameResults2D}
                  frameResultsGF={frameResultsGF}
                  frameResultsUC={frameResultsUC}
                  colLoads3D={colLoads3D}
                  colLoads2D={colLoadsBiaxial}
                  etabsBeamData={etabsCompBeamData}
                  onEtabsDataChange={setEtabsCompBeamData}
                />
              </div>
            )}
              </TabsContent>

              <TabsContent value="analysis-compare" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <LoadComparisonPanel
                  slabs={storyFilteredSlabs}
                  beams={beamsWithLoads}
                  columns={columns}
                  slabProps={slabProps}
                  mat={mat}
                  analyzed={analyzed}
                  onRunAnalysis={runAnalysis}
                />
              </TabsContent>
              <TabsContent value="analysis-fem-compare" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <FEMComparisonPanel
                  slabs={storyFilteredSlabs}
                  beams={beamsWithLoads}
                  columns={columns}
                  slabProps={slabProps}
                  mat={mat}
                  analyzed={analyzed}
                  onRunAnalysis={runAnalysis}
                />
              </TabsContent>
              <TabsContent value="analysis-etabs-import" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <ETABSImportPanel
                  frameResults2D={frameResults2D}
                  frameResults3D={frameResults3DRaw}
                  frameResultsFEM={selectedEngine === 'fem_coupled' ? frameResults : undefined}
                  frameResultsGF={frameResultsGF}
                  frameResultsUC={frameResultsUC}
                  beams={beamsWithLoads}
                  analyzed={analyzed}
                  onRunAnalysis={runAnalysis}
                />
              </TabsContent>
              <TabsContent value="analysis-beam-loads" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <BeamLoadDiagrams
                  frameResults={frameResults}
                  beams={beamsWithLoads}
                  engineLabel={ENGINE_LABELS[selectedEngine]}
                  bobConnections={bobConnections}
                  beamHinges={beamHingesMap}
                />
              </TabsContent>
              <TabsContent value="analysis-slab" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <SlabAnalysisPanel slabs={slabs} slabProps={slabProps} mat={mat} />
              </TabsContent>
              <TabsContent value="analysis-slab-load-diag" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <SlabLoadDiagnosticPanel
                  beams={beamsWithLoads}
                  slabs={slabs}
                  columns={columns}
                  slabProps={slabProps}
                  mat={mat}
                  colLoads3D={colLoads3D}
                />
              </TabsContent>

              {/* ══ تبويب نتائج الأعمدة ثنائية المحور ══ */}
              <TabsContent value="analysis-biaxial" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <div className="space-y-4">

                  {/* شريط التحكم */}
                  <Card>
                    <CardContent className="py-3">
                      <div className="flex flex-wrap items-center gap-3">

                        {/* فلتر الدور */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-muted-foreground">الدور:</span>
                          <select
                            className="h-8 rounded border border-border bg-background text-xs px-2 focus:outline-none"
                            value={biaxialStoryFilter}
                            onChange={e => setBiaxialStoryFilter(e.target.value)}
                          >
                            <option value="">جميع الأدوار</option>
                            {stories.map(s => (
                              <option key={s.id} value={s.id}>{s.label}</option>
                            ))}
                          </select>
                        </div>

                        <span className="text-xs text-muted-foreground border-r border-border pr-3">
                          {biaxialSelectedCols.size} عمود محدد
                        </span>

                        {/* تحديد الكل الذي يحتاج تدوير */}
                        <button
                          className="text-xs px-2 py-1 rounded border border-border hover:bg-accent/30 transition-colors"
                          onClick={() => {
                            const needRotation = new Set<string>();
                            for (const story of stories) {
                              if (biaxialStoryFilter && story.id !== biaxialStoryFilter) continue;
                              for (const c of colDesigns.filter(cd => cd.storyId === story.id)) {
                                const loads = colLoads3D.get(c.id);
                                const maxMx = Math.max(Math.abs(loads?.MxTop || 0), Math.abs(loads?.MxBot || 0));
                                const maxMy = Math.max(Math.abs(loads?.MyTop || 0), Math.abs(loads?.MyBot || 0));
                                if (maxMy > maxMx && c.b !== c.h) needRotation.add(c.id);
                              }
                            }
                            setBiaxialSelectedCols(needRotation);
                          }}
                        >
                          ✓ تحديد كل التي تحتاج تدوير
                        </button>

                        {/* إلغاء التحديد */}
                        <button
                          className="text-xs px-2 py-1 rounded border border-border hover:bg-accent/30 transition-colors"
                          onClick={() => setBiaxialSelectedCols(new Set())}
                        >
                          ✕ إلغاء التحديد
                        </button>

                        {/* زر تصدير نتائج الأعمدة إلى Excel */}
                        <button
                          className="text-xs px-2 py-1 rounded border border-border hover:bg-accent/30 transition-colors flex items-center gap-1"
                          onClick={() => {
                            import('xlsx').then(XLSX => {
                              const data: any[] = [];
                              for (const story of stories) {
                                if (biaxialStoryFilter && story.id !== biaxialStoryFilter) continue;
                                for (const c of colDesigns.filter(cd => cd.storyId === story.id)) {
                                  const loads = colLoads3D.get(c.id);
                                  const Pu = loads?.Pu ?? 0;
                                  const MxTop = loads?.MxTop ?? 0;
                                  const MxBot = loads?.MxBot ?? 0;
                                  const MyTop = loads?.MyTop ?? 0;
                                  const MyBot = loads?.MyBot ?? 0;
                                  const maxMx = Math.max(Math.abs(MxTop), Math.abs(MxBot));
                                  const maxMy = Math.max(Math.abs(MyTop), Math.abs(MyBot));
                                  data.push({
                                    'الدور': story.label,
                                    'العمود': c.id,
                                    'b (مم)': c.b,
                                    'h (مم)': c.h,
                                    'Pu (kN)': +Pu.toFixed(1),
                                    'Mx أعلى (kN·m)': +MxTop.toFixed(2),
                                    'Mx أسفل (kN·m)': +MxBot.toFixed(2),
                                    'My أعلى (kN·m)': +MyTop.toFixed(2),
                                    'My أسفل (kN·m)': +MyBot.toFixed(2),
                                    'Mx أقصى (kN·m)': +maxMx.toFixed(2),
                                    'My أقصى (kN·m)': +maxMy.toFixed(2),
                                    'نحافة X': c.design.slendernessStatusX,
                                    'نحافة Y': c.design.slendernessStatusY,
                                    'الارتفاع (مم)': story.height,
                                    'الحالة': c.design.biaxialAdequate ? 'آمن' : 'غير آمن',
                                  });
                                }
                              }
                              const ws = XLSX.utils.json_to_sheet(data);
                              const wb = XLSX.utils.book_new();
                              XLSX.utils.book_append_sheet(wb, ws, 'نتائج الأعمدة');
                              XLSX.writeFile(wb, 'column_biaxial_results.xlsx');
                            });
                          }}
                        >
                          <Download size={12} />
                          تصدير إلى Excel
                        </button>

                        {/* زر التدوير الجماعي */}
                        {biaxialSelectedCols.size > 0 && (
                          <button
                            className="text-xs px-3 py-1.5 rounded bg-orange-500 hover:bg-orange-600 text-white font-bold flex items-center gap-1.5 transition-colors shadow"
                            onClick={() => {
                              const justRotated = new Set<string>();
                              for (const colId of biaxialSelectedCols) {
                                const col = columns.find(c => c.id === colId);
                                if (col && col.b !== col.h) {
                                  dispatch({ type: 'SET_COL_OVERRIDE', colId, override: { b: col.h, h: col.b } });
                                  justRotated.add(colId);
                                }
                              }
                              if (justRotated.size > 0) {
                                setRotatedColIds(prev => new Set([...prev, ...justRotated]));
                              }
                              setBiaxialSelectedCols(new Set());
                            }}
                          >
                            <RotateCcw size={12} />
                            تدوير الأعمدة المحددة ({biaxialSelectedCols.size})
                          </button>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* الجدول */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">
                        نتائج تحليل الأعمدة (ثنائي المحور) —{' '}
                        {biaxialStoryFilter
                          ? (stories.find(s => s.id === biaxialStoryFilter)?.label ?? biaxialStoryFilter)
                          : 'جميع الأدوار'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs w-8 text-center">☑</TableHead>
                            {['الدور','العمود','b×h','Pu (kN)','Mx أعلى','Mx أسفل','My أعلى','My أسفل','نحافة X','نحافة Y','الارتفاع','حالة'].map(h => (
                              <TableHead key={h} className="text-xs">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {stories.map(story => {
                            if (biaxialStoryFilter && story.id !== biaxialStoryFilter) return null;
                            return colDesigns.filter(c => c.storyId === story.id).map(c => {
                              const loads = colLoads3D.get(c.id);
                              const Pu = loads?.Pu ?? 0;
                              const maxMx = Math.max(Math.abs(loads?.MxTop || 0), Math.abs(loads?.MxBot || 0));
                              const maxMy = Math.max(Math.abs(loads?.MyTop || 0), Math.abs(loads?.MyBot || 0));
                              const needsRotation = maxMy > maxMx && c.b !== c.h;
                              const isSelected = biaxialSelectedCols.has(c.id);
                              const wasRotated = rotatedColIds.has(c.id);
                              return (
                                <TableRow
                                  key={`biaxial-${story.id}-${c.id}`}
                                  className={`cursor-pointer hover:bg-accent/10 ${wasRotated ? 'bg-green-50/40 dark:bg-green-900/10' : needsRotation ? 'bg-orange-50/40 dark:bg-orange-900/10' : ''} ${isSelected ? 'outline outline-2 outline-orange-400/60' : ''}`}
                                  onClick={() => {
                                    dispatch({
                                      type: 'OPEN_DIAGRAM',
                                      data: {
                                        elementId: c.id,
                                        elementType: 'column' as const,
                                        span: (story.height || 3000) / 1000,
                                        colLength: story.height || 3000,
                                        MxTop: loads?.MxTop || 0,
                                        MxBot: loads?.MxBot || 0,
                                        MyTop: loads?.MyTop || 0,
                                        MyBot: loads?.MyBot || 0,
                                        Pu,
                                      },
                                    });
                                  }}
                                >
                                  {/* خانة الاختيار */}
                                  <TableCell
                                    className="text-center"
                                    onClick={e => {
                                      e.stopPropagation();
                                      if (!needsRotation) return;
                                      setBiaxialSelectedCols(prev => {
                                        const next = new Set(prev);
                                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                                        return next;
                                      });
                                    }}
                                  >
                                    {needsRotation && (
                                      <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={checked => {
                                          setBiaxialSelectedCols(prev => {
                                            const next = new Set(prev);
                                            if (checked) next.add(c.id); else next.delete(c.id);
                                            return next;
                                          });
                                        }}
                                        onClick={e => e.stopPropagation()}
                                      />
                                    )}
                                  </TableCell>
                                  <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                                  <TableCell className="font-mono text-xs">{c.id}</TableCell>
                                  <TableCell className={`font-mono text-xs font-bold ${wasRotated ? 'text-green-600 dark:text-green-400' : ''}`}>{c.b}×{c.h}{wasRotated ? ' ✓' : ''}</TableCell>
                                  <TableCell className="font-mono text-xs font-bold">{Pu.toFixed(1)}</TableCell>
                                  <TableCell className="font-mono text-xs">{(loads?.MxTop || 0).toFixed(2)}</TableCell>
                                  <TableCell className="font-mono text-xs">{(loads?.MxBot || 0).toFixed(2)}</TableCell>
                                  <TableCell className={`font-mono text-xs ${needsRotation ? 'text-orange-600 dark:text-orange-400 font-bold' : ''}`}>{(loads?.MyTop || 0).toFixed(2)}</TableCell>
                                  <TableCell className={`font-mono text-xs ${needsRotation ? 'text-orange-600 dark:text-orange-400 font-bold' : ''}`}>{(loads?.MyBot || 0).toFixed(2)}</TableCell>
                                  <TableCell className="font-mono text-xs">{c.design.slendernessStatusX}</TableCell>
                                  <TableCell className="font-mono text-xs">{c.design.slendernessStatusY}</TableCell>
                                  <TableCell className="font-mono text-xs">{story.height}</TableCell>
                                  <TableCell>
                                    {wasRotated ? (
                                      <Badge variant="outline" className="text-[10px] border-green-500 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 font-bold">
                                        ✓ تم التدوير
                                      </Badge>
                                    ) : needsRotation ? (
                                      <Badge variant="outline" className="text-[10px] border-orange-400 text-orange-600 dark:text-orange-400 bg-orange-50/60 dark:bg-orange-900/20">
                                        My&gt;Mx — تدوير
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-[10px] border-green-400 text-green-600 dark:text-green-400 bg-green-50/60 dark:bg-green-900/20">
                                        ✓ مقبول
                                      </Badge>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            });
                          })}
                        </TableBody>
                      </Table>
                      <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                        ⓘ Pu مُستخرج مباشرةً من التحليل ثلاثي الأبعاد لكل عمود — يشمل تلقائياً تراكم الأحمال من جميع الأدوار العلوية دون ضرب يدوي.
                        الأعمدة المظللة باللون البرتقالي: My &gt; Mx مع مقطع غير مربع — تدوير المقطع 90° يُحسّن الكفاءة الإنشائية.
                        بعد التدوير الجماعي يُعاد التحليل تلقائياً عند الضغط على "تشغيل التحليل".
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

            </Tabs>
          </TabsContent>

          {/* DESIGN TAB */}
          <TabsContent value="design" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
            <div className="space-y-4">
              {/* ── Source Selector Card ── */}
              <Card className="border-blue-200 dark:border-blue-800 bg-blue-500/5">
                <CardContent className="py-3 px-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Zap size={14} className="text-blue-500 shrink-0" />
                    <span className="text-xs font-bold">مصدر نتائج التحليل للتصميم</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`px-3 py-2 rounded border text-xs font-medium transition-all ${designSource === 'app' ? 'bg-blue-600 text-white border-blue-600' : 'border-border hover:bg-muted'}`}
                      onClick={() => { setDesignSource('app'); setDesignExecuted(false); }}
                    >
                      محركات التطبيق الداخلية
                    </button>
                    <button
                      className={`px-3 py-2 rounded border text-xs font-medium transition-all ${designSource === 'etabs' ? 'bg-orange-600 text-white border-orange-600' : 'border-border hover:bg-muted'}`}
                      onClick={() => { setDesignSource('etabs'); setDesignExecuted(false); }}
                    >
                      نتائج ETABS (xlsx)
                    </button>
                  </div>

                  {/* App engine selector */}
                  {designSource === 'app' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">محرك التحليل:</span>
                      <select
                        className="h-8 rounded border border-input bg-background px-2 text-xs flex-1 min-w-[160px] max-w-[260px]"
                        value={selectedEngine}
                        onChange={e => { dispatch({ type: 'SET_ENGINE', engine: e.target.value as any }); setDesignExecuted(false); }}
                      >
                        {(Object.entries(ENGINE_LABELS) as [string, string][]).map(([key, label]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                      {!analyzed && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-400">يلزم تشغيل التحليل أولاً</Badge>}
                    </div>
                  )}

                  {/* ETABS import */}
                  {designSource === 'etabs' && (
                    <ETABSAnalysisImport
                      appliedBeamCount={etabsAnalysisData.length}
                      appliedColCount={etabsColumnResults.length}
                      appliedReactionCount={etabsReactions.length}
                      onApplyBeams={(results) => {
                        dispatch({ type: 'SET_ETABS_ANALYSIS_DATA', data: results });
                        setDesignExecuted(false);
                      }}
                      onApplyColumns={(cols) => setEtabsColumnResults(cols)}
                      onApplyReactions={(reacts) => setEtabsReactions(reacts)}
                    />
                  )}

                  {/* Design button */}
                  <Button
                    className="w-full min-h-[48px] gap-2 text-sm font-bold"
                    disabled={
                      (designSource === 'app' && !analyzed) ||
                      (designSource === 'etabs' && etabsAnalysisData.length === 0)
                    }
                    onClick={() => setDesignExecuted(true)}
                  >
                    <Calculator size={16} />
                    تشغيل التصميم
                    {designExecuted && beamDesigns.length > 0 && (
                      <Badge variant="secondary" className="text-[10px]">{beamDesigns.length} جسر</Badge>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* ── Design Sub-Tabs ── */}
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                <button
                  className={`flex-1 text-xs font-medium py-2 px-3 rounded-md transition-all ${
                    designSubTab === 'beams_cols'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setDesignSubTab('beams_cols')}
                >
                  تصميم الجسور والأعمدة
                </button>
                <button
                  className={`flex-1 text-xs font-medium py-2 px-3 rounded-md transition-all ${
                    designSubTab === 'foundations'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setDesignSubTab('foundations')}
                >
                  تصميم الأساسات (WSM)
                </button>
                <button
                  className={`flex-1 text-xs font-medium py-2 px-3 rounded-md transition-all ${
                    designSubTab === 'comparison'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setDesignSubTab('comparison')}
                >
                  مقارنة النتائج
                </button>
              </div>

              {/* ── Comparison Sub-Tab ── */}
              {designSubTab === 'comparison' && (
                <DesignComparisonPanel
                  beams={beamsWithLoads}
                  slabs={slabs}
                  slabProps={slabProps}
                  mat={mat}
                  stories={stories}
                  frameResults={frameResults}
                  etabsAnalysisData={etabsAnalysisData}
                  analyzed={analyzed}
                  columns={columns}
                  colDesigns={colDesigns}
                  etabsColumnResults={etabsColumnResults}
                  splitBeamGroups={splitBeamGroups}
                />
              )}

              {/* ── Foundation Design Sub-Tab ── */}
              {designSubTab === 'foundations' && (
                <FoundationDesignPanel
                  columns={columns}
                  colDesigns={colDesigns}
                  colLoads3D={colLoads3D}
                  etabsReactions={etabsReactions.length > 0 ? etabsReactions : undefined}
                  titleBlockConfig={titleBlockConfig}
                  mat={mat}
                  onResultsChange={(res, mat) => {
                    setFoundationResults(res);
                    setFoundationMat(mat);
                  }}
                />
              )}

              {/* ── Beams & Columns Design Sub-Tab ── */}
              {designSubTab === 'beams_cols' && (
              <>
              {/* ── Results (only after designExecuted) ── */}
              {!designExecuted ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground text-sm">
                    {designSource === 'etabs' && etabsAnalysisData.length === 0
                      ? 'استورد ملف نتائج ETABS ثم اضغط "تشغيل التصميم"'
                      : designSource === 'app' && !analyzed
                      ? 'شغّل التحليل من تبويب التحليل ثم اضغط "تشغيل التصميم"'
                      : 'اضغط "تشغيل التصميم" لعرض نتائج التصميم'
                    }
                  </CardContent>
                </Card>
              ) : (
              <div className="space-y-4">
                {/* Story filter for design */}
                <StorySelector
                  stories={stories} selectedStoryId={selectedStoryId}
                  onSelectStory={id => dispatch({ type: 'SELECT_STORY', storyId: id })}
                  onAddStory={() => dispatch({ type: 'ADD_STORY' })}
                  onRemoveStory={id => dispatch({ type: 'REMOVE_STORY', storyId: id })}
                  onUpdateStory={(id, updates) => dispatch({ type: 'UPDATE_STORY', storyId: id, updates })}
                  onCopyElements={(from, to) => dispatch({ type: 'COPY_STORY_ELEMENTS', fromStoryId: from, toStoryId: to })}
                  compact
                />
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">تصميم الجسور - الانحناء والتشوه والتشخيص</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','الجسر','علوي يسار','سفلي أقصى','علوي يمين','δ (mm)','L/δ','L كلي (م)','الحالة','التشخيص'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map(story => 
                          (isAllStories || story.id === selectedStoryId) &&
                          beamDesigns.filter(d => {
                            let beam = beamsWithLoads.find(b => b.id === d.beamId);
                            if (!beam && (d as any).mergedCarrierIds) {
                              beam = beamsWithLoads.find(b => (d as any).mergedCarrierIds.includes(b.id));
                            }
                            return beam?.storyId === story.id;
                          }).map(d => {
                          const bent = getBentUpData(d.beamId);
                          const topLeftBars = bent ? Math.max(bent.additionalTopLeft, 2) : d.flexLeft.bars;
                          const topRightBars = bent ? Math.max(bent.additionalTopRight, 2) : d.flexRight.bars;
                          const diag = beamDiagnostics.get(d.beamId);
                          return (
                          <React.Fragment key={`${story.id}-${d.beamId}`}>
                          <TableRow className="cursor-pointer" onClick={() => handleSelectElement('beam', d.beamId)}>
                            <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                            <TableCell className="font-mono text-xs">{d.beamId}</TableCell>
                            <TableCell className="font-mono text-xs">{topLeftBars}Φ{d.flexLeft.dia}</TableCell>
                            <TableCell className="font-mono text-xs">{d.flexMid.bars}Φ{d.flexMid.dia}</TableCell>
                            <TableCell className="font-mono text-xs">{topRightBars}Φ{d.flexRight.dia}</TableCell>
                            <TableCell className="font-mono text-xs">{d.deflection.deflection.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-xs">{d.deflection.deflectionRatio.toFixed(0)}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {(() => {
                                // Show total girder length if this is a carrier beam segment
                                const carrierConn2 = bobConnections.find(c => c.primaryBeamId === d.beamId);
                                const contConn2 = bobConnections.find(c => c.continuationBeamId === d.beamId);
                                if (carrierConn2 && carrierConn2.continuationBeamId) {
                                  const contB = beamsWithLoads.find(b => b.id === carrierConn2.continuationBeamId);
                                  if (contB) return <span className="text-accent font-bold">{(d.span + contB.length / 1000).toFixed(2)}</span>;
                                }
                                if (contConn2) {
                                  const primB = beamsWithLoads.find(b => b.id === contConn2.primaryBeamId);
                                  if (primB) return <span className="text-accent font-bold">{(primB.length / 1000 + d.span).toFixed(2)}</span>;
                                }
                                return <span className="text-muted-foreground">—</span>;
                              })()}
                            </TableCell>
                            <TableCell>
                              <Badge variant={diag?.isAdequate ? "default" : "destructive"} className="text-[10px]">
                                {diag?.isAdequate ? 'آمن ✓' : 'تجاوز ✗'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs max-w-[200px]">
                              {diag && !diag.isAdequate && (
                                <span className="text-destructive font-medium">{diag.overallStatus}</span>
                              )}
                            </TableCell>
                          </TableRow>
                          {diag && !diag.isAdequate && diag.failures.map((f, idx) => (
                            <TableRow key={`${d.beamId}-fail-${idx}`} className="bg-destructive/5 border-0">
                              <TableCell colSpan={9} className="py-1 px-4">
                                <div className="flex flex-col gap-0.5 text-[11px]">
                                  <div className="flex items-start gap-2">
                                    <Badge variant="outline" className="text-[9px] shrink-0 border-destructive text-destructive">
                                      {f.aciRef}
                                    </Badge>
                                    <span className="text-destructive">{f.description} (تجاوز {f.exceedPercent.toFixed(0)}%)</span>
                                  </div>
                                  <div className="text-muted-foreground mr-2">
                                    💡 <strong>الحل:</strong> {f.solution}
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                          </React.Fragment>
                          );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* ── As (mm²) Table ── */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">مساحة حديد التسليح المطلوبة As (mm²) - الجسور</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','الجسر','b×h','As يسار (mm²)','As وسط (mm²)','As يمين (mm²)','As_min (mm²)','ρ% يسار','ρ% وسط','ρ% يمين'].map(h => <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map(story =>
                          (isAllStories || story.id === selectedStoryId) &&
                          beamDesigns.filter(d => {
                            let beam = beamsWithLoads.find(b => b.id === d.beamId);
                            if (!beam && (d as any).mergedCarrierIds) {
                              beam = beamsWithLoads.find(b => (d as any).mergedCarrierIds.includes(b.id));
                            }
                            return beam?.storyId === story.id;
                          }).map(d => {
                            let beam = beamsWithLoads.find(b => b.id === d.beamId);
                            if (!beam && (d as any).mergedCarrierIds) {
                              beam = beamsWithLoads.find(b => (d as any).mergedCarrierIds.includes(b.id));
                            }
                            const bw = beam?.b ?? 250;
                            const hh = beam?.h ?? 500;
                            const dEff = hh - 40 - 12;  // approx effective depth
                            const As_min = Math.max(0.25 * Math.sqrt(mat.fc) / mat.fy * bw * dEff, 1.4 / mat.fy * bw * dEff);
                            const AsL = d.flexLeft.As ?? (d.flexLeft.bars * Math.PI * d.flexLeft.dia ** 2 / 4);
                            const AsMid = d.flexMid.As ?? (d.flexMid.bars * Math.PI * d.flexMid.dia ** 2 / 4);
                            const AsR = d.flexRight.As ?? (d.flexRight.bars * Math.PI * d.flexRight.dia ** 2 / 4);
                            const rhoL = (AsL / (bw * dEff) * 100);
                            const rhoMid = (AsMid / (bw * dEff) * 100);
                            const rhoR = (AsR / (bw * dEff) * 100);
                            return (
                              <TableRow key={`as-${story.id}-${d.beamId}`} className="cursor-pointer" onClick={() => handleSelectElement('beam', d.beamId)}>
                                <TableCell className="text-xs text-muted-foreground">{story.label}</TableCell>
                                <TableCell className="font-mono text-xs font-bold">{d.beamId}</TableCell>
                                <TableCell className="font-mono text-xs">{bw}×{hh}</TableCell>
                                <TableCell className="font-mono text-xs font-bold text-blue-700">{AsL.toFixed(0)}</TableCell>
                                <TableCell className="font-mono text-xs font-bold text-green-700">{AsMid.toFixed(0)}</TableCell>
                                <TableCell className="font-mono text-xs font-bold text-blue-700">{AsR.toFixed(0)}</TableCell>
                                <TableCell className="font-mono text-xs text-amber-600">{As_min.toFixed(0)}</TableCell>
                                <TableCell className={`font-mono text-xs ${rhoL > 2.5 ? 'text-destructive font-bold' : ''}`}>{rhoL.toFixed(2)}%</TableCell>
                                <TableCell className={`font-mono text-xs ${rhoMid > 2.5 ? 'text-destructive font-bold' : ''}`}>{rhoMid.toFixed(2)}%</TableCell>
                                <TableCell className={`font-mono text-xs ${rhoR > 2.5 ? 'text-destructive font-bold' : ''}`}>{rhoR.toFixed(2)}%</TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">تصميم القص</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','الجسر','Vu','Vc','Vs','الكانات'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map(story =>
                          (isAllStories || story.id === selectedStoryId) &&
                          beamDesigns.filter(d => {
                            let beam = beamsWithLoads.find(b => b.id === d.beamId);
                            if (!beam && (d as any).mergedCarrierIds) {
                              beam = beamsWithLoads.find(b => (d as any).mergedCarrierIds.includes(b.id));
                            }
                            return beam?.storyId === story.id;
                          }).map(d => (
                            <TableRow key={`${story.id}-${d.beamId}`}>
                              <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                              <TableCell className="font-mono text-xs">{d.beamId}</TableCell>
                              <TableCell className="font-mono text-xs">{d.Vu.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{d.shear.Vc.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{d.shear.Vs.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{d.shear.stirrups}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm">تصميم الأعمدة (Bresler - ثنائي المحور)</CardTitle>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] px-2 gap-1 shrink-0"
                        onClick={() => setConnectionManagerOpen(true)}
                        title="ربط الجسور بالأعمدة يدوياً عندما لا تتطابق الإحداثيات"
                      >
                        🔗 اتصالات يدوية
                        {manualJointOverrides.length > 0 && (
                          <Badge variant="secondary" className="text-[9px] h-4 px-1 mr-0.5 bg-blue-100 text-blue-700">
                            {manualJointOverrides.length}
                          </Badge>
                        )}
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      <span className="font-semibold text-foreground">Mx / My</span> = عزوم التحليل من النموذج ثلاثي الأبعاد (kN·m) ·
                      <span className="font-semibold text-foreground"> Mx* / My*</span> = عزوم التصميم المضخّمة (kN·m، تشمل δns للأعمدة النحيفة وفق ACI 318-19 §6.6.4.5)
                    </p>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','العمود','Pu (kN)','Mx (kN·m)','My (kN·m)','Mx* (kN·m)','My* (kN·m)','Bresler','النحافة','الحالة','التسليح'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map((story) =>
                          (isAllStories || story.id === selectedStoryId) &&
                          colDesigns.filter(c => c.storyId === story.id).map(c => {
                            return (
                          <TableRow key={`${story.id}-${c.id}`} className="cursor-pointer" onClick={() => handleSelectElement('column', c.id)}>
                            <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                            <TableCell className="font-mono text-xs">{c.id}</TableCell>
                            <TableCell className="font-mono text-xs font-bold">{c.Pu.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-xs text-blue-600 dark:text-blue-400">{c.Mx.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-xs text-blue-600 dark:text-blue-400">{c.My.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-xs font-semibold">{c.design.MxMagnified.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-xs font-semibold">{c.design.MyMagnified.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-xs">{c.design.breslerRatio.toFixed(2)}</TableCell>
                            <TableCell className="text-xs">
                              {c.design.checkSlenderness}
                              {c.design.isSlenderX && (
                                <span className="block text-destructive text-[10px] mt-0.5">
                                  X: نحيف (kLu/r={c.design.kLu_rx.toFixed(1)}) → B المطلوب ≥ {c.design.requiredBForNonSlender}mm {c.b >= c.design.requiredBForNonSlender ? '✓' : `(الحالي ${c.b}mm)`}
                                </span>
                              )}
                              {c.design.isSlenderY && (
                                <span className="block text-destructive text-[10px] mt-0.5">
                                  Y: نحيف (kLu/r={c.design.kLu_ry.toFixed(1)}) → H المطلوب ≥ {c.design.requiredHForNonSlender}mm {c.h >= c.design.requiredHForNonSlender ? '✓' : `(الحالي ${c.h}mm)`}
                                </span>
                              )}
                              {c.design.suggestRotation && (
                                <span className="block text-accent text-[10px] mt-0.5 font-semibold">
                                  💡 {c.design.rotationReason}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={c.design.biaxialAdequate ? "default" : "destructive"} className="text-[10px]">
                                {c.design.biaxialAdequate ? 'آمن' : 'غير آمن'}
                              </Badge>
                              {!c.design.biaxialAdequate && c.design.requiredBForSafety && (
                                <div className="text-[9px] text-destructive mt-0.5 font-bold leading-tight">
                                  ⇒ {c.design.requiredBForSafety}×{c.design.requiredHForSafety}mm
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{c.design.bars}Φ{c.design.dia}</TableCell>
                          </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Bent-Up Bars Table */}
                {bentUpResults.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">تكسيح الحديد (Bent-up Bars) - ACI 318-19</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    {bentUpResults.map(fr => (
                      <div key={fr.frameId} className="mb-4">
                        <p className="text-xs font-semibold mb-1 text-primary">{fr.frameId}</p>
                        <Table>
                          <TableHeader><TableRow>
                            {['الجسر','سفلي أصلي','مكسح','سفلي متبقي','علوي مطلوب L','علوي مطلوب R','مساهمة تكسيح L','مساهمة تكسيح R','علوي إضافي','علوي نهائي'].map(h => <TableHead key={h} className="text-[10px]">{h}</TableHead>)}
                          </TableRow></TableHeader>
                          <TableBody>
                            {fr.beams.map(b => (
                              <TableRow key={b.beamId}>
                                <TableCell className="font-mono text-xs">{b.beamId}</TableCell>
                                <TableCell className="font-mono text-xs">{b.originalBottomBars}Φ{b.bottomDia}</TableCell>
                                <TableCell className="font-mono text-xs">{b.bentUp.bentBarsCount}Φ{b.bentUp.bentDia}</TableCell>
                                <TableCell className="font-mono text-xs">{b.bentUp.remainingBottomBars}Φ{b.bottomDia}</TableCell>
                                <TableCell className="font-mono text-xs">{b.requiredTopLeft}</TableCell>
                                <TableCell className="font-mono text-xs">{b.requiredTopRight}</TableCell>
                                <TableCell className="font-mono text-xs">{b.bentContributionLeft}</TableCell>
                                <TableCell className="font-mono text-xs">{b.bentContributionRight}</TableCell>
                                <TableCell className="font-mono text-xs">{Math.max(b.additionalTopLeft, b.additionalTopRight)}</TableCell>
                                <TableCell className="font-mono text-xs font-bold">{b.finalTopBars}Φ{b.topDia}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                )}

                {/* Slab Punching Shear */}
                {slabDesigns.some(s => s.design.punchingShear) && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">فحص الثقب (Punching Shear)</CardTitle></CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow>
                          {['البلاطة','Vu','Vc','معامل الأمان','الحالة'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                        </TableRow></TableHeader>
                        <TableBody>
                          {slabDesigns.filter(s => s.design.punchingShear).map(s => (
                            <TableRow key={s.id}>
                              <TableCell className="font-mono text-xs">{s.id}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.punchingShear!.Vu.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.punchingShear!.Vc.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.punchingShear!.punchingSafetyFactor.toFixed(2)}</TableCell>
                              <TableCell>
                                <Badge variant={s.design.punchingShear!.adequate ? "default" : "destructive"} className="text-[10px]">
                                  {s.design.punchingShear!.adequate ? 'آمن' : 'غير آمن'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </div>
              )}
              </>
              )}
            </div>
          </TabsContent>

          {/* RESULTS TAB */}
          <TabsContent value="results" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
            {!analyzed ? (
              <Card><CardContent className="py-12 text-center">
                <p className="text-muted-foreground">يرجى تشغيل التحليل أولاً</p>
              </CardContent></Card>
            ) : (
              <div className="space-y-4">
                {/* Story filter for results */}
                <StorySelector
                  stories={stories} selectedStoryId={selectedStoryId}
                  onSelectStory={id => dispatch({ type: 'SELECT_STORY', storyId: id })}
                  onAddStory={() => dispatch({ type: 'ADD_STORY' })}
                  onRemoveStory={id => dispatch({ type: 'REMOVE_STORY', storyId: id })}
                  onUpdateStory={(id, updates) => dispatch({ type: 'UPDATE_STORY', storyId: id, updates })}
                  onCopyElements={(from, to) => dispatch({ type: 'COPY_STORY_ELEMENTS', fromStoryId: from, toStoryId: to })}
                  compact
                />

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">نتائج البلاطات</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','البلاطة','Lx','Ly','h','Wu','تسليح قصير','تسليح طويل'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map(story =>
                          (isAllStories || story.id === selectedStoryId) &&
                          slabDesigns.map(s => (
                            <TableRow key={`${story.id}-${s.id}`} className="cursor-pointer" onClick={() => handleSelectElement('slab', s.id)}>
                              <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                              <TableCell className="font-mono text-xs">{s.id}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.lx.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.ly.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.hUsed}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.Wu.toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.shortDir.bars}Φ{s.design.shortDir.dia}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.longDir.bars}Φ{s.design.longDir.dia}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">ملخص تسليح الجسور</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','الجسر','b×h','علوي يسار','سفلي وسط','علوي يمين','الكانات'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map(story =>
                          (isAllStories || story.id === selectedStoryId) &&
                          beamDesigns.map(d => {
                            const beam = beamsWithLoads.find(b => b.id === d.beamId);
                            const bent = getBentUpData(d.beamId);
                            const topLeftBars = bent ? Math.max(bent.additionalTopLeft, 2) : d.flexLeft.bars;
                            const topRightBars = bent ? Math.max(bent.additionalTopRight, 2) : d.flexRight.bars;
                            return (
                              <TableRow key={`${story.id}-${d.beamId}`} className="cursor-pointer" onClick={() => handleSelectElement('beam', d.beamId)}>
                                <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                                <TableCell className="font-mono text-xs">{d.beamId}</TableCell>
                                <TableCell className="font-mono text-xs">{beam?.b}×{beam?.h}</TableCell>
                                <TableCell className="font-mono text-xs">{topLeftBars}Φ{d.flexLeft.dia}</TableCell>
                                <TableCell className="font-mono text-xs">{d.flexMid.bars}Φ{d.flexMid.dia}</TableCell>
                                <TableCell className="font-mono text-xs">{topRightBars}Φ{d.flexRight.dia}</TableCell>
                                <TableCell className="font-mono text-xs">{d.shear.stirrups}</TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">ملخص تسليح الأعمدة</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','العمود','b×h','Pu','Mu','ρ%','الحالة','التسليح','الكانات'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map((story, storyIdx) =>
                          (isAllStories || story.id === selectedStoryId) &&
                          colDesigns.map(c => {
                            const storiesAbove = stories.length - storyIdx;
                            const accPu = c.Pu * storiesAbove;
                            return (
                              <TableRow key={`${story.id}-${c.id}`} className="cursor-pointer" onClick={() => handleSelectElement('column', c.id)}>
                                <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                                <TableCell className="font-mono text-xs">{c.id}</TableCell>
                                <TableCell className="font-mono text-xs">{c.b}×{c.h}</TableCell>
                                <TableCell className="font-mono text-xs font-bold">{accPu.toFixed(1)}</TableCell>
                                <TableCell className="font-mono text-xs">{c.design.MuMagnified.toFixed(1)}</TableCell>
                                <TableCell className="font-mono text-xs">{(c.design.rhoActual * 100).toFixed(1)}</TableCell>
                                <TableCell>
                                  <Badge variant={c.design.adequate ? "default" : "destructive"} className="text-[10px]">
                                    {c.design.adequate ? 'كافي' : 'غير كافي'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs">{c.design.bars}Φ{c.design.dia}</TableCell>
                                <TableCell className="font-mono text-xs">{c.design.stirrups}</TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* EXPORT TAB */}
          <TabsContent value="export" className="flex-1 overflow-auto p-4">
            <div className="max-w-5xl space-y-6">

              {/* ── Title Block Editor ── */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Settings2 size={14} />
                    بيانات الغلاف (Title Block)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {([
                      { key: 'projectName',     label: 'اسم المشروع' },
                      { key: 'clientName',      label: 'المالك / العميل' },
                      { key: 'projectLocation', label: 'موقع المشروع' },
                      { key: 'drawingTitle',    label: 'عنوان المخطط' },
                      { key: 'firmName',        label: 'اسم المكتب الهندسي' },
                      { key: 'designedBy',      label: 'صمّمه' },
                      { key: 'checkedBy',       label: 'راجعه' },
                      { key: 'drawnBy',         label: 'رسمه' },
                      { key: 'approvedBy',      label: 'اعتمده' },
                      { key: 'revision',        label: 'المراجعة' },
                      { key: 'date',            label: 'التاريخ' },
                      { key: 'scale',           label: 'المقياس' },
                      { key: 'drawingNumber',   label: 'رقم المخطط' },
                    ] as { key: keyof typeof titleBlockConfig; label: string }[]).map(({ key, label }) => (
                      <div key={key} className="space-y-1">
                        <label className="text-xs text-muted-foreground">{label}</label>
                        <input
                          className="w-full h-9 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          value={titleBlockConfig[key] as string}
                          onChange={e => dispatch({ type: 'SET_TITLE_BLOCK_CONFIG', config: { [key]: e.target.value } })}
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* BOQ - Bill of Quantities */}
              <BOQPanel
                stories={stories}
                slabs={slabs}
                beams={beamsWithLoads}
                columns={columns}
                beamDesigns={beamDesigns as any}
                colDesigns={colDesigns}
                slabDesigns={slabs.map(s => ({ ...s, design: designSlab(s, slabProps, mat, slabs, columns) })) as any}
                slabProps={slabProps}
                analyzed={hasDesignResults}
                foundationResults={foundationResults.length > 0 ? foundationResults : undefined}
                foundationMat={foundationMat}
              />
              {/* Main Export Panel with Floor Selector */}
              <ExportPanel
                stories={stories}
                slabs={slabs}
                beams={beamsWithLoads}
                columns={columns}
                beamDesigns={beamDesigns as any}
                colDesigns={colDesigns}
                slabDesigns={slabs.map(s => ({ ...s, design: designSlab(s, slabProps, mat, slabs, columns) }))}
                mat={mat}
                slabProps={slabProps}
                projectName={titleBlockConfig.projectName || 'Structural Design Studio'}
                titleBlockConfig={titleBlockConfig}
                analyzed={hasDesignResults}
                foundationResults={foundationResults}
                foundationMat={foundationMat}
              />

              {/* Additional quick export buttons */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm">تقرير PDF</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <Button className="w-full min-h-[44px]" disabled={!hasDesignResults} onClick={() => {
                      const slabDesignsData = slabs.map(s => ({ ...s, design: designSlab(s, slabProps, mat, slabs, columns) }));
                      generateStructuralReport(slabs, beamsWithLoads, columns, frames, frameResults, beamDesigns as any, colDesigns, slabDesignsData, mat, slabProps, 'Structural Design Studio', stories);
                    }}>تقرير التصميم الإنشائي</Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-sm">تصدير DXF</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <Button className="w-full min-h-[44px]" variant="outline" onClick={() => downloadDXF(generateStructuralDXF(slabs, beamsWithLoads, columns), 'structural_plan.dxf')}>مخطط إنشائي</Button>
                    <Button className="w-full min-h-[44px]" variant="outline" onClick={() => downloadDXF(generateBeamLayoutDXF(beamsWithLoads, columns, slabs), 'beam_layout.dxf')}>مخطط الجسور</Button>
                    <Button className="w-full min-h-[44px]" variant="outline" onClick={() => downloadDXF(generateColumnLayoutDXF(columns, slabs), 'column_layout.dxf')}>مخطط الأعمدة</Button>
                    <Button className="w-full min-h-[44px]" variant="outline" disabled={!hasDesignResults} onClick={() => {
                      const rebarData = beamDesigns.map(d => {
                        const beam = beamsWithLoads.find(b => b.id === d.beamId);
                        return beam ? { beamId: d.beamId, b: beam.b, h: beam.h, x1: beam.x1, y1: beam.y1, x2: beam.x2, y2: beam.y2, topBars: Math.max(d.flexLeft.bars, d.flexRight.bars), topDia: d.flexLeft.dia, botBars: d.flexMid.bars, botDia: d.flexMid.dia, stirrups: d.shear.stirrups } : null;
                      }).filter(Boolean) as any[];
                      downloadDXF(generateReinforcementDXF(slabs, beamsWithLoads, columns, rebarData), 'reinforcement.dxf');
                    }}>مخطط التسليح</Button>
                  </CardContent>
                </Card>
              </div>

              {/* Beam Rebar Detail Views */}
              {hasDesignResults && beamDesigns.length > 0 && (
                <div className="mt-6 space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">تفاصيل تسليح الجسور</h3>
                  {beamDesigns.map(d => {
                    const beam = beamsWithLoads.find(b => b.id === d.beamId);
                    if (!beam) return null;
                    const bent = getBentUpData(d.beamId);
                    return (
                      <BeamRebarDetailView
                        key={d.beamId}
                        beamId={d.beamId}
                        b={beam.b}
                        h={beam.h}
                        span={d.span}
                        flexLeft={d.flexLeft}
                        flexMid={d.flexMid}
                        flexRight={d.flexRight}
                        shear={d.shear}
                        hasBentBars={!!bent}
                        additionalTopLeft={bent?.additionalTopLeft}
                        additionalTopRight={bent?.additionalTopRight}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          {/* LOADS INPUT TAB */}
          <TabsContent value="loads-input" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
            <LoadInputPanel
              beams={beams.filter(b => !removedBeamIds.includes(b.id))}
              slabs={slabs}
              beamOverrides={beamOverrides}
              onSetBeamWallLoad={(beamId, wallLoad) => {
                const isExtra = extraBeams.some(b => b.id === beamId);
                if (isExtra) dispatch({ type: 'UPDATE_EXTRA_BEAM', id: beamId, updates: { wallLoad } });
                else dispatch({ type: 'SET_BEAM_OVERRIDE', beamId, override: { wallLoad } });
              }}
              loadCombos={loadCombos}
              onSetLoadCombos={(combos) => setLoadCombos(combos as typeof loadCombos)}
              defaultDL={slabProps.finishLoad}
              defaultLL={slabProps.liveLoad}
            />
          </TabsContent>

          <TabsContent value="building" className="flex-1 overflow-hidden mt-0">
            <MultiStoryDesigner
              initialSlabs={slabs}
              mat={mat}
              slabProps={slabProps}
              beamB={beamB}
              beamH={beamH}
              colB={colB}
              colH={colH}
              onClose={() => dispatch({ type: 'SET_ACTIVE_TAB', tab: 'modeler' })}
            />
          </TabsContent>

          {/* GLOBAL FRAME SOLVER TAB */}
          <TabsContent value="solver" className="flex-1 overflow-auto mt-0 p-3 space-y-4">
            <AdvancedAnalysisPanel
              frames={frames}
              beams={beamsWithLoads}
              columns={columns}
              mat={mat}
              bobConnections={detectedConnections}
              slabs={slabs}
              slabProps={slabProps}
              beamStiffnessFactor={beamStiffnessFactor}
              colStiffnessFactor={colStiffnessFactor}
              onColStiffnessChange={(v) => dispatch({ type: 'SET_COL_STIFFNESS_FACTOR', value: v })}
            />
            <GlobalFrameSolverPanel />
          </TabsContent>

          {/* PROJECTS TAB */}
          <TabsContent value="projects" className="flex-1 overflow-hidden mt-0">
            <ProjectManager
              currentState={state}
              onLoadProject={(data) => dispatch({ type: 'LOAD_PROJECT', data })}
              onNewProject={() => dispatch({ type: 'RESET_TO_DEFAULT' })}
              storyCount={stories.length}
              slabCount={slabs.length}
            />
          </TabsContent>

          {/* GENERATIVE TAB */}
          <TabsContent value="generative" className="flex-1 overflow-hidden mt-0">
            <GenerativeDesignDashboard
              onApplyOption={(ev: EvaluatedOption) => {
                dispatch({
                  type: 'APPLY_GENERATIVE',
                  slabs: (ev.option.slabs?.length ? ev.option.slabs : slabs) as Slab[],
                  beamB: ev.option.sections.beamB,
                  beamH: ev.option.sections.beamH,
                  colB: ev.option.sections.colB,
                  colH: ev.option.sections.colH,
                });
                setMainTab('modeling');
                dispatch({ type: 'SET_ACTIVE_TAB', tab: 'modeler' });
              }}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Rebar Detail Modal */}
      {selectedElement && modalData && (
        <RebarDetailModal
          open={modalOpen}
          onClose={() => dispatch({ type: 'CLOSE_MODAL' })}
          elementType={selectedElement.type}
          elementId={selectedElement.id}
          dimensions={modalData.dimensions}
          reinforcement={modalData.reinforcement}
        />
      )}

      {/* View tab — bending-moment chart along the element */}
      {momentChartElement && (
        <ElementMomentChartModal
          open={!!momentChartElement}
          onClose={() => setMomentChartElement(null)}
          elementType={momentChartElement.type}
          elementId={momentChartElement.id}
          beams={beamsWithLoads}
          columns={columns}
          slabs={slabs}
          frameResults={
            !showViewMoments ? frameResults :
            viewMomentEngine === '2d' ? frameResults2D :
            viewMomentEngine === '3d' ? frameResults3DRaw :
            viewMomentEngine === 'gf' ? frameResultsGF :
            frameResults
          }
          beamDesigns={beamDesigns}
          colDesigns={colDesigns}
        />
      )}

      <Dialog open={!!releaseEditorBeamId} onOpenChange={(open) => !open && setReleaseEditorBeamId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">تحرير أطراف الجسر {releaseEditorBeam?.id}</DialogTitle>
            <DialogDescription>
              عدّل Releases للجسر مباشرة من تبويب الإدخال، وأي حفظ هنا يلغي نتائج التحليل السابقة حتى تعيد التشغيل بالقيم الجديدة.
            </DialogDescription>
          </DialogHeader>

          {releaseEditorBeam && (
            <div className="space-y-4">
              {/* ── أبعاد الجسر (قابلة للتعديل) ── */}
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
                <div className="font-semibold text-foreground text-sm">أبعاد الجسر</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">العرض b (مم)</label>
                    <input
                      type="number"
                      value={releaseEditorDims.b}
                      onChange={e => setReleaseEditorDims(prev => ({ ...prev, b: Number(e.target.value) }))}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">الارتفاع h (مم)</label>
                    <input
                      type="number"
                      value={releaseEditorDims.h}
                      onChange={e => setReleaseEditorDims(prev => ({ ...prev, h: Number(e.target.value) }))}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>البداية: <span className="font-mono text-foreground">({releaseEditorBeam.x1.toFixed(2)}, {releaseEditorBeam.y1.toFixed(2)})</span></div>
                  <div>النهاية: <span className="font-mono text-foreground">({releaseEditorBeam.x2.toFixed(2)}, {releaseEditorBeam.y2.toFixed(2)})</span></div>
                  <div>الطول: <span className="font-mono text-foreground">{releaseEditorBeam.length.toFixed(2)} م</span></div>
                </div>
              </div>

              {/* ── درجات حرية الأطراف (أفقي) ── */}
              <div className="space-y-2">
                <div className="font-semibold text-foreground text-sm">درجات حرية الأطراف</div>
                <p className="text-[10px] text-muted-foreground">✓ محدد = محرر (Released) • غير محدد = مقيد (Restrained)</p>
                {([
                  { key: 'nodeI' as const, title: 'الطرف I — بداية الجسر' },
                  { key: 'nodeJ' as const, title: 'الطرف J — نهاية الجسر' },
                ]).map(({ key, title }) => (
                  <div key={key} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-foreground">{title}</span>
                      <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => resetReleaseEditorEnd(key)}>
                        تصفير
                      </Button>
                    </div>
                    <div className="grid grid-cols-6 gap-1">
                      {RELEASE_DOF_META.map(({ key: dof, etabs }) => (
                        <label key={`${key}-${dof}`} className="flex flex-col items-center gap-1 cursor-pointer">
                          <span className="font-mono text-[10px] text-muted-foreground">{etabs}</span>
                          <Checkbox
                            checked={releaseEditorData[key][dof]}
                            onCheckedChange={(checked) => handleReleaseEditorToggle(key, dof, checked === true)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {releaseEditorWarnings.length > 0 && (
                <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                  {releaseEditorWarnings.map((warning) => (
                    <p key={warning} className="text-xs font-medium text-destructive">⚠ {warning}</p>
                  ))}
                </div>
              )}

              {/* ── تطبيق على أدوار أخرى ── */}
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <Checkbox
                  id="apply-other-floors"
                  checked={releaseEditorApplyOtherFloors}
                  onCheckedChange={v => setReleaseEditorApplyOtherFloors(!!v)}
                />
                <label htmlFor="apply-other-floors" className="text-xs cursor-pointer">
                  تطبيق تغييرات الأبعاد على الجسور بنفس الإحداثيات في الأدوار الأخرى
                </label>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReleaseEditorBeamId(null)}>إلغاء</Button>
            <Button type="button" onClick={saveBeamReleaseEditor}>حفظ التحرير</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Element Properties Dialog (long-press) */}
      <ElementPropertiesDialog
        open={elemPropsOpen}
        onClose={() => dispatch({ type: 'CLOSE_ELEM_PROPS' })}
        frame={elemPropsFrameId != null ? currentFrames.find(f => f.id === elemPropsFrameId) : null}
        area={elemPropsAreaId != null ? currentAreas.find(a => a.id === elemPropsAreaId) : null}
        nodeI={elemPropsFrameId != null ? (() => { const f = currentFrames.find(fr => fr.id === elemPropsFrameId); return f ? currentNodes.find(n => n.id === f.nodeI) : null; })() : null}
        nodeJ={elemPropsFrameId != null ? (() => { const f = currentFrames.find(fr => fr.id === elemPropsFrameId); return f ? currentNodes.find(n => n.id === f.nodeJ) : null; })() : null}
        slabProps={elemPropsAreaId != null ? { ...slabProps, ...(slabPropsOverrides[elemPropsAreaId] || {}) } : null}
        onSave={handleElemPropsSave}
        onDelete={handleElemPropsDelete}
      />

      {/* Analysis Diagram Dialog */}
      <AnalysisDiagramDialog
        open={diagramOpen}
        onClose={() => dispatch({ type: 'CLOSE_DIAGRAM' })}
        data={diagramData}
      />

      {/* Bottom Navigation */}
      <BottomNav 
        activeTab={mainTab} 
        onTabChange={(tab) => {
          setMainTab(tab);
          // Auto-switch to first sub-tab of the section
          if (tab === 'reports') dispatch({ type: 'SET_ACTIVE_TAB', tab: 'design' });
          else if (tab === 'inputs') dispatch({ type: 'SET_ACTIVE_TAB', tab: 'input' });
          else if (tab === 'modeling') dispatch({ type: 'SET_ACTIVE_TAB', tab: 'modeler' });
          else if (tab === 'projects') dispatch({ type: 'SET_ACTIVE_TAB', tab: 'projects' });
          else if (tab === 'solver') dispatch({ type: 'SET_ACTIVE_TAB', tab: 'solver' });
        }}
      />
    </div>
  );
};

export default Index;
