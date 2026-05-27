/**
 * FoundationDesignPanel
 * تصميم الأساسات المنفردة بطريقة Working Stress Method (ASD) / UBC 1997
 *
 * مصادر الأحمال:
 *   ١- محركات التطبيق الداخلية (قوى الأعمدة المحسوبة)
 *   ٢- استيراد ردود الأفعال من ETABS (xlsx)
 */

import React, { useState, useMemo, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  Calculator, Upload, Check, Info, AlertTriangle, Download,
  Eye, ChevronDown, ChevronUp, Settings2, BookOpen,
} from 'lucide-react';
import {
  designFooting,
  type ColumnReactionInput,
  type FootingMaterials,
  type FootingDesignResult,
} from '@/lib/foundationDesign';
import type { Column } from '@/lib/structuralEngine';
import type { ETABSReaction } from './ETABSAnalysisImport';
import { downloadCSV } from '@/lib/capacitorDownload';
import { generateFoundationDXF, downloadDXF, type FoundationDXFInput } from '@/export/dxfExporter';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ColLoadInput {
  colId: string;
  P_DL: number;
  P_LL: number;
  colB: number;
  colH: number;
  x: number;
  y: number;
}

interface Props {
  columns: Column[];
  colDesigns: any[];
  colLoads3D?: Map<string, { P_service?: number; Pu?: number }>;
  etabsReactions?: ETABSReaction[];
  titleBlockConfig?: any;
  mat: { fc: number; fy: number };
  onResultsChange?: (results: FootingDesignResult[], mat: FootingMaterials) => void;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const ParamField = ({
  label, value, onChange, unit, min,
}: {
  label: string; value: number; onChange: (v: number) => void; unit?: string; min?: number;
}) => (
  <div className="space-y-1">
    <label className="text-xs font-medium text-muted-foreground">
      {label}{unit && <span className="text-[10px] ml-1">({unit})</span>}
    </label>
    <Input
      type="number"
      value={value}
      min={min}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="h-9 font-mono text-sm"
    />
  </div>
);

const StatusBadge = ({ ok }: { ok: boolean }) => (
  <Badge
    variant={ok ? 'default' : 'destructive'}
    className={`text-[10px] ${ok ? 'bg-green-600' : ''}`}
  >
    {ok ? 'آمن ✓' : 'تجاوز ✗'}
  </Badge>
);

// ─── Main Component ──────────────────────────────────────────────────────────

export default function FoundationDesignPanel({
  columns,
  colDesigns,
  colLoads3D,
  etabsReactions,
  titleBlockConfig,
  mat,
  onResultsChange,
}: Props) {
  // ── Material & soil inputs ─────────────────────────────────────────────────
  const [fc, setFc]   = useState(mat.fc || 21);
  const [fy, setFy]   = useState(mat.fy || 280);
  const [qa, setQa]   = useState(150);       // kN/m²
  const [cover, setCover] = useState(75);    // mm
  const [Df, setDf]   = useState(1.5);       // m
  const [gammaSoil, setGammaSoil] = useState(18);   // kN/m³
  const [gammaConc, setGammaConc] = useState(24);   // kN/m³

  // ── Load source ────────────────────────────────────────────────────────────
  const [loadSource, setLoadSource] = useState<'app' | 'etabs' | 'manual'>('app');

  // ── Manual load inputs (when source = manual or app) ──────────────────────
  const [manualLoads, setManualLoads] = useState<ColLoadInput[]>([]);

  // ── ETABS reactions import ─────────────────────────────────────────────────
  const [etabsFileReacts, setEtabsFileReacts] = useState<ETABSReaction[]>([]);
  const [etabsLoadingStatus, setEtabsLoadingStatus] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Results ────────────────────────────────────────────────────────────────
  const [results, setResults] = useState<FootingDesignResult[]>([]);
  const [designed, setDesigned] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // ── Compute column loads from app analysis ──────────────────────────────────
  const appColLoads = useMemo<ColLoadInput[]>(() => {
    // الأساسات تُصمَّم فقط لأعمدة الدور الأرضي (منسوب الأساسات)
    // الأعمدة الأخرى في الأدوار العليا لها رقاب متصلة بأعمدة الدور الأول
    const minZ = Math.min(...columns.map(c => c.zBottom ?? 0));

    // تجميع احمال جميع الأدوار على كل موضع (x,y) لأعمدة الدور الأرضي
    // باستخدام الأحمال الخدمية فقط (بدون معاملات أمان)
    const groundCols = columns.filter(col => Math.abs((col.zBottom ?? 0) - minZ) < 1);

    // تجميع أحمال الأعمدة الأرضية فقط — عمود الدور الأرضي يحمل الحمل التراكمي الكامل من الأدوار العليا
    // ملاحظة: استخدام كامل الأعمدة (جميع الأدوار) يُسبب تضاعف الحمل لأن كل دور يُضاف على حدة
    const posLoads = new Map<string, { P_DL: number; P_LL: number; colB: number; colH: number; x: number; y: number }>();
    for (const col of groundCols) {
      // مفتاح الموضع (x, y)
      const posKey = `${col.x.toFixed(3)}_${col.y.toFixed(3)}`;

      // الأولوية: P_service من التحليل ثلاثي الأبعاد (1.0D+1.0L) للعمود الأرضي
      // — هذه القيمة تعكس الحمل التراكمي الحقيقي الواصل لمستوى الأساس
      const load3D = colLoads3D?.get(col.id);
      let P_service: number;
      if (load3D?.P_service && load3D.P_service > 0) {
        P_service = load3D.P_service;
      } else {
        const des = colDesigns.find(d => d.id === col.id || d.colId === col.id);
        const Pu = des?.Pu ?? des?.design?.Pu ?? 0;
        P_service = Pu / 1.2;
      }
      posLoads.set(posKey, {
        P_DL: parseFloat((P_service * 0.6).toFixed(1)),
        P_LL: parseFloat((P_service * 0.4).toFixed(1)),
        colB: col.b,
        colH: col.h,
        x: col.x,
        y: col.y,
      });
    }

    return groundCols
      .map(col => {
        const posKey = `${col.x.toFixed(3)}_${col.y.toFixed(3)}`;
        const loads = posLoads.get(posKey);
        if (!loads) return null;
        return {
          colId: col.id,
          P_DL: parseFloat(loads.P_DL.toFixed(1)),
          P_LL: parseFloat(loads.P_LL.toFixed(1)),
          colB: col.b,
          colH: col.h,
          x: col.x,
          y: col.y,
        };
      })
      .filter((c): c is ColLoadInput => c !== null && c.P_DL + c.P_LL > 5);
  }, [columns, colDesigns, colLoads3D]);

  // ── Combine ETABS reactions with column geometry ───────────────────────────
  const etabsColLoads = useMemo<ColLoadInput[]>(() => {
    const reactions = etabsReactions && etabsReactions.length > 0
      ? etabsReactions
      : etabsFileReacts;

    if (reactions.length === 0) return [];

    return reactions.map((r, idx) => {
      // Try to match reaction point to column geometry by nearest column
      const matchedCol = columns.reduce((best: Column | null, col) => {
        if (!best) return col;
        return best;  // just use index-matched
      }, null);
      const col = columns[idx % columns.length];
      // Split Fz into DL (60%) + LL (40%) — typical conservative split
      const P_DL = r.Fz * 0.6;
      const P_LL = r.Fz * 0.4;
      return {
        colId: r.pointId,
        P_DL: parseFloat(P_DL.toFixed(1)),
        P_LL: parseFloat(P_LL.toFixed(1)),
        colB: col?.b ?? 300,
        colH: col?.h ?? 300,
        x: idx * 5,   // placeholder positions
        y: 0,
      };
    });
  }, [etabsReactions, etabsFileReacts, columns]);

  // ── Active load inputs ─────────────────────────────────────────────────────
  const activeLoads = useMemo<ColLoadInput[]>(() => {
    if (loadSource === 'app') return appColLoads;
    if (loadSource === 'etabs') return etabsColLoads;
    return manualLoads;
  }, [loadSource, appColLoads, etabsColLoads, manualLoads]);

  // Initialize manual loads from app if switching
  React.useEffect(() => {
    if (loadSource === 'manual' && manualLoads.length === 0 && appColLoads.length > 0) {
      setManualLoads(appColLoads.map(c => ({ ...c })));
    }
  }, [loadSource, appColLoads, manualLoads.length]);

  // ── ETABS xlsx file import ──────────────────────────────────────────────────
  const handleEtabsFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEtabsLoadingStatus('جاري القراءة...');
    try {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = new Uint8Array(ev.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const reactions: ETABSReaction[] = [];

          for (const sheetName of wb.SheetNames) {
            const nameLower = sheetName.toLowerCase();
            if (!nameLower.includes('reaction') && !nameLower.includes('support') && !nameLower.includes('joint')) continue;
            const ws = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
            if (rows.length < 3) continue;
            const hdr = (rows[0] || []).map((h: any) => String(h ?? '').toLowerCase().trim());
            const COL_PT   = Math.max(hdr.findIndex((h: string) => h === 'point' || h === 'joint' || h.includes('unique')), 1);
            const COL_CASE = Math.max(hdr.findIndex((h: string) => h.includes('output case') || h === 'case'), 2);
            const COL_FX   = hdr.findIndex((h: string) => h === 'fx' || h === 'f1');
            const COL_FY   = hdr.findIndex((h: string) => h === 'fy' || h === 'f2');
            const COL_FZ   = hdr.findIndex((h: string) => h === 'fz' || h === 'f3');
            const COL_MZ   = hdr.findIndex((h: string) => h === 'mz' || h === 'm3');

            const ptMap = new Map<string, { Fzs: number[]; Fxs: number[]; Fys: number[]; Mzs: number[]; cases: Set<string> }>();
            for (let i = 2; i < rows.length; i++) {
              const row = rows[i];
              if (!row || row.length < 4) continue;
              const ptName = String(row[COL_PT] ?? '').trim();
              if (!ptName) continue;
              const caseStr = String(row[COL_CASE] ?? '').trim();
              const Fx = COL_FX >= 0 ? Math.abs(Number(row[COL_FX]) || 0) : 0;
              const Fy = COL_FY >= 0 ? Math.abs(Number(row[COL_FY]) || 0) : 0;
              const Fz = COL_FZ >= 0 ? Math.abs(Number(row[COL_FZ]) || 0) : 0;
              const Mz = COL_MZ >= 0 ? Math.abs(Number(row[COL_MZ]) || 0) : 0;
              if (!ptMap.has(ptName)) ptMap.set(ptName, { Fzs: [], Fxs: [], Fys: [], Mzs: [], cases: new Set() });
              const e = ptMap.get(ptName)!;
              e.Fzs.push(Fz); e.Fxs.push(Fx); e.Fys.push(Fy); e.Mzs.push(Mz);
              e.cases.add(caseStr);
            }
            for (const [pointId, { Fzs, Fxs, Fys, Mzs, cases }] of ptMap) {
              const maxFz = Math.max(...Fzs);
              if (maxFz < 0.1) continue;
              reactions.push({
                pointId, story: 'Base',
                Fz: +maxFz.toFixed(3),
                Fx: +Math.max(...Fxs).toFixed(3),
                Fy: +Math.max(...Fys).toFixed(3),
                Mz: +Math.max(...Mzs).toFixed(3),
                combCount: cases.size,
              });
            }
          }

          if (reactions.length === 0) {
            setEtabsLoadingStatus('✗ لم يُعثر على ردود أفعال — تأكد من اسم الورقة (Support Reactions)');
          } else {
            setEtabsFileReacts(reactions);
            setEtabsLoadingStatus(`✓ تم استيراد ${reactions.length} ردّة فعل`);
          }
        } catch {
          setEtabsLoadingStatus('✗ خطأ في قراءة الملف');
        }
      };
      reader.readAsArrayBuffer(file);
    } catch {
      setEtabsLoadingStatus('✗ خطأ في قراءة الملف');
    }
    if (e.target) e.target.value = '';
  }, []);

  // ── Run design ─────────────────────────────────────────────────────────────
  const handleDesign = () => {
    if (activeLoads.length === 0) return;
    const footingMat: FootingMaterials = {
      fc, fy, qa, cover, gamma_conc: gammaConc, gamma_soil: gammaSoil, Df,
    };
    const res = activeLoads.map(load => {
      const reaction: ColumnReactionInput = {
        colId: load.colId,
        x: load.x,
        y: load.y,
        P_DL: load.P_DL,
        P_LL: load.P_LL,
        colB: load.colB,
        colH: load.colH,
      };
      return designFooting(reaction, footingMat);
    });
    setResults(res);
    setDesigned(true);
    onResultsChange?.(res, footingMat);
  };

  // ── Export results CSV ──────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (results.length === 0) return;
    const header = 'العمود,P_service (kN),B (mm),L (mm),t (mm),d (mm),q_actual (kN/m²),تسليح_B,تسليح_L,قص_عريض,ثقب,مناسب';
    const rows = results.map(r =>
      `${r.colId},${r.P_service.toFixed(1)},${r.B},${r.L},${r.t},${r.d},${r.q_actual.toFixed(1)},${r.bars_x}Φ${r.dia_x}@${r.spacing_x},${r.bars_y}Φ${r.dia_y}@${r.spacing_y},${r.wide_shear_ok ? 'آمن' : 'تجاوز'},${r.punch_shear_ok ? 'آمن' : 'تجاوز'},${r.adequate ? 'نعم' : 'لا'}`
    );
    downloadCSV('foundation_design.csv', header + '\n' + rows.join('\n'));
  };

  // ── Export results DXF (matches the on-screen design tables exactly) ──────
  const handleExportDXF = () => {
    if (results.length === 0) return;
    const dxfInputs: FoundationDXFInput[] = results.map(r => ({
      colId: r.colId,
      x: r.x,
      y: r.y,
      colB: r.colB,
      colH: r.colH,
      B: r.B,
      L: r.L,
      t: r.t,
      d: r.d,
      P_service: r.P_service,
      q_actual: r.q_actual,
      bars_x: r.bars_x,
      dia_x: r.dia_x,
      spacing_x: r.spacing_x,
      bars_y: r.bars_y,
      dia_y: r.dia_y,
      spacing_y: r.spacing_y,
      bearing_ok: r.bearing_ok,
      wide_shear_ok: r.wide_shear_ok,
      punch_shear_ok: r.punch_shear_ok,
      adequate: r.adequate,
    }));
    const footingMat = {
      fc, fy, qa, cover, gamma_conc: gammaConc, gamma_soil: gammaSoil, Df,
    };
    const projectName = titleBlockConfig?.projectName || 'Foundation_Plan';
    const dxf = generateFoundationDXF(dxfInputs, footingMat, projectName);
    downloadDXF(dxf, `${projectName}_Foundations.dxf`);
  };

  // ── Summary stats ──────────────────────────────────────────────────────────
  const allOk = results.length > 0 && results.every(r => r.adequate);
  const failCount = results.filter(r => !r.adequate).length;

  return (
    <div className="space-y-4">

      {/* ── METHOD INFO HEADER ─────────────────────────────────────────── */}
      <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-500/5">
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info size={13} className="mt-0.5 shrink-0 text-emerald-600" />
            <div>
              تصميم الأساسات المنفردة بطريقة <strong className="text-foreground">Working Stress Method (ASD)</strong> وفق <strong className="text-foreground">UBC 1997 / ACI 318</strong>.
              يتم تحديد أبعاد القاعدة بحيث لا يتجاوز ضغط التربة الفعلي المقاومة المسموح بها، ثم يُصمَّم التسليح بطريقة الإجهادات العاملة.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── LOAD SOURCE SELECTOR ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload size={14} />
            مصدر أحمال الأعمدة (القوى العمودية)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'app', label: 'محركات التطبيق', desc: 'من نتائج التحليل الداخلي' },
              { key: 'etabs', label: 'ردود أفعال ETABS', desc: 'استيراد من xlsx' },
              { key: 'manual', label: 'إدخال يدوي', desc: 'أدخل الأحمال مباشرة' },
            ].map(opt => (
              <button
                key={opt.key}
                className={`px-2 py-2 rounded border text-xs font-medium transition-all text-center ${
                  loadSource === opt.key
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'border-border hover:bg-muted'
                }`}
                onClick={() => { setLoadSource(opt.key as any); setDesigned(false); }}
              >
                <div>{opt.label}</div>
                <div className={`text-[10px] mt-0.5 ${loadSource === opt.key ? 'text-emerald-100' : 'text-muted-foreground'}`}>{opt.desc}</div>
              </button>
            ))}
          </div>

          {/* App loads summary */}
          {loadSource === 'app' && (
            <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2">
              {appColLoads.length === 0
                ? '⚠ لم يُنفَّذ التحليل بعد — شغّل التحليل من تبويب التحليل أولاً'
                : `✓ تم اكتشاف ${appColLoads.length} عمود من نتائج التحليل. الأحمال تقريبية (DL=60%، LL=40% من الحمل المضروب).`
              }
            </div>
          )}

          {/* ETABS file import */}
          {loadSource === 'etabs' && (
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleEtabsFile} />
              <Button
                variant="outline"
                className="w-full gap-2 border-orange-300 hover:bg-orange-50 text-sm min-h-[40px]"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={15} className="text-orange-500" />
                استيراد ملف ردود الأفعال من ETABS (xlsx)
              </Button>
              {etabsLoadingStatus && (
                <p className={`text-xs px-2 py-1 rounded ${
                  etabsLoadingStatus.startsWith('✓')
                    ? 'text-green-700 bg-green-50'
                    : etabsLoadingStatus.startsWith('✗')
                    ? 'text-destructive bg-destructive/10'
                    : 'text-muted-foreground bg-muted/40'
                }`}>
                  {etabsLoadingStatus}
                </p>
              )}
              {etabsFileReacts.length > 0 && (
                <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2">
                  ✓ {etabsFileReacts.length} ردّة فعل محمّلة — سيتم استخدام Fz العظمى لكل نقطة
                </div>
              )}
              {/* ETABS reactions if passed from parent */}
              {etabsReactions && etabsReactions.length > 0 && etabsFileReacts.length === 0 && (
                <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2">
                  ✓ {etabsReactions.length} ردّة فعل محمّلة مسبقاً من الاستيراد السابق
                </div>
              )}
            </div>
          )}

          {/* Manual loads table */}
          {loadSource === 'manual' && (
            <div className="space-y-2">
              <div className="overflow-x-auto rounded border border-border">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="bg-muted/50">
                      {['العمود','P_DL (kN)','P_LL (kN)','b عمود (mm)','h عمود (mm)'].map(h => (
                        <th key={h} className="text-center px-2 py-1.5 font-medium border-b">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {manualLoads.map((load, idx) => (
                      <tr key={load.colId} className="border-b last:border-0">
                        <td className="px-2 py-1 font-mono font-bold">{load.colId}</td>
                        {(['P_DL', 'P_LL', 'colB', 'colH'] as const).map(field => (
                          <td key={field} className="px-1 py-0.5">
                            <input
                              type="number"
                              value={load[field]}
                              onChange={e => {
                                const v = parseFloat(e.target.value) || 0;
                                setManualLoads(prev => prev.map((l, i) => i === idx ? { ...l, [field]: v } : l));
                              }}
                              className="w-full h-7 rounded border border-input bg-background px-1.5 font-mono text-xs text-center"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {manualLoads.length === 0 && (
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setManualLoads([{ colId: 'C1', P_DL: 200, P_LL: 100, colB: 300, colH: 300, x: 0, y: 0 }])}>
                  + إضافة عمود
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── MATERIAL & SOIL INPUTS ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Settings2 size={14} />المعطيات والخصائص</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            <ParamField label="f'c" value={fc} onChange={setFc} unit="MPa" />
            <ParamField label="fy" value={fy} onChange={setFy} unit="MPa" />
            <ParamField label="مقاومة التربة qa" value={qa} onChange={setQa} unit="kN/m²" min={50} />
            <ParamField label="عمق الأساس Df" value={Df} onChange={setDf} unit="m" min={0.5} />
            <ParamField label="الغطاء الخرساني" value={cover} onChange={setCover} unit="mm" />
            <ParamField label="وزن التربة γs" value={gammaSoil} onChange={setGammaSoil} unit="kN/m³" />
            <ParamField label="وزن الخرسانة γc" value={gammaConc} onChange={setGammaConc} unit="kN/m³" />
          </div>

          <div className="mt-3 p-2 bg-muted/40 rounded text-[11px] text-muted-foreground space-y-0.5">
            <div>fc,allow = 0.45 × f'c = <strong className="text-foreground">{(0.45 * fc).toFixed(1)} MPa</strong></div>
            <div>fs,allow = min(0.5 × fy, 207) = <strong className="text-foreground">{Math.min(0.5 * fy, 207).toFixed(0)} MPa</strong></div>
            <div>n = Es/Ec = <strong className="text-foreground">{Math.max(6, Math.round(200000 / (4700 * Math.sqrt(fc))))}</strong></div>
          </div>
        </CardContent>
      </Card>

      {/* ── DESIGN BUTTON ─────────────────────────────────────────────────── */}
      <Button
        className="w-full min-h-[52px] gap-2 text-sm font-bold bg-emerald-700 hover:bg-emerald-800 text-white"
        disabled={activeLoads.length === 0}
        onClick={handleDesign}
      >
        <Calculator size={18} />
        تشغيل تصميم الأساسات ({activeLoads.length} عمود)
        {designed && results.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {allOk ? 'الكل آمن ✓' : `${failCount} تجاوز`}
          </Badge>
        )}
      </Button>

      {/* ── RESULTS ───────────────────────────────────────────────────────── */}
      {designed && results.length > 0 && (
        <div className="space-y-4">

          {/* Summary status */}
          <Card className={`border-2 ${allOk ? 'border-green-400 bg-green-500/5' : 'border-red-400 bg-red-500/5'}`}>
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-3 flex-wrap">
                {allOk
                  ? <><Check size={16} className="text-green-600" /><span className="text-green-700 font-semibold text-sm">جميع الأساسات مصممة بأمان ✓</span></>
                  : <><AlertTriangle size={16} className="text-red-600" /><span className="text-red-700 font-semibold text-sm">{failCount} أساس يتطلب مراجعة</span></>
                }
                <div className="flex gap-1 mr-auto">
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={handleExportCSV}>
                    <Download size={12} /> CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                    onClick={handleExportDXF}
                    title="تصدير لوحة الأساسات + الجداول إلى ملف DXF متوافق مع AutoCAD"
                  >
                    <Download size={12} /> DXF
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Main results table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">جدول تصميم الأساسات المنفردة - Working Stress Method / UBC 1997</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      'العمود','P service','B×L (mm)','t (mm)','d (mm)','q فعلي','ضغط التربة',
                      'تسليح اتجاه B','تسليح اتجاه L','قص عريض','قص ثقبي','الحالة'
                    ].map(h => <TableHead key={h} className="text-[10px] whitespace-nowrap">{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map(r => (
                    <React.Fragment key={r.colId}>
                      <TableRow
                        className={`cursor-pointer ${!r.adequate ? 'bg-red-50 dark:bg-red-950/20' : ''}`}
                        onClick={() => setExpandedRow(expandedRow === r.colId ? null : r.colId)}
                      >
                        <TableCell className="font-mono text-xs font-bold">{r.colId}</TableCell>
                        <TableCell className="font-mono text-xs">{r.P_service.toFixed(0)} kN</TableCell>
                        <TableCell className="font-mono text-xs font-semibold">{r.B}×{r.L}</TableCell>
                        <TableCell className="font-mono text-xs">{r.t}</TableCell>
                        <TableCell className="font-mono text-xs">{r.d}</TableCell>
                        <TableCell className="font-mono text-xs">{r.q_actual.toFixed(0)}</TableCell>
                        <TableCell><StatusBadge ok={r.bearing_ok} /></TableCell>
                        <TableCell className="font-mono text-xs text-red-700 font-semibold">
                          {r.bars_x}Ø{r.dia_x}@{r.spacing_x}mm
                        </TableCell>
                        <TableCell className="font-mono text-xs text-red-700 font-semibold">
                          {r.bars_y}Ø{r.dia_y}@{r.spacing_y}mm
                        </TableCell>
                        <TableCell><StatusBadge ok={r.wide_shear_ok} /></TableCell>
                        <TableCell><StatusBadge ok={r.punch_shear_ok} /></TableCell>
                        <TableCell><StatusBadge ok={r.adequate} /></TableCell>
                      </TableRow>

                      {/* Expanded detail row */}
                      {expandedRow === r.colId && (
                        <TableRow className="bg-muted/20">
                          <TableCell colSpan={12} className="py-3 px-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                              <div className="space-y-1">
                                <p className="font-bold text-xs">أبعاد القاعدة</p>
                                <p>B × L = {r.B} × {r.L} mm</p>
                                <p>السُّمك الكلي t = {r.t} mm</p>
                                <p>العمق الفعّال d = {r.d} mm</p>
                                <p>كابولي a_x = {r.a_x.toFixed(0)} mm</p>
                                <p>كابولي a_y = {r.a_y.toFixed(0)} mm</p>
                              </div>
                              <div className="space-y-1">
                                <p className="font-bold text-xs">ضغط التربة</p>
                                <p>P_service = {r.P_service.toFixed(1)} kN</p>
                                <p>q_net_allow = {r.q_net_allow.toFixed(1)} kN/m²</p>
                                <p>q_actual = {r.q_actual.toFixed(1)} kN/m²</p>
                                <p className={r.bearing_ok ? 'text-green-700' : 'text-red-700 font-bold'}>
                                  {r.bearing_ok ? '✓ q_actual ≤ q_allow' : '✗ تجاوز ضغط التربة'}
                                </p>
                              </div>
                              <div className="space-y-1">
                                <p className="font-bold text-xs">الانحناء (WSM)</p>
                                <p>M_x = {r.M_x.toFixed(2)} kN·m/m</p>
                                <p>As_x_req = {r.As_x_req.toFixed(0)} mm²/m</p>
                                <p>As_x_min = {r.As_min_pm.toFixed(0)} mm²/m</p>
                                <p>As_x_use = {r.As_x_use.toFixed(0)} mm²/m</p>
                                <p>M_y = {r.M_y.toFixed(2)} kN·m/m</p>
                                <p>As_y_use = {r.As_y_use.toFixed(0)} mm²/m</p>
                              </div>
                              <div className="space-y-1">
                                <p className="font-bold text-xs">ثوابت WSM (ACI 318 App.B)</p>
                                <p className="text-amber-700">fc_allow = 0.45×f'c = {r.fc_allow.toFixed(1)} MPa</p>
                                <p className="text-amber-700">fs_allow = min(0.5fy,207) = {r.fs_allow.toFixed(0)} MPa</p>
                                <p>n = Es/Ec = {r.n}</p>
                                <p>k = {r.k.toFixed(3)} , j = {r.j.toFixed(3)}</p>
                                <p className="font-bold text-xs mt-1">السُّمك الأدنى</p>
                                <p>t_min (ACI §13.3) = {r.t_min_aci} mm</p>
                                <p>t مختار = {r.t} mm</p>
                                <p className="font-bold text-xs mt-1">القص</p>
                                <p>Vu_wide = {r.Vu_wide.toFixed(1)} kN</p>
                                <p>Vc_wide = {r.Vc_wide.toFixed(1)} kN</p>
                                <p>Vu_punch = {r.Vu_punch.toFixed(1)} kN</p>
                                <p>Vc_punch = {r.Vc_punch.toFixed(1)} kN</p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* As reinforcement summary table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">جدول مساحة التسليح المطلوبة للأساسات (mm²/m)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {['العمود','As_x_req (mm²/m)','As_x_min (mm²/m)','As_x_use (mm²/m)','As_y_req (mm²/m)','As_y_min (mm²/m)','As_y_use (mm²/m)','التسليح المختار B','التسليح المختار L'].map(h => (
                      <TableHead key={h} className="text-[10px] whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map(r => (
                    <TableRow key={r.colId}>
                      <TableCell className="font-mono text-xs font-bold">{r.colId}</TableCell>
                      <TableCell className="font-mono text-xs">{r.As_x_req.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-xs text-amber-700">{r.As_min_pm.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-xs font-bold text-blue-700">{r.As_x_use.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.As_y_req.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-xs text-amber-700">{r.As_min_pm.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-xs font-bold text-blue-700">{r.As_y_use.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-xs font-bold text-red-700">{r.bars_x}Ø{r.dia_x}@{r.spacing_x}mm</TableCell>
                      <TableCell className="font-mono text-xs font-bold text-red-700">{r.bars_y}Ø{r.dia_y}@{r.spacing_y}mm</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Methodology note */}
          <Card className="border-dashed">
            <CardHeader className="pb-1">
              <button
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground w-full text-right"
                onClick={() => setShowMethodology(v => !v)}
              >
                <BookOpen size={13} />
                منهجية التصميم (Working Stress Method - UBC 1997)
                {showMethodology ? <ChevronUp size={12} className="mr-auto" /> : <ChevronDown size={12} className="mr-auto" />}
              </button>
            </CardHeader>
            {showMethodology && (
              <CardContent className="text-[11px] space-y-2 text-muted-foreground">
                <div className="rounded bg-amber-50 border border-amber-200 p-2 mb-2">
                  <p className="font-bold text-amber-800 mb-1">تخفيضات إجهادات WSM (ACI 318 Appendix B)</p>
                  <p className="text-amber-700">• <b>fc_allow = 0.45 × f'c</b>  ← إجهاد ضغط الخرسانة المسموح</p>
                  <p className="text-amber-700">• <b>fs_allow = min(0.5 × fy , 207 MPa)</b>  ← إجهاد حديد التسليح المسموح</p>
                  <p className="text-amber-700">• <b>n = Es / Ec = 200000 / (4700√f'c)</b>  ← نسبة المعاملات المرنة</p>
                  <p className="text-amber-700">• k = n·ρ·(√(1 + 2/(nρ)) − 1)  ,  j = 1 − k/3</p>
                </div>
                <p className="font-semibold text-foreground">١- تحديد أبعاد القاعدة (مستطيلة بنسبة عمود):</p>
                <p>• q_net_allow = qa − γ_soil×(Df−t) − γ_conc×t</p>
                <p>• aspect = colH / colB  →  B×L = P / q_net_allow</p>
                <p>• t_min (ACI §13.3.1.2) = max(300, cover+150+32) mm</p>
                <p>• تقريب الأبعاد لأقرب 50 mm</p>
                <p className="font-semibold text-foreground">٢- تصميم التسليح (WSM):</p>
                <p>• M = q_act × a² / 2  (a = كابولي عند وجه العمود)</p>
                <p>• As = M×10⁶ / (fs_allow × j × d)</p>
                <p>• As_min = ρ_min×b×d  (ρ_min = 0.0018 لـ fy≥420 أو 0.002)</p>
                <p>• Ø_min = 16 mm  (حسب المعيار الخليجي GSO)</p>
                <p className="font-semibold text-foreground">٣- فحص القص:</p>
                <p>• قص عريض: vc = 0.083√f'c MPa  (ACI 318 App.A)</p>
                <p>• قص ثقبي: vc = min(0.083(2+4/βc)√f'c, 0.166√f'c) MPa</p>
                <p>• b₀ = 2[(bc+d)+(hc+d)]  عند d/2 من وجه العمود</p>
                <p className="font-semibold text-foreground">٤- تكرار التصميم:</p>
                <p>• t يبدأ من t_min_aci ويزداد 50mm إذا تجاوز القص الحد المسموح.</p>
              </CardContent>
            )}
          </Card>
        </div>
      )}

      {/* Empty state */}
      {!designed && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            {activeLoads.length === 0
              ? 'لا توجد أعمدة محمّلة — اختر مصدر الأحمال ثم اضغط "تشغيل التصميم"'
              : `${activeLoads.length} عمود جاهز — اضغط "تشغيل تصميم الأساسات"`
            }
          </CardContent>
        </Card>
      )}
    </div>
  );
}
