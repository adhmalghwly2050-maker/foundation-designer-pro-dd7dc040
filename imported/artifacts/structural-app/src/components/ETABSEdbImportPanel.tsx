/**
 * ETABSEdbImportPanel
 * ─────────────────────────────────────────────────────────────────────────────
 * استيراد ملف ETABS النصي (.e2k أو .EDB المُصدَّر كنص)
 *
 * خطوات التصدير من ETABS:
 *   File → Export → ETABS 2000 Text File (.e2k)
 *   ثم استيراد الملف الناتج هنا.
 *
 * البيانات المستخرجة:
 *   • العقد (Joints) مع إحداثياتها X, Y, Z
 *   • مقاطع الإطارات (FrameSection) — أبعاد b × h
 *   • عناصر الإطارات (Frames) — جسور وأعمدة
 *   • مقاطع البلاطات (AreaSection) — السماكة
 *   • البلاطات (Areas)
 *   • خصائص المواد (fc, fy)
 *   • نتائج التحليل إن وُجدت (ردود أفعال / عزوم)
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Upload, Check, AlertTriangle, Info, ChevronDown, ChevronUp,
  MapPin, Layers, Columns3, LayoutGrid, Activity, BookOpen, FileCode2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Types exported for parent use
// ─────────────────────────────────────────────────────────────────────────────

export interface EdbJoint {
  id: string;
  x: number; // meters
  y: number;
  z: number;
}

export interface EdbSection {
  id: string;
  b: number;  // mm (T2 width)
  h: number;  // mm (T3 height/depth)
  material: string;
  shape: string;
}

export interface EdbAreaSection {
  id: string;
  thickness: number; // mm
  material: string;
}

export interface EdbFrame {
  id: string;
  jointI: string;
  jointJ: string;
  section: string;
  angle: number;
  elementType: 'beam' | 'column' | 'brace' | 'other';
}

export interface EdbArea {
  id: string;
  section: string;
  joints: string[];
}

export interface EdbMaterial {
  id: string;
  type: string;
  fc?: number;  // MPa
  fy?: number;  // MPa
  E?: number;
}

export interface EdbReaction {
  joint: string;
  loadCase: string;
  Fz: number;   // kN vertical reaction
  Fx?: number;
  Fy?: number;
  Mx?: number;
  My?: number;
  Mz?: number;
}

export interface EdbBeamForce {
  frame: string;
  loadCase: string;
  station: number;
  Mx?: number; // kN.m  (M3 in ETABS = major axis moment)
  Vy?: number; // kN
  N?: number;  // kN axial
}

export interface EdbImportedData {
  joints: EdbJoint[];
  sections: EdbSection[];
  areaSections: EdbAreaSection[];
  frames: EdbFrame[];
  areas: EdbArea[];
  materials: EdbMaterial[];
  reactions: EdbReaction[];
  beamForces: EdbBeamForce[];
  units: { force: string; length: string };
  hasAnalysisResults: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// E2K Text Parser
// ─────────────────────────────────────────────────────────────────────────────

/** Extract value for a key=value pair from a token list, case-insensitive */
function getVal(tokens: string[], key: string): string | undefined {
  const ku = key.toUpperCase();
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].toUpperCase() === ku + '=') return tokens[i + 1];
    if (tokens[i].toUpperCase().startsWith(ku + '=')) return tokens[i].slice(key.length + 1);
  }
  return undefined;
}

/** Parse a line into tokens, handling quoted strings */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    // skip whitespace
    while (i < line.length && line[i] === ' ') i++;
    if (i >= line.length) break;
    if (line[i] === '"') {
      // quoted string
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j++;
      tokens.push(line.slice(i + 1, j));
      i = j + 1;
    } else {
      // unquoted token
      let j = i;
      while (j < line.length && line[j] !== ' ') j++;
      tokens.push(line.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

/** Parse key=value or KEY="value" pairs from token array */
function parseKV(tokens: string[]): Record<string, string> {
  const kv: Record<string, string> = {};
  // Each token might be KEY=VALUE or KEY= (and next token is value)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const eqIdx = t.indexOf('=');
    if (eqIdx > 0) {
      const k = t.slice(0, eqIdx).toUpperCase();
      const v = t.slice(eqIdx + 1);
      if (v !== '') {
        kv[k] = v.replace(/^"(.*)"$/, '$1');
      } else {
        // next token is value
        if (i + 1 < tokens.length) {
          kv[k] = tokens[i + 1].replace(/^"(.*)"$/, '$1');
          i++;
        }
      }
    } else if (eqIdx === -1 && i === 0) {
      kv['__KEYWORD'] = t;
    }
  }
  return kv;
}

/** Determine if a frame element is a beam or column based on angle and joint heights */
function classifyFrame(
  frame: { id: string; jointI: string; jointJ: string; section: string; angle: number },
  jointMap: Map<string, EdbJoint>,
): 'beam' | 'column' | 'brace' | 'other' {
  const ji = jointMap.get(frame.jointI);
  const jj = jointMap.get(frame.jointJ);
  if (!ji || !jj) return 'other';
  const dz = Math.abs(jj.z - ji.z);
  const dx = Math.abs(jj.x - ji.x);
  const dy = Math.abs(jj.y - ji.y);
  const horLen = Math.sqrt(dx * dx + dy * dy);
  if (dz < 0.1 && horLen > 0.1) return 'beam';
  if (dz > 0.5 && horLen < 0.5) return 'column';
  if (dz > 0.2 && horLen > 0.2) return 'brace';
  return 'other';
}

/** Length conversion factors to meters */
function getLengthFactor(unit: string): number {
  switch (unit.toUpperCase()) {
    case 'MM': return 0.001;
    case 'CM': return 0.01;
    case 'M':  return 1.0;
    case 'IN': return 0.0254;
    case 'FT': return 0.3048;
    default:   return 1.0;
  }
}

/** Parse the entire E2K text content */
function parseE2K(text: string): EdbImportedData {
  const lines = text.split(/\r?\n/);

  const joints: EdbJoint[] = [];
  const sections: EdbSection[] = [];
  const areaSections: EdbAreaSection[] = [];
  const frames: EdbFrame[] = [];
  const areas: EdbArea[] = [];
  const materials: EdbMaterial[] = [];
  const reactions: EdbReaction[] = [];
  const beamForces: EdbBeamForce[] = [];

  let currentSection = '';
  let units = { force: 'KN', length: 'M' };
  let lengthFactor = 1.0; // convert to meters
  let forceFactor = 1.0;  // convert to kN

  const jointMap = new Map<string, EdbJoint>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('!')) continue;

    // Section header: starts with $
    if (line.startsWith('$')) {
      currentSection = line.slice(1).trim().toUpperCase();
      continue;
    }

    const tokens = tokenize(line);
    if (tokens.length === 0) continue;
    const keyword = tokens[0].toUpperCase();
    const kv = parseKV(tokens.slice(1));

    // Parse by section
    switch (currentSection) {

      case 'ACTIVE UNITS':
      case 'UNITS': {
        // UNITS  FORCE="KN"  LENGTH="M"
        const f = kv['FORCE'] ?? kv['F'] ?? '';
        const l = kv['LENGTH'] ?? kv['L'] ?? kv['LEN'] ?? '';
        if (f) units.force = f.toUpperCase();
        if (l) units.length = l.toUpperCase();
        lengthFactor = getLengthFactor(units.length);
        // Force: KN=1, N=0.001, KIP=4.448, LBF=0.004448
        forceFactor = units.force === 'N' ? 0.001 :
                      units.force === 'KIP' ? 4.448221615 :
                      units.force === 'LBF' ? 0.00444822162 : 1.0;
        break;
      }

      case 'JOINT COORDINATES':
      case 'JOINTS': {
        if (keyword === 'JOINT') {
          const id = kv['JOINT'] ?? tokens[1] ?? '';
          const x = parseFloat(kv['X'] ?? '0') * lengthFactor;
          const y = parseFloat(kv['Y'] ?? '0') * lengthFactor;
          const z = parseFloat(kv['Z'] ?? '0') * lengthFactor;
          if (id) {
            const j: EdbJoint = { id, x, y, z };
            joints.push(j);
            jointMap.set(id, j);
          }
        }
        break;
      }

      case 'MATERIAL PROPERTIES':
      case 'MATERIALS': {
        if (keyword === 'MATERIAL') {
          const id = kv['MATERIAL'] ?? tokens[1] ?? '';
          const type = kv['TYPE'] ?? '';
          const fc = parseFloat(kv['FC'] ?? kv['FPC'] ?? '0');
          const fy = parseFloat(kv['FY'] ?? '0');
          const E = parseFloat(kv['E'] ?? '0');
          if (id) {
            materials.push({
              id,
              type: type.toUpperCase(),
              fc: fc > 0 ? fc / 1000 : undefined,  // Pa → MPa if needed
              fy: fy > 0 ? fy / 1000 : undefined,
              E: E > 0 ? E : undefined,
            });
          }
        }
        break;
      }

      case 'FRAME SECTIONS':
      case 'FRAMESECTIONS': {
        if (keyword === 'FRAMESECTION') {
          const id = kv['FRAMESECTION'] ?? tokens[1] ?? '';
          const mat = kv['MATERIAL'] ?? kv['MAT'] ?? '';
          const shape = (kv['SHAPE'] ?? '').toUpperCase();
          // T2 = width (b), T3 = height (h) in ETABS local axis convention
          const T2 = parseFloat(kv['T2'] ?? kv['B'] ?? '0') * lengthFactor * 1000; // → mm
          const T3 = parseFloat(kv['T3'] ?? kv['H'] ?? kv['D'] ?? '0') * lengthFactor * 1000;
          if (id) {
            sections.push({ id, b: T2, h: T3, material: mat, shape });
          }
        }
        break;
      }

      case 'AREA SECTIONS':
      case 'AREASECTIONS': {
        if (keyword === 'AREASECTION') {
          const id = kv['AREASECTION'] ?? tokens[1] ?? '';
          const mat = kv['MATERIAL'] ?? '';
          const thick = parseFloat(kv['THICK'] ?? kv['THICKNESS'] ?? kv['T'] ?? '0') * lengthFactor * 1000; // → mm
          if (id) {
            areaSections.push({ id, thickness: thick, material: mat });
          }
        }
        break;
      }

      case 'CONNECTIVITY - FRAME':
      case 'FRAME CONNECTIVITY':
      case 'FRAMES': {
        if (keyword === 'FRAME') {
          const id = kv['FRAME'] ?? tokens[1] ?? '';
          const ji = kv['JI'] ?? kv['JOINTI'] ?? kv['JOINT1'] ?? '';
          const jj = kv['JJ'] ?? kv['JOINTJ'] ?? kv['JOINT2'] ?? '';
          const sec = kv['SEC'] ?? kv['SECTION'] ?? '';
          const ang = parseFloat(kv['ANG'] ?? kv['ANGLE'] ?? '0');
          if (id && ji && jj) {
            frames.push({ id, jointI: ji, jointJ: jj, section: sec, angle: ang, elementType: 'other' });
          }
        }
        break;
      }

      case 'CONNECTIVITY - AREA':
      case 'AREA CONNECTIVITY':
      case 'AREAS': {
        if (keyword === 'AREA') {
          const id = kv['AREA'] ?? tokens[1] ?? '';
          const sec = kv['SEC'] ?? kv['SECTION'] ?? '';
          const numPts = parseInt(kv['NUMPOINTS'] ?? kv['NUMPTS'] ?? '4');
          const areaJoints: string[] = [];
          for (let i = 1; i <= numPts; i++) {
            const j = kv[`JOINT${i}`] ?? kv[`J${i}`] ?? '';
            if (j) areaJoints.push(j);
          }
          if (id) {
            areas.push({ id, section: sec, joints: areaJoints });
          }
        }
        break;
      }

      case 'JOINT REACTIONS':
      case 'JOINT REACTION':
      case 'RESULTS - JOINT REACTIONS': {
        if (keyword === 'JOINTREACT' || keyword === 'REACTION') {
          const joint = kv['JOINT'] ?? '';
          const lc = kv['LOADCASE'] ?? kv['CASE'] ?? kv['OUTPUT CASE'] ?? '';
          const Fz = parseFloat(kv['F3'] ?? kv['FZ'] ?? '0') * forceFactor;
          const Fx = parseFloat(kv['F1'] ?? kv['FX'] ?? '0') * forceFactor;
          const Fy = parseFloat(kv['F2'] ?? kv['FY'] ?? '0') * forceFactor;
          const Mx = parseFloat(kv['M1'] ?? kv['MX'] ?? '0') * forceFactor;
          const My = parseFloat(kv['M2'] ?? kv['MY'] ?? '0') * forceFactor;
          const Mz = parseFloat(kv['M3'] ?? kv['MZ'] ?? '0') * forceFactor;
          if (joint) {
            reactions.push({ joint, loadCase: lc, Fz, Fx, Fy, Mx, My, Mz });
          }
        }
        break;
      }

      case 'FRAME OUTPUT':
      case 'ELEMENT FORCES - FRAMES':
      case 'FRAME FORCES':
      case 'RESULTS - FRAME FORCES': {
        if (keyword === 'FRAMEFORCE' || keyword === 'FORCEFORCE' || keyword === 'FRAMEOUTPUT') {
          const frame = kv['FRAME'] ?? '';
          const lc = kv['LOADCASE'] ?? kv['CASE'] ?? '';
          const station = parseFloat(kv['STATION'] ?? kv['LOC'] ?? '0') * lengthFactor;
          const M3 = parseFloat(kv['M3'] ?? kv['MMAYOR'] ?? '0');
          const V2 = parseFloat(kv['V2'] ?? kv['V'] ?? '0') * forceFactor;
          const P  = parseFloat(kv['P'] ?? kv['AXIAL'] ?? '0') * forceFactor;
          if (frame) {
            beamForces.push({ frame, loadCase: lc, station, Mx: M3 * forceFactor, Vy: V2, N: P });
          }
        }
        break;
      }

      default:
        break;
    }
  }

  // Classify frames as beam/column/brace based on geometry
  for (const f of frames) {
    f.elementType = classifyFrame(f, jointMap);
  }

  // Fix material values: ETABS stores fc in ksi or kPa depending on units
  // Heuristic: if fc > 100, it's probably in kPa or Pa; if < 100, likely MPa already
  for (const m of materials) {
    if (m.type === 'CONCRETE' || m.type === 'CONC') {
      if (m.fc !== undefined) {
        if (m.fc > 100) m.fc = m.fc / 1000; // kPa → MPa
        if (m.fc < 1) m.fc = m.fc * 1000;   // GPa → MPa (unlikely but safety)
      }
      if (m.fy !== undefined) {
        if (m.fy > 10000) m.fy = m.fy / 1000; // Pa → MPa
        if (m.fy > 1000) m.fy = m.fy / 1000;  // kPa → MPa
      }
    }
  }

  return {
    joints,
    sections,
    areaSections,
    frames,
    areas,
    materials,
    reactions,
    beamForces,
    units,
    hasAnalysisResults: reactions.length > 0 || beamForces.length > 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component Props
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  onApply: (data: EdbImportedData) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const ETABSEdbImportPanel: React.FC<Props> = ({ onApply }) => {
  const [data, setData] = useState<EdbImportedData | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const beamCount = useMemo(() => data?.frames.filter(f => f.elementType === 'beam').length ?? 0, [data]);
  const colCount  = useMemo(() => data?.frames.filter(f => f.elementType === 'column').length ?? 0, [data]);

  // Detect primary concrete material for fc/fy display
  const concMat = useMemo(() => {
    if (!data) return null;
    return data.materials.find(m =>
      m.type === 'CONCRETE' || m.type === 'CONC' ||
      m.type.includes('CONC')
    ) ?? data.materials[0] ?? null;
  }, [data]);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setError(null);
    setApplied(false);
    setLoading(true);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        // Basic check that it's a text-based ETABS file
        if (!text.includes('$') && !text.includes('JOINT') && !text.includes('FRAME')) {
          throw new Error(
            'لا يمكن قراءة الملف كملف ETABS نصي. ' +
            'تأكد من تصديره من ETABS عبر: File → Export → ETABS 2000 Text File (.e2k)'
          );
        }
        const result = parseE2K(text);
        if (result.joints.length === 0 && result.frames.length === 0) {
          throw new Error('لم يتم التعرف على بيانات النموذج. تأكد من أن الملف يحتوي على عقد وعناصر إطارية.');
        }
        setData(result);
      } catch (e: any) {
        setError(e.message ?? 'خطأ في قراءة الملف');
        setData(null);
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => {
      setError('تعذّر قراءة الملف');
      setLoading(false);
    };
    reader.readAsText(file, 'UTF-8');
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }, [handleFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleApply = useCallback(() => {
    if (!data) return;
    onApply(data);
    setApplied(true);
  }, [data, onApply]);

  return (
    <div className="space-y-4">

      {/* ── Info Card ── */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-500/5">
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
            <Info size={13} className="mt-0.5 shrink-0 text-blue-500" />
            <div>
              <p className="font-semibold text-foreground mb-1">كيفية تصدير الملف من ETABS:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>افتح مشروعك في ETABS وشغّل التحليل إذا أردت نقل نتائجه</li>
                <li>اذهب إلى: <code className="bg-muted px-1 rounded">File → Export → ETABS 2000 Text File</code></li>
                <li>احفظ الملف بامتداد <code className="bg-muted px-1 rounded">.e2k</code></li>
                <li>استورد الملف هنا — يحتوي على كامل النموذج + نتائج التحليل</li>
              </ol>
              <p className="mt-2 text-[10px]">
                <strong>ملاحظة:</strong> ملف .edb هو ملف ثنائي خاص لا يمكن قراءته مباشرةً.
                يُرجى تصديره كملف .e2k أولاً من داخل ETABS.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Upload Area ── */}
      <Card
        className={`border-2 border-dashed transition-colors ${data ? 'border-green-400 bg-green-500/5' : 'border-muted hover:border-primary/50'}`}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <CardContent className="py-6 text-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".e2k,.EDB,.edb,.txt,.ETB"
            className="hidden"
            onChange={handleInputChange}
          />

          {!data ? (
            <div className="space-y-3">
              <div className="flex justify-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                  <FileCode2 size={24} className="text-muted-foreground" />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium">اسحب ملف ETABS النصي هنا</p>
                <p className="text-xs text-muted-foreground mt-1">.e2k أو .edb (مُصدَّر كنص)</p>
              </div>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="min-h-[40px] gap-2"
              >
                <Upload size={15} />
                {loading ? 'جاري القراءة...' : 'اختر الملف'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-center">
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <Check size={24} className="text-green-600" />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-green-700 dark:text-green-400">{fileName}</p>
                <p className="text-xs text-muted-foreground">تمت القراءة بنجاح</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1 text-xs"
              >
                <Upload size={12} /> تغيير الملف
              </Button>
            </div>
          )}

          {error && (
            <div className="mt-3 flex items-start gap-2 text-xs text-red-600 dark:text-red-400 text-right bg-red-50 dark:bg-red-950/20 rounded p-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Summary Cards ── */}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryCard icon={<MapPin size={14} />} label="عقد" value={data.joints.length} color="blue" />
            <SummaryCard icon={<Columns3 size={14} />} label="جسور" value={beamCount} color="emerald" />
            <SummaryCard icon={<Columns3 size={14} className="rotate-90" />} label="أعمدة" value={colCount} color="violet" />
            <SummaryCard icon={<LayoutGrid size={14} />} label="بلاطات" value={data.areas.length} color="amber" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <SummaryCard icon={<Layers size={14} />} label="مقاطع إطارية" value={data.sections.length} color="slate" />
            <SummaryCard icon={<Activity size={14} />} label="نتائج تحليل" value={data.hasAnalysisResults ? 'موجودة' : 'غير موجودة'} color={data.hasAnalysisResults ? 'green' : 'slate'} />
          </div>

          {/* Material info */}
          {concMat && (
            <Card className="border-muted">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <BookOpen size={13} className="text-muted-foreground" />
                  <span className="text-xs font-medium">خصائص المواد:</span>
                  {concMat.fc !== undefined && (
                    <Badge variant="outline" className="text-[10px]">
                      f'c = {concMat.fc.toFixed(1)} MPa
                    </Badge>
                  )}
                  {concMat.fy !== undefined && (
                    <Badge variant="outline" className="text-[10px]">
                      fy = {concMat.fy.toFixed(0)} MPa
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    {concMat.id}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Analysis results indicator */}
          {data.hasAnalysisResults && (
            <Card className="border-green-200 dark:border-green-800 bg-green-500/5">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
                  <Activity size={13} />
                  <span className="font-medium">يحتوي الملف على نتائج تحليل:</span>
                  <span>{data.reactions.length} ردود أفعال عقدية</span>
                  {data.beamForces.length > 0 && <span>• {data.beamForces.length} نقطة قوى إطارية</span>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 pr-5">
                  ستُنقل ردود الأفعال تلقائياً إلى تبويب التصميم للاستخدام في تصميم الأساسات
                </p>
              </CardContent>
            </Card>
          )}

          {/* Details toggle */}
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowDetails(v => !v)}
          >
            {showDetails ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {showDetails ? 'إخفاء' : 'عرض'} تفاصيل العناصر المستوردة
          </button>

          {showDetails && (
            <div className="space-y-3">
              {/* Sections table */}
              {data.sections.length > 0 && (
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-xs text-muted-foreground">المقاطع الإطارية ({data.sections.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="text-[10px] w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-right py-1 px-2">المقطع</th>
                          <th className="text-right py-1 px-2">العرض b (مم)</th>
                          <th className="text-right py-1 px-2">الارتفاع h (مم)</th>
                          <th className="text-right py-1 px-2">المادة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.sections.slice(0, 15).map(s => (
                          <tr key={s.id} className="border-b border-muted/50">
                            <td className="py-1 px-2 font-mono font-bold">{s.id}</td>
                            <td className="py-1 px-2 font-mono">{s.b.toFixed(0)}</td>
                            <td className="py-1 px-2 font-mono">{s.h.toFixed(0)}</td>
                            <td className="py-1 px-2 text-muted-foreground">{s.material}</td>
                          </tr>
                        ))}
                        {data.sections.length > 15 && (
                          <tr><td colSpan={4} className="py-1 px-2 text-center text-muted-foreground">... و {data.sections.length - 15} مقطع آخر</td></tr>
                        )}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}

              {/* Frames sample */}
              {data.frames.length > 0 && (
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-xs text-muted-foreground">
                      العناصر الإطارية ({data.frames.length}) — جسور: {beamCount} | أعمدة: {colCount}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="text-[10px] w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-right py-1 px-2">ID</th>
                          <th className="text-right py-1 px-2">النوع</th>
                          <th className="text-right py-1 px-2">العقدة I</th>
                          <th className="text-right py-1 px-2">العقدة J</th>
                          <th className="text-right py-1 px-2">المقطع</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.frames.slice(0, 20).map(f => (
                          <tr key={f.id} className="border-b border-muted/50">
                            <td className="py-1 px-2 font-mono font-bold">{f.id}</td>
                            <td className="py-1 px-2">
                              <Badge className={`text-[9px] ${
                                f.elementType === 'beam' ? 'bg-emerald-500/15 text-emerald-700 border-emerald-400/40' :
                                f.elementType === 'column' ? 'bg-violet-500/15 text-violet-700 border-violet-400/40' :
                                'bg-muted text-muted-foreground'
                              }`}>
                                {f.elementType === 'beam' ? 'جسر' : f.elementType === 'column' ? 'عمود' : 'أخرى'}
                              </Badge>
                            </td>
                            <td className="py-1 px-2 font-mono text-muted-foreground">{f.jointI}</td>
                            <td className="py-1 px-2 font-mono text-muted-foreground">{f.jointJ}</td>
                            <td className="py-1 px-2 font-mono">{f.section}</td>
                          </tr>
                        ))}
                        {data.frames.length > 20 && (
                          <tr><td colSpan={5} className="py-1 px-2 text-center text-muted-foreground">... و {data.frames.length - 20} عنصر آخر</td></tr>
                        )}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Apply button */}
          <Button
            className="w-full min-h-[48px] gap-2 text-sm font-bold"
            onClick={handleApply}
            disabled={applied}
          >
            {applied ? (
              <>
                <Check size={16} />
                تم تطبيق النموذج — يمكنك التصميم الآن
              </>
            ) : (
              <>
                <Check size={16} />
                تطبيق النموذج على التطبيق
              </>
            )}
          </Button>

          {applied && (
            <p className="text-xs text-center text-green-700 dark:text-green-400">
              ✓ تم نقل العناصر والأبعاد والمواد
              {data.hasAnalysisResults && ' ونتائج التحليل'}
              {' '}إلى التطبيق. اذهب إلى تبويب التصميم.
            </p>
          )}
        </>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Summary Card Sub-component
// ─────────────────────────────────────────────────────────────────────────────

function SummaryCard({
  icon, label, value, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue:    'border-blue-200 dark:border-blue-800 bg-blue-500/5 text-blue-700 dark:text-blue-300',
    emerald: 'border-emerald-200 dark:border-emerald-800 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
    violet:  'border-violet-200 dark:border-violet-800 bg-violet-500/5 text-violet-700 dark:text-violet-300',
    amber:   'border-amber-200 dark:border-amber-800 bg-amber-500/5 text-amber-700 dark:text-amber-300',
    slate:   'border-muted bg-muted/30 text-muted-foreground',
    green:   'border-green-200 dark:border-green-800 bg-green-500/5 text-green-700 dark:text-green-300',
  };
  return (
    <Card className={`border ${colorMap[color] ?? colorMap.slate}`}>
      <CardContent className="py-3 px-3 flex items-center gap-2">
        <span className="opacity-70">{icon}</span>
        <div>
          <p className="text-[10px] opacity-70">{label}</p>
          <p className="text-sm font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default ETABSEdbImportPanel;
