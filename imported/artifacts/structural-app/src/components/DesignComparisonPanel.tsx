/**
 * DesignComparisonPanel — مقارنة نتائج التصميم بين محركات التطبيق وNETABS
 */

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { GitCompareArrows, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { Beam, MatProps, SlabProps, Slab, FrameResult, Story } from '@/lib/structuralEngine';
import { designFlexure, designShear } from '@/lib/structuralEngine';

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
  app: { topLeft: string; bottom: string; topRight: string; Vu: number } | null;
  etabs: { topLeft: string; bottom: string; topRight: string; Vu: number } | null;
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
}

function formatRebar(bars: number, dia: number): string {
  return `${bars}Φ${dia}`;
}

function diffBadge(appVal: number, etabsVal: number) {
  const diff = appVal - etabsVal;
  if (Math.abs(diff) < 0.5) return <Minus size={12} className="text-muted-foreground" />;
  if (diff > 0) return <TrendingUp size={12} className="text-red-500" />;
  return <TrendingDown size={12} className="text-green-500" />;
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
}: Props) {

  const comparisons = useMemo<BeamDesignRow[]>(() => {
    const rows: BeamDesignRow[] = [];

    // Build set of beam IDs from both sources
    const allBeamIds = new Set<string>();
    frameResults.forEach(fr => fr.beams.forEach(b => allBeamIds.add(b.beamId)));
    etabsAnalysisData.forEach(ed => allBeamIds.add(ed.beamId));

    for (const beamId of allBeamIds) {
      const beam = beams.find(b => b.id === beamId);
      const storyObj = beam ? stories.find(s => s.id === beam.storyId) : null;
      const storyLabel = storyObj?.label || '—';

      // ── App result ──
      let appRow: BeamDesignRow['app'] = null;
      for (const fr of frameResults) {
        const br = fr.beams.find(b => b.beamId === beamId);
        if (br && beam) {
          const span = br.span || beam.length / 1000 || 1;
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
          const fl = designFlexure(Math.abs(br.Mleft), beam.b, beam.h, mat.fc, mat.fy);
          const fm = designFlexure(br.Mmid, beam.b, beam.h, mat.fc, mat.fy, 40, hasSlabs, slabProps.thickness, efbw, 4);
          const fr2 = designFlexure(Math.abs(br.Mright), beam.b, beam.h, mat.fc, mat.fy);
          const Vu = Math.max(Math.abs(br.Rleft || 0), Math.abs(br.Rright || 0));
          appRow = {
            topLeft: formatRebar(fl.bars, fl.dia),
            bottom: formatRebar(fm.bars, fm.dia),
            topRight: formatRebar(fr2.bars, fr2.dia),
            Vu,
          };
          break;
        }
      }

      // ── ETABS result ──
      let etabsRow: BeamDesignRow['etabs'] = null;
      const ed = etabsAnalysisData.find(e => e.beamId === beamId);
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
        };
      }

      if (appRow || etabsRow) {
        rows.push({ beamId, storyLabel, app: appRow, etabs: etabsRow });
      }
    }

    return rows.sort((a, b) => a.storyLabel.localeCompare(b.storyLabel) || a.beamId.localeCompare(b.beamId));
  }, [beams, slabs, slabProps, mat, stories, frameResults, etabsAnalysisData]);

  const hasApp = analyzed && frameResults.some(fr => fr.beams.length > 0);
  const hasEtabs = etabsAnalysisData.length > 0;

  if (!hasApp && !hasEtabs) {
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
              {comparisons.map(row => (
                <TableRow key={`${row.storyLabel}-${row.beamId}`}>
                  <TableCell className="text-[10px] text-muted-foreground">{row.storyLabel}</TableCell>
                  <TableCell className="font-mono text-[10px] font-bold">{row.beamId}</TableCell>

                  {/* Top Left */}
                  <TableCell className="font-mono text-[10px]">
                    <div className="flex items-center gap-0.5">
                      {row.app ? row.app.topLeft : <span className="text-muted-foreground">—</span>}
                      {row.app && row.etabs && diffBadge(
                        parseInt(row.app.topLeft) || 0,
                        parseInt(row.etabs.topLeft) || 0
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-[10px] text-orange-600">
                    {row.etabs ? row.etabs.topLeft : <span className="text-muted-foreground">—</span>}
                  </TableCell>

                  {/* Bottom */}
                  <TableCell className="font-mono text-[10px]">
                    <div className="flex items-center gap-0.5">
                      {row.app ? row.app.bottom : <span className="text-muted-foreground">—</span>}
                      {row.app && row.etabs && diffBadge(
                        parseInt(row.app.bottom) || 0,
                        parseInt(row.etabs.bottom) || 0
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-[10px] text-orange-600">
                    {row.etabs ? row.etabs.bottom : <span className="text-muted-foreground">—</span>}
                  </TableCell>

                  {/* Top Right */}
                  <TableCell className="font-mono text-[10px]">
                    <div className="flex items-center gap-0.5">
                      {row.app ? row.app.topRight : <span className="text-muted-foreground">—</span>}
                      {row.app && row.etabs && diffBadge(
                        parseInt(row.app.topRight) || 0,
                        parseInt(row.etabs.topRight) || 0
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

      {/* Summary stats */}
      {hasApp && hasEtabs && comparisons.length > 0 && (() => {
        let higherCount = 0, lowerCount = 0, equalCount = 0;
        for (const row of comparisons) {
          if (!row.app || !row.etabs) continue;
          const appBars = (parseInt(row.app.topLeft) || 0) + (parseInt(row.app.bottom) || 0) + (parseInt(row.app.topRight) || 0);
          const etabsBars = (parseInt(row.etabs.topLeft) || 0) + (parseInt(row.etabs.bottom) || 0) + (parseInt(row.etabs.topRight) || 0);
          if (appBars > etabsBars) higherCount++;
          else if (appBars < etabsBars) lowerCount++;
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
    </div>
  );
}
