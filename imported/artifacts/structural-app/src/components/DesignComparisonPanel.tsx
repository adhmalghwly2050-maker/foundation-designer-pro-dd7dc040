/**
 * DesignComparisonPanel — مقارنة نتائج التصميم بين محركات التطبيق وETABS
 * يشمل مقارنة الجسور والأعمدة
 */

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { GitCompareArrows, TrendingUp, TrendingDown, Minus, Columns3 } from 'lucide-react';
import type { Beam, Column, MatProps, SlabProps, Slab, FrameResult, Story } from '@/lib/structuralEngine';
import { designFlexure, designShear } from '@/lib/structuralEngine';
import type { ETABSColumnResult } from '@/components/ETABSAnalysisImport';

type ETABSBeamResult = {
  beamId: string;
  story: string;
  Mleft: number;
  Mmid: number;
  Mright: number;
  Vu: number;
  combCount?: number;
  stationCount?: number;
};

interface BeamDesignRow {
  beamId: string;
  storyLabel: string;
  app: {
    topLeft: string; bottom: string; topRight: string; Vu: number;
    AsLeft: number; AsMid: number; AsRight: number;
  } | null;
  etabs: {
    topLeft: string; bottom: string; topRight: string; Vu: number;
    AsLeft: number; AsMid: number; AsRight: number;
  } | null;
}

interface ColCompareRow {
  colId: string;
  storyLabel: string;
  appPu: number | null;
  appMx: number | null;
  appMy: number | null;
  etabsP: number | null;
  etabsM2: number | null;
  etabsM3: number | null;
}

interface ColDesignEntry {
  id: string;
  storyId?: string;
  b: number;
  h: number;
  Pu: number;
  Mx: number;
  My: number;
}

interface Props {
  beams: Beam[];
  slabs: Slab[];
  slabProps: SlabProps;
  mat: MatProps;
  stories: Story[];
  frameResults: FrameResult[];
  etabsAnalysisData: ETABSBeamResult[];
  analyzed: boolean;
  columns?: Column[];
  colDesigns?: ColDesignEntry[];
  etabsColumnResults?: ETABSColumnResult[];
  /** خريطة من معرّف الجسر الأساسي (مثل "67") إلى قائمة الأجزاء ("67-1","67-2","67-3") */
  splitBeamGroups?: Record<string, string[]>;
}

function formatRebar(bars: number, dia: number): string {
  return `${bars}Φ${dia}`;
}

function diffBadge(appVal: number, etabsVal: number) {
  const diff = appVal - etabsVal;
  // Use a relative tolerance of 5% for As (mm²) comparison
  const tolerance = Math.max(etabsVal * 0.05, 10);
  if (Math.abs(diff) <= tolerance) return <Minus size={12} className="text-muted-foreground" />;
  if (diff > 0) return <TrendingUp size={12} className="text-red-500" />;
  return <TrendingDown size={12} className="text-green-500" />;
}

function numDiffBadge(appVal: number, etabsVal: number) {
  const pct = etabsVal !== 0 ? ((appVal - etabsVal) / Math.abs(etabsVal)) * 100 : 0;
  const abs = Math.abs(pct);
  if (abs <= 5) return <Badge className="text-[9px] bg-green-500/15 text-green-700 dark:text-green-400 border-green-400/40 px-1">≈</Badge>;
  if (abs <= 15) return <Badge className="text-[9px] bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-400/40 px-1">{pct > 0 ? '+' : ''}{pct.toFixed(0)}%</Badge>;
  return <Badge className="text-[9px] bg-red-500/15 text-red-700 dark:text-red-400 border-red-400/40 px-1">{pct > 0 ? '+' : ''}{pct.toFixed(0)}%</Badge>;
}

function fmt(v: number | null, dec = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(dec);
}

/**
 * For a split beam segment like "B-1_A" or "B-1_B", returns the parent ID "B-1".
 * If not a split segment, returns the original ID.
 */
function parentBeamId(id: string): string {
  return id.replace(/_[AB]$/, '');
}

export default function DesignComparisonPanel({
  beams,
  slabs,
  slabProps,
  mat,
  stories,
  frameResults,
  etabsAnalysisData,
  analyzed,
  columns = [],
  colDesigns = [],
  etabsColumnResults = [],
  splitBeamGroups = {},
}: Props) {
  const [activeTab, setActiveTab] = useState<'beams' | 'columns'>('beams');

  // ── Beam comparisons ──────────────────────────────────────────────────────
  const beamComparisons = useMemo<BeamDesignRow[]>(() => {
    const rows: BeamDesignRow[] = [];

    // Build set of all split-part IDs so we can skip them when iterating frameResults
    const splitPartIds = new Set<string>();
    for (const parts of Object.values(splitBeamGroups)) {
      for (const p of parts) splitPartIds.add(p);
    }

    // Build canonical beam IDs:
    //  - From frameResults: skip split-part IDs, add base IDs instead
    //  - From etabsAnalysisData: add as-is
    const allBeamIds = new Set<string>();
    frameResults.forEach(fr => fr.beams.forEach(b => {
      if (splitPartIds.has(b.beamId)) {
        // Find the canonical base ID for this part
        const base = Object.entries(splitBeamGroups).find(([, parts]) => parts.includes(b.beamId))?.[0];
        if (base) allBeamIds.add(base);
      } else {
        allBeamIds.add(b.beamId);
      }
    }));
    etabsAnalysisData.forEach(ed => allBeamIds.add(ed.beamId));

    for (const beamId of allBeamIds) {
      // The canonical beam: could be the merged base or a regular beam
      // Parts IDs in splitBeamGroups[beamId] (if it's a split group)
      const partIds = splitBeamGroups[beamId] || [beamId];

      // Representative beam object: try canonical ID first, then first part
      const beam = beams.find(b => b.id === beamId) || beams.find(b => partIds.includes(b.id));
      const storyObj = beam ? stories.find(s => s.id === beam.storyId) : null;
      const storyLabel = storyObj?.label || '—';

      // ── App result (aggregate across all parts) ──
      let appRow: BeamDesignRow['app'] = null;
      if (beam) {
        let bestMleft = 0, bestMmid = 0, bestMright = 0, bestVu = 0;
        let found = false;
        for (const pid of partIds) {
          for (const fr of frameResults) {
            const br = fr.beams.find(b => b.beamId === pid);
            if (br) {
              bestMleft = Math.max(bestMleft, Math.abs(br.Mleft));
              bestMmid = Math.max(bestMmid, br.Mmid);
              bestMright = Math.max(bestMright, Math.abs(br.Mright));
              const vu = Math.max(Math.abs(br.Rleft || 0), Math.abs(br.Rright || 0));
              bestVu = Math.max(bestVu, vu);
              found = true;
            }
          }
        }
        if (found) {
          const totalLen = partIds.reduce((sum, pid) => {
            const pb = beams.find(b => b.id === pid) || beam;
            return sum + (pb.length / 1000 || 1);
          }, 0);
          const span = totalLen || beam.length / 1000 || 1;
          const hasSlabs = beam.slabs.length > 0;
          let efbw = 0;
          if (hasSlabs) {
            const widths: number[] = [];
            for (const slabId of beam.slabs) {
              const slab = slabs.find(s => s.id === slabId);
              if (slab) widths.push(beam.direction === 'horizontal' ? Math.abs(slab.y2 - slab.y1) : Math.abs(slab.x2 - slab.x1));
            }
            efbw = Math.min(span * 1000 / 4, beam.b + 16 * slabProps.thickness, widths.reduce((a, b) => a + b, 0) * 1000);
          }
          const fl = designFlexure(bestMleft, beam.b, beam.h, mat.fc, mat.fy);
          const fm = designFlexure(bestMmid, beam.b, beam.h, mat.fc, mat.fy, 40, hasSlabs, slabProps.thickness, efbw, 4);
          const fr2 = designFlexure(bestMright, beam.b, beam.h, mat.fc, mat.fy);
          appRow = {
            topLeft: formatRebar(fl.bars, fl.dia),
            bottom: formatRebar(fm.bars, fm.dia),
            topRight: formatRebar(fr2.bars, fr2.dia),
            Vu: bestVu,
            AsLeft: fl.As,
            AsMid: fm.As,
            AsRight: fr2.As,
          };
        }
      }

      // ── ETABS result ──
      // Direct match, then try parent ID for split segments (B1_A / B1_B → B1)
      let etabsRow: BeamDesignRow['etabs'] = null;
      const pid = parentBeamId(beamId);
      const ed = etabsAnalysisData.find(e => e.beamId === beamId)
        || (pid !== beamId ? etabsAnalysisData.find(e => e.beamId === pid) : null);
      if (ed && beam) {
        const span = beam.length / 1000 || 1;
        const hasSlabs = beam.slabs.length > 0;
        let efbw = 0;
        if (hasSlabs) {
          const widths: number[] = [];
          for (const slabId of beam.slabs) {
            const slab = slabs.find(s => s.id === slabId);
            if (slab) widths.push(beam.direction === 'horizontal' ? Math.abs(slab.y2 - slab.y1) : Math.abs(slab.x2 - slab.x1));
          }
          efbw = Math.min(span * 1000 / 4, beam.b + 16 * slabProps.thickness, widths.reduce((a, b) => a + b, 0) * 1000);
        }
        const fl = designFlexure(ed.Mleft, beam.b, beam.h, mat.fc, mat.fy);
        const fm = designFlexure(ed.Mmid, beam.b, beam.h, mat.fc, mat.fy, 40, hasSlabs, slabProps.thickness, efbw, 4);
        const fr2 = designFlexure(ed.Mright, beam.b, beam.h, mat.fc, mat.fy);
        etabsRow = {
          topLeft: formatRebar(fl.bars, fl.dia),
          bottom: formatRebar(fm.bars, fm.dia),
          topRight: formatRebar(fr2.bars, fr2.dia),
          Vu: ed.Vu,
          AsLeft: fl.As,
          AsMid: fm.As,
          AsRight: fr2.As,
        };
      }

      if (appRow || etabsRow) {
        rows.push({ beamId, storyLabel, app: appRow, etabs: etabsRow });
      }
    }

    return rows.sort((a, b) => a.storyLabel.localeCompare(b.storyLabel) || a.beamId.localeCompare(b.beamId));
  }, [beams, slabs, slabProps, mat, stories, frameResults, etabsAnalysisData, splitBeamGroups]);

  // ── Column comparisons ────────────────────────────────────────────────────
  const colComparisons = useMemo<ColCompareRow[]>(() => {
    const rows: ColCompareRow[] = [];
    const matchedEtabsIndices = new Set<number>();

    // One row per app column design (preserves per-story data — avoids collapsing
    // duplicate IDs from different stories into a single row via Set deduplication).
    for (const cd of colDesigns) {
      const storyObj = stories.find(s => s.id === cd.storyId);
      const storyLabel = storyObj?.label || '—';

      // Match ETABS: prefer same colId + same story label; fall back to colId only
      let etabsIdx = etabsColumnResults.findIndex(
        ec => (ec.colId === cd.id || ec.colId === cd.id.replace(/_[AB]$/, ''))
           && ec.story === storyLabel,
      );
      if (etabsIdx === -1) {
        etabsIdx = etabsColumnResults.findIndex(
          ec => ec.colId === cd.id || ec.colId === cd.id.replace(/_[AB]$/, ''),
        );
      }
      const etabsData = etabsIdx !== -1 ? etabsColumnResults[etabsIdx] : null;
      if (etabsIdx !== -1) matchedEtabsIndices.add(etabsIdx);

      rows.push({
        colId: cd.id,
        storyLabel,
        appPu: cd.Pu,
        appMx: cd.Mx,
        appMy: cd.My,
        etabsP: etabsData ? Math.abs(etabsData.P) : null,
        etabsM2: etabsData?.M2 ?? null,
        etabsM3: etabsData?.M3 ?? null,
      });
    }

    // Add any ETABS entries that were not matched to an app column
    etabsColumnResults.forEach((ec, i) => {
      if (matchedEtabsIndices.has(i)) return;
      rows.push({
        colId: ec.colId,
        storyLabel: ec.story,
        appPu: null,
        appMx: null,
        appMy: null,
        etabsP: Math.abs(ec.P),
        etabsM2: ec.M2,
        etabsM3: ec.M3,
      });
    });

    return rows.sort((a, b) => a.storyLabel.localeCompare(b.storyLabel) || a.colId.localeCompare(b.colId));
  }, [colDesigns, etabsColumnResults, stories]);

  const hasApp = analyzed && frameResults.some(fr => fr.beams.length > 0);
  const hasEtabs = etabsAnalysisData.length > 0;
  const hasAppCols = colDesigns.length > 0;
  const hasEtabsCols = etabsColumnResults.length > 0;

  if (!hasApp && !hasEtabs && !hasAppCols && !hasEtabsCols) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">
          شغّل التحليل أو استورد نتائج ETABS لعرض المقارنة
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab selector */}
      <div className="flex gap-1 border-b border-border pb-1">
        <button
          onClick={() => setActiveTab('beams')}
          className={`px-3 py-1.5 text-xs rounded-t font-medium transition-colors ${
            activeTab === 'beams'
              ? 'bg-background border border-b-0 border-border text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          الجسور
          {etabsAnalysisData.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-[9px]">{etabsAnalysisData.length}</Badge>
          )}
        </button>
        <button
          onClick={() => setActiveTab('columns')}
          className={`px-3 py-1.5 text-xs rounded-t font-medium transition-colors flex items-center gap-1 ${
            activeTab === 'columns'
              ? 'bg-background border border-b-0 border-border text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Columns3 size={11} />
          الأعمدة
          {etabsColumnResults.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-[9px]">{etabsColumnResults.length}</Badge>
          )}
        </button>
      </div>

      {/* ── Beams tab ── */}
      {activeTab === 'beams' && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <GitCompareArrows size={15} />
                مقارنة نتائج التصميم — الجسور
              </CardTitle>
              <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                {hasApp && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />نتائج التطبيق</span>}
                {hasEtabs && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />نتائج ETABS</span>}
                <span className="flex items-center gap-1"><TrendingUp size={10} className="text-red-500" />أعلى من ETABS</span>
                <span className="flex items-center gap-1"><TrendingDown size={10} className="text-green-500" />أقل من ETABS</span>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] sticky right-0 bg-background z-10">الدور</TableHead>
                    <TableHead className="text-[10px] sticky right-12 bg-background z-10">الجسر</TableHead>
                    <TableHead className="text-[10px] text-center" colSpan={2}>علوي يسار</TableHead>
                    <TableHead className="text-[10px] text-center" colSpan={2}>سفلي (وسط)</TableHead>
                    <TableHead className="text-[10px] text-center" colSpan={2}>علوي يمين</TableHead>
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-[9px]" />
                    <TableHead className="text-[9px]" />
                    <TableHead className="text-[9px] text-blue-600">تطبيق</TableHead>
                    <TableHead className="text-[9px] text-orange-600">ETABS</TableHead>
                    <TableHead className="text-[9px] text-blue-600">تطبيق</TableHead>
                    <TableHead className="text-[9px] text-orange-600">ETABS</TableHead>
                    <TableHead className="text-[9px] text-blue-600">تطبيق</TableHead>
                    <TableHead className="text-[9px] text-orange-600">ETABS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {beamComparisons.map(row => (
                    <TableRow key={`${row.storyLabel}-${row.beamId}`}>
                      <TableCell className="text-[10px] text-muted-foreground">{row.storyLabel}</TableCell>
                      <TableCell className="font-mono text-[10px] font-bold">{row.beamId}</TableCell>

                      <TableCell className="font-mono text-[10px]">
                        <div className="flex items-center gap-0.5">
                          {row.app ? row.app.topLeft : <span className="text-muted-foreground">—</span>}
                          {row.app && row.etabs && diffBadge(
                            row.app.AsLeft,
                            row.etabs.AsLeft
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-orange-600">
                        {row.etabs ? row.etabs.topLeft : <span className="text-muted-foreground">—</span>}
                      </TableCell>

                      <TableCell className="font-mono text-[10px]">
                        <div className="flex items-center gap-0.5">
                          {row.app ? row.app.bottom : <span className="text-muted-foreground">—</span>}
                          {row.app && row.etabs && diffBadge(
                            row.app.AsMid,
                            row.etabs.AsMid
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-orange-600">
                        {row.etabs ? row.etabs.bottom : <span className="text-muted-foreground">—</span>}
                      </TableCell>

                      <TableCell className="font-mono text-[10px]">
                        <div className="flex items-center gap-0.5">
                          {row.app ? row.app.topRight : <span className="text-muted-foreground">—</span>}
                          {row.app && row.etabs && diffBadge(
                            row.app.AsRight,
                            row.etabs.AsRight
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-orange-600">
                        {row.etabs ? row.etabs.topRight : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {hasApp && hasEtabs && beamComparisons.length > 0 && (() => {
            let higherCount = 0, lowerCount = 0, equalCount = 0;
            for (const row of beamComparisons) {
              if (!row.app || !row.etabs) continue;
              const appAs    = (row.app.AsLeft   || 0) + (row.app.AsMid   || 0) + (row.app.AsRight   || 0);
              const etabsAs  = (row.etabs.AsLeft  || 0) + (row.etabs.AsMid  || 0) + (row.etabs.AsRight  || 0);
              if (appAs > etabsAs + 1) higherCount++;
              else if (appAs < etabsAs - 1) lowerCount++;
              else equalCount++;
            }
            return (
              <Card className="border-muted">
                <CardContent className="py-3 px-4">
                  <div className="flex flex-wrap gap-4 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">جسور التطبيق أعلى:</span>
                      <Badge variant="destructive" className="text-[10px]">{higherCount}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">جسور ETABS أعلى:</span>
                      <Badge className="text-[10px] bg-green-600">{lowerCount}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">متطابق:</span>
                      <Badge variant="secondary" className="text-[10px]">{equalCount}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </>
      )}

      {/* ── Columns tab ── */}
      {activeTab === 'columns' && (
        <>
          {!hasAppCols && !hasEtabsCols ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground text-sm">
                شغّل التحليل أو استورد نتائج أعمدة ETABS لعرض المقارنة
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Columns3 size={15} />
                  مقارنة نتائج التصميم — الأعمدة
                </CardTitle>
                <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                  {hasAppCols && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />نتائج التطبيق</span>}
                  {hasEtabsCols && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />نتائج ETABS</span>}
                  <span className="text-[10px]">P = ضغط محوري (kN) · M2/Mx وM3/My = عزوم (kN·m)</span>
                </div>
                <p className="text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1 mt-1">
                  ⚠️ <b>قيم التطبيق محسوبة بأحمال مضاعفة (1.2 × أحمال ميتة + 1.6 × أحمال حية)</b> وفق ACI 318.
                  تأكد أن نتائج ETABS المستوردة من نفس التوليفة (1.2D+1.6L) وليست أحمال خدمة، لتكون المقارنة صحيحة.
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] sticky right-0 bg-background z-10">الدور</TableHead>
                      <TableHead className="text-[10px] sticky right-12 bg-background z-10">العمود</TableHead>
                      <TableHead className="text-[10px] text-center" colSpan={2}>P (kN)</TableHead>
                      <TableHead className="text-[10px] text-center" colSpan={2}>Mx / M2 (kN·m)</TableHead>
                      <TableHead className="text-[10px] text-center" colSpan={2}>My / M3 (kN·m)</TableHead>
                    </TableRow>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-[9px]" />
                      <TableHead className="text-[9px]" />
                      <TableHead className="text-[9px] text-blue-600">تطبيق</TableHead>
                      <TableHead className="text-[9px] text-orange-600">ETABS</TableHead>
                      <TableHead className="text-[9px] text-blue-600">تطبيق</TableHead>
                      <TableHead className="text-[9px] text-orange-600">ETABS</TableHead>
                      <TableHead className="text-[9px] text-blue-600">تطبيق</TableHead>
                      <TableHead className="text-[9px] text-orange-600">ETABS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {colComparisons.map(row => (
                      <TableRow key={`${row.storyLabel}-${row.colId}`}>
                        <TableCell className="text-[10px] text-muted-foreground">{row.storyLabel}</TableCell>
                        <TableCell className="font-mono text-[10px] font-bold">{row.colId}</TableCell>

                        <TableCell className="font-mono text-[10px]">
                          <div className="flex items-center gap-0.5">
                            <span>{fmt(row.appPu)}</span>
                            {row.appPu != null && row.etabsP != null && numDiffBadge(row.appPu, row.etabsP)}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-orange-600">{fmt(row.etabsP)}</TableCell>

                        <TableCell className="font-mono text-[10px]">
                          <div className="flex items-center gap-0.5">
                            <span>{fmt(row.appMx)}</span>
                            {row.appMx != null && row.etabsM2 != null && numDiffBadge(row.appMx, row.etabsM2)}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-orange-600">{fmt(row.etabsM2)}</TableCell>

                        <TableCell className="font-mono text-[10px]">
                          <div className="flex items-center gap-0.5">
                            <span>{fmt(row.appMy)}</span>
                            {row.appMy != null && row.etabsM3 != null && numDiffBadge(row.appMy, row.etabsM3)}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-orange-600">{fmt(row.etabsM3)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {hasAppCols && hasEtabsCols && colComparisons.length > 0 && (() => {
            let over = 0, under = 0, match = 0;
            for (const row of colComparisons) {
              if (row.appPu == null || row.etabsP == null) continue;
              const pct = Math.abs((row.appPu - row.etabsP) / Math.max(1, row.etabsP)) * 100;
              if (pct <= 5) match++;
              else if (row.appPu > row.etabsP) over++;
              else under++;
            }
            return (
              <Card className="border-muted">
                <CardContent className="py-3 px-4">
                  <div className="flex flex-wrap gap-4 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">P أعمدة التطبيق أعلى (&gt;5%):</span>
                      <Badge variant="destructive" className="text-[10px]">{over}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">P أعمدة ETABS أعلى (&gt;5%):</span>
                      <Badge className="text-[10px] bg-green-600">{under}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">متطابق (±5%):</span>
                      <Badge variant="secondary" className="text-[10px]">{match}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </>
      )}
    </div>
  );
}
