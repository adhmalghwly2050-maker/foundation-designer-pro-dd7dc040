/**
 * ETABSAnalysisImport — استيراد نتائج التحليل من ETABS
 * يدعم:
 *   ١- Element Forces - Beams  → عزوم وقص الجسور
 *   ٢- Element Forces - Columns → قوى الأعمدة (محوري + عزوم)
 *   ٣- Support Reactions / Joint Reactions → ردود الأفعال عند القواعد
 */

import React, { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Upload, Check, Eye, ChevronDown, ChevronUp, Info, AlertTriangle } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ETABSBeamResult {
  beamId: string;
  story: string;
  Mleft: number;   // kN-m (hogging left support)
  Mmid: number;    // kN-m (sagging midspan)
  Mright: number;  // kN-m (hogging right support)
  Vu: number;      // kN (max shear)
  combCount: number;
  stationCount: number;
}

export interface ETABSColumnResult {
  colId: string;
  story: string;
  P: number;       // kN (max axial — compression positive)
  M2: number;      // kN-m (moment about local 2 axis)
  M3: number;      // kN-m (moment about local 3 axis)
  V2: number;      // kN shear
  V3: number;      // kN shear
  combCount: number;
}

export interface ETABSReaction {
  pointId: string;  // joint/point label
  story: string;
  Fz: number;   // kN vertical reaction (positive = upward from structure, i.e. column compression)
  Fx: number;   // kN
  Fy: number;   // kN
  Mz: number;   // kN-m
  combCount: number;
}

interface Props {
  onApplyBeams: (results: ETABSBeamResult[]) => void;
  onApplyColumns?: (results: ETABSColumnResult[]) => void;
  onApplyReactions?: (results: ETABSReaction[]) => void;
  appliedBeamCount?: number;
  appliedColCount?: number;
  appliedReactionCount?: number;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseETABSWorkbook(file: File): Promise<{
  beams: ETABSBeamResult[];
  columns: ETABSColumnResult[];
  reactions: ETABSReaction[];
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });

        const beams: ETABSBeamResult[] = [];
        const columns: ETABSColumnResult[] = [];
        const reactions: ETABSReaction[] = [];

        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
          if (rows.length < 3) continue;

          const nameLower = sheetName.toLowerCase();

          // ── مساعد: ابحث عن صف الترويسة في أول 8 صفوف ──────────────────
          // يتجاهل صفوف العنوان (TABLE: ...) التي تحتوي على خلية واحدة فقط
          const findHeaderRow = (searchTerms: string[]): { hdr: string[]; dataStart: number } => {
            for (let ri = 0; ri < Math.min(8, rows.length); ri++) {
              const row = rows[ri] || [];
              // تخطي الصفوف التي تحتوي على أقل من 3 خلايا غير فارغة (صفوف العنوان TABLE:)
              const nonEmpty = row.filter((c: any) => c != null && String(c).trim() !== '');
              if (nonEmpty.length < 3) continue;
              const candidate = row.map((h: any) => String(h ?? '').toLowerCase().trim());
              // تخطي الصفوف التي تبدأ بـ "table:"
              if (candidate[0]?.startsWith('table:')) continue;
              if (searchTerms.some(t => candidate.some(c => c.includes(t)))) {
                return { hdr: candidate, dataStart: ri + 1 };
              }
            }
            return { hdr: (rows[0] || []).map((h: any) => String(h ?? '').toLowerCase().trim()), dataStart: 1 };
          };

          // ── مساعد: إيجاد فهرس العمود بشكل مرن ──────────────────────────
          // الأولوية: مطابقة دقيقة → ثم مطابقة بعد حذف المسافات → ثم substring للمصطلحات الطويلة فقط
          const findCol = (hdr: string[], terms: string[], fallback: number): number => {
            // المرور الأول: مطابقة دقيقة أو دقيقة بعد حذف المسافات
            for (const term of terms) {
              const idx = hdr.findIndex(h => h === term || h.replace(/\s+/g, '') === term);
              if (idx >= 0) return idx;
            }
            // المرور الثاني: substring فقط للمصطلحات الأطول من حرفين (لتجنب 'p' تطابق 'output case')
            for (const term of terms) {
              if (term.length <= 2) continue;
              const idx = hdr.findIndex(h => h.includes(term));
              if (idx >= 0) return idx;
            }
            return fallback;
          };

          // ── BEAMS ─────────────────────────────────────────────────────────
          if (nameLower.includes('beam') || nameLower.includes('frame')) {
            const { hdr, dataStart } = findHeaderRow(['beam', 'frame', 'story']);
            const COL_STORY   = findCol(hdr, ['story'], 0);
            const COL_BEAM    = findCol(hdr, ['beam', 'frame', 'framename', 'element'], 1);
            const COL_CASE    = findCol(hdr, ['outputcase', 'output case', 'loadcase', 'load case', 'case'], 3);
            const COL_STATION = findCol(hdr, ['station', 'distancefromei', 'distancefromendi', 'station(m)'], 5);
            const COL_V2      = findCol(hdr, ['v2', 'v2(kn)', 'shear v2', 'sheary'], 7);
            const COL_M3      = findCol(hdr, ['m3', 'm3(kn-m)', 'moment m3', 'momentz', 'mz'], 11);

            type Pt = { station: number; m3: number; v2: number };
            const beamMap = new Map<string, { story: string; beamName: string; pts: Pt[]; cases: Set<string> }>();

            for (let i = dataStart; i < rows.length; i++) {
              const row = rows[i];
              if (!row || row.length < 3) continue;
              const beamName = String(row[COL_BEAM] ?? '').trim();
              if (!beamName || beamName.toLowerCase() === 'beam' || beamName.toLowerCase() === 'frame') continue;
              // تخطي الصفوف الأرقام التي تبدو وكأنها ترويسات متكررة
              if (isNaN(Number(row[COL_STATION])) && String(row[COL_STATION] ?? '').toLowerCase().includes('station')) continue;
              const story = String(row[COL_STORY] ?? '').trim();
              const caseStr = String(row[COL_CASE] ?? '').trim();
              const station = Number(row[COL_STATION]) || 0;
              const v2 = Number(row[COL_V2]) || 0;
              const m3 = Number(row[COL_M3]) || 0;
              const mapKey = story ? `${story}_${beamName}` : beamName;
              if (!beamMap.has(mapKey)) beamMap.set(mapKey, { story, beamName, pts: [], cases: new Set() });
              const entry = beamMap.get(mapKey)!;
              entry.pts.push({ station, m3, v2 });
              entry.cases.add(caseStr);
            }

            for (const [, { story, beamName: beamId, pts, cases }] of beamMap) {
              if (pts.length === 0) continue;
              const stations = pts.map(p => p.station);
              const minSt = Math.min(...stations), maxSt = Math.max(...stations);
              const beamLen = maxSt - minSt;
              const leftZone = minSt + beamLen * 0.25;
              const rightZone = maxSt - beamLen * 0.25;
              let Mleft = 0, Mmid = 0, Mright = 0, Vu = 0;
              for (const pt of pts) {
                if (Math.abs(pt.v2) > Vu) Vu = Math.abs(pt.v2);
                if (pt.station <= leftZone && Math.abs(pt.m3) > Mleft) Mleft = Math.abs(pt.m3);
                if (pt.station >= rightZone && Math.abs(pt.m3) > Mright) Mright = Math.abs(pt.m3);
                if (pt.m3 > Mmid) Mmid = pt.m3;
              }
              beams.push({ beamId, story, Mleft: +Mleft.toFixed(3), Mmid: +Mmid.toFixed(3), Mright: +Mright.toFixed(3), Vu: +Vu.toFixed(3), combCount: cases.size, stationCount: pts.length });
            }
            beams.sort((a, b) => a.story.localeCompare(b.story) || a.beamId.localeCompare(b.beamId));
          }

          // ── COLUMNS ───────────────────────────────────────────────────────
          else if (nameLower.includes('column') || nameLower.includes('col')) {
            const { hdr: hdrC, dataStart: dsC } = findHeaderRow(['column', 'col', 'story']);
            const COL_STORY = findCol(hdrC, ['story'], 0);
            const COL_COL   = findCol(hdrC, ['column', 'col', 'frame', 'element'], 1);
            const COL_CASE  = findCol(hdrC, ['outputcase', 'output case', 'loadcase', 'case'], 3);
            const COL_P     = findCol(hdrC, ['p', 'axial', 'p(kn)', 'axialforce'], 6);
            const COL_V2    = findCol(hdrC, ['v2', 'v2(kn)', 'sheary'], 7);
            const COL_V3    = findCol(hdrC, ['v3', 'v3(kn)', 'shearz'], 8);
            const COL_M2    = findCol(hdrC, ['m2', 'm2(kn-m)', 'momenty'], 10);
            const COL_M3    = findCol(hdrC, ['m3', 'm3(kn-m)', 'momentz'], 11);

            type CPt = { P: number; M2: number; M3: number; V2: number; V3: number };
            const colMap = new Map<string, { story: string; colName: string; pts: CPt[]; cases: Set<string> }>();

            for (let i = dsC; i < rows.length; i++) {
              const row = rows[i];
              if (!row || row.length < 3) continue;
              const colName = String(row[COL_COL] ?? '').trim();
              if (!colName || colName.toLowerCase() === 'column' || colName.toLowerCase() === 'col') continue;
              const story = String(row[COL_STORY] ?? '').trim();
              const caseStr = String(row[COL_CASE] ?? '').trim();
              const P  = -Math.abs(Number(row[COL_P])  || 0);  // compression = negative in ETABS
              const V2 = Number(row[COL_V2]) || 0;
              const V3 = Number(row[COL_V3]) || 0;
              const M2 = Number(row[COL_M2]) || 0;
              const M3 = Number(row[COL_M3]) || 0;
              const mapKey = story ? `${story}_${colName}` : colName;
              if (!colMap.has(mapKey)) colMap.set(mapKey, { story, colName, pts: [], cases: new Set() });
              const entry = colMap.get(mapKey)!;
              entry.pts.push({ P, M2, M3, V2, V3 });
              entry.cases.add(caseStr);
            }

            for (const [, { story, colName: colId, pts, cases }] of colMap) {
              if (pts.length === 0) continue;
              let maxP = 0, maxM2 = 0, maxM3 = 0, maxV2 = 0, maxV3 = 0;
              for (const pt of pts) {
                if (Math.abs(pt.P)  > maxP)  maxP  = Math.abs(pt.P);
                if (Math.abs(pt.M2) > maxM2) maxM2 = Math.abs(pt.M2);
                if (Math.abs(pt.M3) > maxM3) maxM3 = Math.abs(pt.M3);
                if (Math.abs(pt.V2) > maxV2) maxV2 = Math.abs(pt.V2);
                if (Math.abs(pt.V3) > maxV3) maxV3 = Math.abs(pt.V3);
              }
              columns.push({ colId, story, P: +maxP.toFixed(3), M2: +maxM2.toFixed(3), M3: +maxM3.toFixed(3), V2: +maxV2.toFixed(3), V3: +maxV3.toFixed(3), combCount: cases.size });
            }
            columns.sort((a, b) => a.story.localeCompare(b.story) || a.colId.localeCompare(b.colId));
          }

          // ── REACTIONS ─────────────────────────────────────────────────────
          else if (nameLower.includes('reaction') || nameLower.includes('support') || nameLower.includes('joint')) {
            const { hdr: hdrR, dataStart: dsR } = findHeaderRow(['point', 'joint', 'reaction', 'story']);
            const COL_STORY = findCol(hdrR, ['story'], -1);
            const COL_PT    = findCol(hdrR, ['point', 'joint', 'uniquename', 'unique name'], 1);
            const COL_CASE  = findCol(hdrR, ['outputcase', 'output case', 'loadcase', 'case'], 2);
            const COL_FX    = findCol(hdrR, ['fx', 'f1', 'fx(kn)'], -1);
            const COL_FY    = findCol(hdrR, ['fy', 'f2', 'fy(kn)'], -1);
            const COL_FZ    = findCol(hdrR, ['fz', 'f3', 'fz(kn)'], -1);
            const COL_MZ    = findCol(hdrR, ['mz', 'm3', 'mz(kn-m)'], -1);

            const ptMap = new Map<string, { story: string; Fzs: number[]; Fxs: number[]; Fys: number[]; Mzs: number[]; cases: Set<string> }>();

            for (let i = dsR; i < rows.length; i++) {
              const row = rows[i];
              if (!row || row.length < 4) continue;
              const ptName = String(row[COL_PT] ?? '').trim();
              if (!ptName) continue;
              const story = COL_STORY >= 0 ? String(row[COL_STORY] ?? '').trim() : 'Base';
              const caseStr = String(row[COL_CASE] ?? '').trim();
              const Fx = COL_FX >= 0 ? Number(row[COL_FX]) || 0 : 0;
              const Fy = COL_FY >= 0 ? Number(row[COL_FY]) || 0 : 0;
              const Fz = COL_FZ >= 0 ? Number(row[COL_FZ]) || 0 : 0;
              const Mz = COL_MZ >= 0 ? Number(row[COL_MZ]) || 0 : 0;
              if (!ptMap.has(ptName)) ptMap.set(ptName, { story, Fzs: [], Fxs: [], Fys: [], Mzs: [], cases: new Set() });
              const e = ptMap.get(ptName)!;
              e.Fzs.push(Math.abs(Fz));
              e.Fxs.push(Math.abs(Fx));
              e.Fys.push(Math.abs(Fy));
              e.Mzs.push(Math.abs(Mz));
              e.cases.add(caseStr);
            }

            for (const [pointId, { story, Fzs, Fxs, Fys, Mzs, cases }] of ptMap) {
              const maxFz = Math.max(...Fzs);
              const maxFx = Math.max(...Fxs);
              const maxFy = Math.max(...Fys);
              const maxMz = Math.max(...Mzs);
              if (maxFz < 0.1) continue;  // skip zero reactions
              reactions.push({ pointId, story, Fz: +maxFz.toFixed(3), Fx: +maxFx.toFixed(3), Fy: +maxFy.toFixed(3), Mz: +maxMz.toFixed(3), combCount: cases.size });
            }
            reactions.sort((a, b) => a.story.localeCompare(b.story) || a.pointId.localeCompare(b.pointId));
          }
        }

        resolve({ beams, columns, reactions });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ETABSAnalysisImport({
  onApplyBeams,
  onApplyColumns,
  onApplyReactions,
  appliedBeamCount = 0,
  appliedColCount = 0,
  appliedReactionCount = 0,
}: Props) {
  const [beams, setBeams] = useState<ETABSBeamResult[]>([]);
  const [cols, setCols]   = useState<ETABSColumnResult[]>([]);
  const [reacts, setReacts] = useState<ETABSReaction[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [previewTab, setPreviewTab] = useState<'beams' | 'columns' | 'reactions'>('beams');
  const [showPreview, setShowPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setStatus('');
    try {
      const parsed = await parseETABSWorkbook(file);
      setBeams(parsed.beams);
      setCols(parsed.columns);
      setReacts(parsed.reactions);
      const parts = [];
      if (parsed.beams.length > 0) parts.push(`${parsed.beams.length} جسر`);
      if (parsed.columns.length > 0) parts.push(`${parsed.columns.length} عمود`);
      if (parsed.reactions.length > 0) parts.push(`${parsed.reactions.length} ردّة فعل`);
      if (parts.length === 0) {
        setStatus('لم يتم العثور على بيانات — تأكد من تسمية أوراق الملف (Beams / Columns / Reactions)');
      } else {
        setStatus(`✓ تم قراءة: ${parts.join(' | ')}`);
        setShowPreview(true);
        if (parsed.beams.length > 0) setPreviewTab('beams');
        else if (parsed.columns.length > 0) setPreviewTab('columns');
        else setPreviewTab('reactions');
      }
    } catch {
      setStatus('✗ خطأ في قراءة الملف');
    }
    setLoading(false);
    if (e.target) e.target.value = '';
  }, []);

  const totalApplied = appliedBeamCount + appliedColCount + appliedReactionCount;

  return (
    <Card className="border-orange-200 dark:border-orange-800">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload size={15} className="text-orange-500" />
            استيراد نتائج التحليل من ETABS
            {totalApplied > 0 && (
              <Badge variant="default" className="text-[10px] bg-green-600">
                {appliedBeamCount > 0 && `${appliedBeamCount} جسر`}
                {appliedColCount > 0 && ` | ${appliedColCount} عمود`}
                {appliedReactionCount > 0 && ` | ${appliedReactionCount} ردّة`}
              </Badge>
            )}
          </CardTitle>
          <button onClick={() => setShowGuide(v => !v)} className="text-muted-foreground hover:text-foreground">
            {showGuide ? <ChevronUp size={14} /> : <Info size={14} />}
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Guide */}
        {showGuide && (
          <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3 text-xs space-y-2">
            <p className="font-semibold text-orange-700 dark:text-orange-300">صيغة ملف ETABS (xlsx) المطلوبة:</p>
            <p>يجب أن يحتوي الملف على ورقات (Sheets) باسم واضح:</p>
            <ul className="space-y-1 mr-3 list-disc text-muted-foreground">
              <li><b className="text-foreground">Element Forces - Beams</b> — لاستيراد عزوم وقص الجسور (أعمدة: Story, Beam, Output Case, Station, V2, M3)</li>
              <li><b className="text-foreground">Element Forces - Columns</b> — لاستيراد قوى الأعمدة (أعمدة: Story, Column, Output Case, P, V2, V3, M2, M3)</li>
              <li><b className="text-foreground">Support Reactions</b> أو <b className="text-foreground">Joint Reactions</b> — لردود الأفعال (أعمدة: Story, Point, Output Case, Fx, Fy, Fz)</li>
            </ul>
            <p className="text-muted-foreground">من ETABS: <b>Display → Show Tables → Analysis Results</b> ثم اختر الجدول المناسب وصدّره بصيغة Excel</p>
            <div className="flex items-start gap-1 text-amber-700 dark:text-amber-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>Fz في جدول ردود الأفعال هي القوة العمودية (ضغط = موجب) المستخدمة لتصميم الأساسات</span>
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />

        <Button
          variant="outline"
          className="w-full min-h-[44px] gap-2 border-orange-300 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/30"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
        >
          <Upload size={16} className="text-orange-500" />
          {loading ? 'جاري القراءة...' : 'اختر ملف ETABS النتائج (xlsx)'}
        </Button>

        {status && (
          <p className={`text-xs font-medium px-2 py-1 rounded ${status.startsWith('✓') ? 'text-green-700 bg-green-50 dark:bg-green-950/30' : 'text-destructive bg-destructive/10'}`}>
            {status}
          </p>
        )}

        {/* Preview */}
        {(beams.length > 0 || cols.length > 0 || reacts.length > 0) && (
          <>
            <button
              className="text-xs text-primary flex items-center gap-1 underline underline-offset-2"
              onClick={() => setShowPreview(v => !v)}
            >
              <Eye size={12} />
              {showPreview ? 'إخفاء' : 'معاينة'} البيانات المستوردة
              {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {showPreview && (
              <Tabs value={previewTab} onValueChange={v => setPreviewTab(v as any)}>
                <TabsList className="w-full h-8">
                  {beams.length > 0 && <TabsTrigger value="beams" className="text-xs h-7 flex-1">الجسور ({beams.length})</TabsTrigger>}
                  {cols.length > 0 && <TabsTrigger value="columns" className="text-xs h-7 flex-1">الأعمدة ({cols.length})</TabsTrigger>}
                  {reacts.length > 0 && <TabsTrigger value="reactions" className="text-xs h-7 flex-1">ردود الأفعال ({reacts.length})</TabsTrigger>}
                </TabsList>

                {/* Beams preview */}
                <TabsContent value="beams" className="mt-2">
                  <div className="overflow-x-auto max-h-52 overflow-y-auto rounded border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {['الدور','الجسر','M يسار (kN·m)','M وسط (kN·m)','M يمين (kN·m)','Vu (kN)','توليفات'].map(h => (
                            <TableHead key={h} className="text-[10px] whitespace-nowrap">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {beams.map(r => (
                          <TableRow key={`${r.story}-${r.beamId}`}>
                            <TableCell className="text-[10px] text-muted-foreground">{r.story}</TableCell>
                            <TableCell className="font-mono text-[10px] font-bold">{r.beamId}</TableCell>
                            <TableCell className="font-mono text-[10px] text-red-600">{r.Mleft.toFixed(2)}</TableCell>
                            <TableCell className="font-mono text-[10px] text-green-600">{r.Mmid.toFixed(2)}</TableCell>
                            <TableCell className="font-mono text-[10px] text-red-600">{r.Mright.toFixed(2)}</TableCell>
                            <TableCell className="font-mono text-[10px]">{r.Vu.toFixed(2)}</TableCell>
                            <TableCell className="text-[10px] text-muted-foreground">{r.combCount}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                {/* Columns preview */}
                <TabsContent value="columns" className="mt-2">
                  <div className="overflow-x-auto max-h-52 overflow-y-auto rounded border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {['الدور','العمود','P (kN)','M2 (kN·m)','M3 (kN·m)','V2 (kN)','V3 (kN)','توليفات'].map(h => (
                            <TableHead key={h} className="text-[10px] whitespace-nowrap">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cols.map(r => (
                          <TableRow key={`${r.story}-${r.colId}`}>
                            <TableCell className="text-[10px] text-muted-foreground">{r.story}</TableCell>
                            <TableCell className="font-mono text-[10px] font-bold">{r.colId}</TableCell>
                            <TableCell className="font-mono text-[10px] font-bold text-blue-700">{r.P.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-[10px]">{r.M2.toFixed(2)}</TableCell>
                            <TableCell className="font-mono text-[10px]">{r.M3.toFixed(2)}</TableCell>
                            <TableCell className="font-mono text-[10px]">{r.V2.toFixed(2)}</TableCell>
                            <TableCell className="font-mono text-[10px]">{r.V3.toFixed(2)}</TableCell>
                            <TableCell className="text-[10px] text-muted-foreground">{r.combCount}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                {/* Reactions preview */}
                <TabsContent value="reactions" className="mt-2">
                  <div className="overflow-x-auto max-h-52 overflow-y-auto rounded border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {['النقطة','الدور','Fz (kN)','Fx (kN)','Fy (kN)','Mz (kN·m)','توليفات'].map(h => (
                            <TableHead key={h} className="text-[10px] whitespace-nowrap">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reacts.map(r => (
                          <TableRow key={r.pointId}>
                            <TableCell className="font-mono text-[10px] font-bold">{r.pointId}</TableCell>
                            <TableCell className="text-[10px] text-muted-foreground">{r.story}</TableCell>
                            <TableCell className="font-mono text-[10px] font-bold text-blue-700">{r.Fz.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-[10px]">{r.Fx.toFixed(2)}</TableCell>
                            <TableCell className="font-mono text-[10px]">{r.Fy.toFixed(2)}</TableCell>
                            <TableCell className="font-mono text-[10px]">{r.Mz.toFixed(2)}</TableCell>
                            <TableCell className="text-[10px] text-muted-foreground">{r.combCount}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            )}

            {/* Apply buttons */}
            <div className="space-y-2">
              {beams.length > 0 && (
                <Button
                  className="w-full min-h-[40px] gap-2 bg-orange-600 hover:bg-orange-700 text-white text-sm"
                  onClick={() => onApplyBeams(beams)}
                >
                  <Check size={15} />
                  تطبيق نتائج الجسور للتصميم ({beams.length} جسر)
                </Button>
              )}
              {cols.length > 0 && onApplyColumns && (
                <Button
                  className="w-full min-h-[40px] gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm"
                  onClick={() => onApplyColumns(cols)}
                >
                  <Check size={15} />
                  تطبيق نتائج الأعمدة ({cols.length} عمود)
                </Button>
              )}
              {reacts.length > 0 && onApplyReactions && (
                <Button
                  className="w-full min-h-[40px] gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
                  onClick={() => onApplyReactions(reacts)}
                >
                  <Check size={15} />
                  تطبيق ردود الأفعال لتصميم الأساسات ({reacts.length} نقطة)
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
