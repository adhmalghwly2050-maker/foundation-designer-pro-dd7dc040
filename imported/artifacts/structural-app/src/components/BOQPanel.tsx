/**
 * Bill of Quantities (BOQ) Panel
 * Part 1: Concrete volumes (m³) per element type
 * Part 2: Steel weights (ton) per diameter per element type
 * Supports per-story filtering and Foundations section.
 */

import React, { useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Layers, Filter, Building2 } from 'lucide-react';
import type { Story, Slab, Beam, Column, SlabProps, FlexureResult, ShearResult, ColumnResult } from '@/lib/structuralEngine';

interface BeamDesignData {
  beamId: string;
  flexLeft: FlexureResult;
  flexMid: FlexureResult;
  flexRight: FlexureResult;
  shear: ShearResult;
  span: number;
}

interface ColDesignData {
  id: string;
  b: number; h: number; L: number;
  design: ColumnResult;
}

interface SlabDesignData {
  id: string;
  x1: number; y1: number; x2: number; y2: number;
  design: {
    hUsed: number;
    shortDir: { bars: number; dia: number; spacing: number };
    longDir: { bars: number; dia: number; spacing: number };
    lx: number; ly: number;
  };
}

interface BOQPanelProps {
  stories: Story[];
  slabs: Slab[];
  beams: Beam[];
  columns: Column[];
  beamDesigns: BeamDesignData[];
  colDesigns: ColDesignData[];
  slabDesigns: SlabDesignData[];
  slabProps: SlabProps;
  analyzed: boolean;
}

// Weight per meter for rebar (kg/m) = dia² / 162.2
function rebarWeightPerMeter(dia: number): number {
  return (dia * dia) / 162.2;
}

// Filter mode: 'all' | 'foundations' | story id
type FilterMode = 'all' | 'foundations' | string;

export default function BOQPanel({
  stories, slabs, beams, columns, beamDesigns, colDesigns, slabDesigns, slabProps, analyzed,
}: BOQPanelProps) {

  const [storyFilter, setStoryFilter] = useState<FilterMode>('all');

  // Sorted stories: lowest elevation first (ground floor at index 0)
  const sortedStories = useMemo(
    () => [...stories].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0)),
    [stories]
  );

  // Ground-story id (used for "foundations" mode - columns at lowest level)
  const groundStoryId = sortedStories[0]?.id ?? '';

  // Apply filter to get the elements for quantity calculations
  const filteredSlabs = useMemo(() => {
    if (storyFilter === 'all') return slabs;
    if (storyFilter === 'foundations') return []; // foundations don't include typical slabs
    return slabs.filter(s => s.storyId === storyFilter);
  }, [slabs, storyFilter]);

  const filteredBeams = useMemo(() => {
    if (storyFilter === 'all') return beams;
    if (storyFilter === 'foundations') return []; // foundations don't include typical beams
    return beams.filter(b => b.storyId === storyFilter);
  }, [beams, storyFilter]);

  const filteredColumns = useMemo(() => {
    if (storyFilter === 'all') return columns.filter(c => !c.isRemoved);
    if (storyFilter === 'foundations') {
      // Ground-level columns (those in the lowest story or with zBottom near 0)
      return columns.filter(c => !c.isRemoved && (c.storyId === groundStoryId || (c.zBottom ?? 0) <= 100));
    }
    return columns.filter(c => !c.isRemoved && c.storyId === storyFilter);
  }, [columns, storyFilter, groundStoryId]);

  const filteredBeamDesigns = useMemo(() => {
    const ids = new Set(filteredBeams.map(b => b.id));
    return beamDesigns.filter(d => ids.has(d.beamId));
  }, [beamDesigns, filteredBeams]);

  const filteredColDesigns = useMemo(() => {
    const ids = new Set(filteredColumns.map(c => c.id));
    return colDesigns.filter(d => ids.has(d.id));
  }, [colDesigns, filteredColumns]);

  const filteredSlabDesigns = useMemo(() => {
    const ids = new Set(filteredSlabs.map(s => s.id));
    return slabDesigns.filter(d => ids.has(d.id));
  }, [slabDesigns, filteredSlabs]);

  // Current filter label
  const filterLabel = useMemo(() => {
    if (storyFilter === 'all') return 'جميع الأدوار';
    if (storyFilter === 'foundations') return 'الأساسات';
    const st = stories.find(s => s.id === storyFilter);
    return st ? st.label : storyFilter;
  }, [storyFilter, stories]);

  // =================== CONCRETE VOLUMES ===================
  const concreteData = useMemo(() => {
    // Slabs: area × thickness (convert mm to m)
    let slabVolume = 0;
    for (const s of filteredSlabs) {
      const area = Math.abs(s.x2 - s.x1) * Math.abs(s.y2 - s.y1); // m²
      const thickness = slabProps.thickness / 1000; // mm → m
      slabVolume += area * thickness;
    }

    // Beams: b × effectiveH × length (mm → m)
    let beamVolume = 0;
    for (const b of filteredBeams) {
      const length = b.length; // already in meters
      const bm = b.b / 1000; // mm → m
      const hm = b.h / 1000;
      // Subtract slab thickness from beam height to avoid double counting
      const effectiveH = Math.max(hm - slabProps.thickness / 1000, hm * 0.5);
      beamVolume += bm * effectiveH * length;
    }

    // Columns: b × h × L (mm → m)
    let colVolume = 0;
    for (const c of filteredColumns) {
      const bm = c.b / 1000;
      const hm = c.h / 1000;
      const Lm = c.L / 1000;
      colVolume += bm * hm * Lm;
    }

    const total = slabVolume + beamVolume + colVolume;
    return { slabVolume, beamVolume, colVolume, total };
  }, [filteredSlabs, filteredBeams, filteredColumns, slabProps]);

  // =================== STEEL QUANTITIES ===================
  const steelData = useMemo(() => {
    if (!analyzed) return null;

    const diaSet = new Set<number>();
    const beamSteel: Record<number, number> = {};
    const colSteel: Record<number, number> = {};
    const slabSteel: Record<number, number> = {};

    const addWeight = (target: Record<number, number>, dia: number, lengthM: number, qty: number = 1) => {
      diaSet.add(dia);
      const w = rebarWeightPerMeter(dia) * lengthM * qty;
      target[dia] = (target[dia] || 0) + w;
    };

    // Beams steel — only for filtered beams
    const filteredBeamMap = new Map(filteredBeams.map(b => [b.id, b]));
    for (const d of filteredBeamDesigns) {
      const beam = filteredBeamMap.get(d.beamId);
      if (!beam) continue;
      const spanM = d.span || beam.length;

      if (d.flexLeft?.dia) addWeight(beamSteel, d.flexLeft.dia, spanM * 0.4, d.flexLeft.bars);
      if (d.flexRight?.dia) addWeight(beamSteel, d.flexRight.dia, spanM * 0.4, d.flexRight.bars);
      if (d.flexMid?.dia) addWeight(beamSteel, d.flexMid.dia, spanM + 0.6, d.flexMid.bars);
      if (d.shear?.sUsed && d.shear.sUsed > 0) {
        const stirrupDia = 10;
        const numStirrups = Math.ceil((spanM * 1000) / d.shear.sUsed);
        const perimeterM = 2 * ((beam.b - 80) / 1000 + (beam.h - 80) / 1000) + 0.2;
        const legs = d.shear.stirrupLegs || 2;
        addWeight(beamSteel, stirrupDia, perimeterM * legs / 2, numStirrups);
      }
    }

    // Column steel — only for filtered columns
    for (const c of filteredColDesigns) {
      if (!c.design) continue;
      const Lm = c.L / 1000;
      if (c.design.dia && c.design.bars) {
        addWeight(colSteel, c.design.dia, Lm + 0.8, c.design.bars);
      }
      const stirMatch = c.design.stirrups?.match(/Φ(\d+)@(\d+)/);
      if (stirMatch) {
        const sDia = parseInt(stirMatch[1]);
        const sSpacing = parseInt(stirMatch[2]);
        const numStirrups = Math.ceil((Lm * 1000) / sSpacing);
        const perimeterM = 2 * ((c.b - 80) / 1000 + (c.h - 80) / 1000) + 0.2;
        addWeight(colSteel, sDia, perimeterM, numStirrups);
      }
    }

    // Slab steel — only for filtered slabs
    const filteredSlabDesignMap = new Map(filteredSlabDesigns.map(s => [s.id, s]));
    for (const s of filteredSlabDesigns) {
      if (!s.design) continue;
      const lx = s.design.lx;
      const ly = s.design.ly;

      if (s.design.shortDir?.dia) {
        const spacing = s.design.shortDir.spacing / 1000;
        const numBars = spacing > 0 ? Math.ceil(ly / spacing) : s.design.shortDir.bars;
        addWeight(slabSteel, s.design.shortDir.dia, lx + 0.3, numBars);
      }
      if (s.design.longDir?.dia) {
        const spacing = s.design.longDir.spacing / 1000;
        const numBars = spacing > 0 ? Math.ceil(lx / spacing) : s.design.longDir.bars;
        addWeight(slabSteel, s.design.longDir.dia, ly + 0.3, numBars);
      }
    }

    const allDias = Array.from(diaSet).sort((a, b) => a - b);
    const beamTotal = Object.values(beamSteel).reduce((a, b) => a + b, 0);
    const colTotal = Object.values(colSteel).reduce((a, b) => a + b, 0);
    const slabTotal = Object.values(slabSteel).reduce((a, b) => a + b, 0);

    const diaTotals: Record<number, number> = {};
    for (const dia of allDias) {
      diaTotals[dia] = (beamSteel[dia] || 0) + (colSteel[dia] || 0) + (slabSteel[dia] || 0);
    }

    const grandTotal = beamTotal + colTotal + slabTotal;
    return { allDias, beamSteel, colSteel, slabSteel, beamTotal, colTotal, slabTotal, diaTotals, grandTotal };
  }, [analyzed, filteredBeamDesigns, filteredColDesigns, filteredSlabDesigns, filteredBeams]);

  return (
    <div className="space-y-4">

      {/* Story Filter */}
      <Card className="border-muted">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 shrink-0">
              <Filter size={14} className="text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">تصفية الكميات بالدور:</span>
            </div>
            <select
              value={storyFilter}
              onChange={e => setStoryFilter(e.target.value as FilterMode)}
              className="h-8 rounded border border-input bg-background px-2 text-xs min-w-[180px] text-foreground"
            >
              <option value="all">جميع الأدوار</option>
              <optgroup label="── الأدوار ──">
                {sortedStories.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label} (منسوب {((s.elevation ?? 0) / 1000).toFixed(1)}م — {(((s.elevation ?? 0) + s.height) / 1000).toFixed(1)}م)
                  </option>
                ))}
              </optgroup>
              <optgroup label="── أخرى ──">
                <option value="foundations">الأساسات (الدور الأرضي)</option>
              </optgroup>
            </select>

            {storyFilter !== 'all' && (
              <Badge variant="secondary" className="text-[10px]">
                {filterLabel}
              </Badge>
            )}

            {/* Summary counts */}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mr-auto">
              <span>{filteredSlabs.length} بلاطة</span>
              <span>•</span>
              <span>{filteredBeams.length} جسر</span>
              <span>•</span>
              <span>{filteredColumns.length} عمود</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Foundations section */}
      {storyFilter === 'foundations' && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-300">
              <Building2 size={16} /> قسم الأساسات
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              تعرض هذه الكميات الأعمدة في الدور الأرضي (الدور الأول من الأسفل) باعتبارها العناصر المتصلة بمنظومة الأساسات.
            </p>
            <p className="text-xs text-muted-foreground">
              <strong>ملاحظة:</strong> يتم تصميم الأساسات (القواعد والأوتاد) بشكل مستقل في قسم "تصميم الأساسات" بتبويب التصميم.
              الكميات أدناه تشمل خرسانة وحديد الأعمدة الأرضية فقط.
            </p>
            {filteredColumns.length > 0 && (
              <div className="overflow-x-auto rounded border border-amber-200 dark:border-amber-800">
                <table className="text-[10px] w-full">
                  <thead className="bg-amber-100/50 dark:bg-amber-900/30">
                    <tr>
                      <th className="px-2 py-1 text-right font-semibold">العمود</th>
                      <th className="px-2 py-1 text-right font-semibold">الأبعاد (مم)</th>
                      <th className="px-2 py-1 text-right font-semibold">الارتفاع (م)</th>
                      <th className="px-2 py-1 text-right font-semibold">الحجم (م³)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredColumns.slice(0, 20).map(c => (
                      <tr key={c.id} className="border-t border-amber-200/50 dark:border-amber-800/30">
                        <td className="px-2 py-1 font-mono font-bold">{c.id}</td>
                        <td className="px-2 py-1 font-mono">{c.b}×{c.h}</td>
                        <td className="px-2 py-1 font-mono">{(c.L / 1000).toFixed(2)}</td>
                        <td className="px-2 py-1 font-mono">{((c.b / 1000) * (c.h / 1000) * (c.L / 1000)).toFixed(3)}</td>
                      </tr>
                    ))}
                    {filteredColumns.length > 20 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-1 text-center text-muted-foreground">
                          ... و {filteredColumns.length - 20} عمود آخر
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Part 1: Concrete Quantities */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Layers size={16} /> جدول كميات الخرسانة</span>
            {storyFilter !== 'all' && (
              <Badge variant="outline" className="text-[10px] font-normal">{filterLabel}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {filteredSlabs.length === 0 && filteredBeams.length === 0 && filteredColumns.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              لا توجد عناصر في {filterLabel}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">العنصر</TableHead>
                  <TableHead className="text-xs">العدد</TableHead>
                  <TableHead className="text-xs">الوحدة</TableHead>
                  <TableHead className="text-xs">الكمية</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs font-medium">البلاطات</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{filteredSlabs.length}</TableCell>
                  <TableCell className="text-xs">م³</TableCell>
                  <TableCell className="font-mono text-xs font-bold">{concreteData.slabVolume.toFixed(2)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs font-medium">الجسور</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{filteredBeams.length}</TableCell>
                  <TableCell className="text-xs">م³</TableCell>
                  <TableCell className="font-mono text-xs font-bold">{concreteData.beamVolume.toFixed(2)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs font-medium">الأعمدة</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{filteredColumns.length}</TableCell>
                  <TableCell className="text-xs">م³</TableCell>
                  <TableCell className="font-mono text-xs font-bold">{concreteData.colVolume.toFixed(2)}</TableCell>
                </TableRow>
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell className="text-xs font-bold">الإجمالي</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {filteredSlabs.length + filteredBeams.length + filteredColumns.length}
                  </TableCell>
                  <TableCell className="text-xs">م³</TableCell>
                  <TableCell className="font-mono text-xs font-bold text-primary">{concreteData.total.toFixed(2)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* All stories summary table (when showing all) */}
      {storyFilter === 'all' && stories.length > 1 && (
        <Card className="border-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">ملخص الخرسانة بالأدوار</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">الدور</TableHead>
                  <TableHead className="text-xs">بلاطات (م³)</TableHead>
                  <TableHead className="text-xs">جسور (م³)</TableHead>
                  <TableHead className="text-xs">أعمدة (م³)</TableHead>
                  <TableHead className="text-xs font-bold">المجموع (م³)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedStories.map(story => {
                  const stSlabs = slabs.filter(s => s.storyId === story.id);
                  const stBeams = beams.filter(b => b.storyId === story.id);
                  const stCols = columns.filter(c => !c.isRemoved && c.storyId === story.id);

                  let sv = 0;
                  for (const s of stSlabs) sv += Math.abs(s.x2 - s.x1) * Math.abs(s.y2 - s.y1) * (slabProps.thickness / 1000);
                  let bv = 0;
                  for (const b of stBeams) bv += (b.b / 1000) * Math.max(b.h / 1000 - slabProps.thickness / 1000, (b.h / 1000) * 0.5) * b.length;
                  let cv = 0;
                  for (const c of stCols) cv += (c.b / 1000) * (c.h / 1000) * (c.L / 1000);

                  return (
                    <TableRow key={story.id}>
                      <TableCell className="text-xs font-medium">{story.label}</TableCell>
                      <TableCell className="font-mono text-xs">{sv.toFixed(2)}</TableCell>
                      <TableCell className="font-mono text-xs">{bv.toFixed(2)}</TableCell>
                      <TableCell className="font-mono text-xs">{cv.toFixed(2)}</TableCell>
                      <TableCell className="font-mono text-xs font-bold">{(sv + bv + cv).toFixed(2)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Part 2: Steel Quantities */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Layers size={16} /> جدول كميات حديد التسليح</span>
            {storyFilter !== 'all' && (
              <Badge variant="outline" className="text-[10px] font-normal">{filterLabel}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!analyzed || !steelData ? (
            <p className="text-xs text-muted-foreground text-center py-4">يجب تشغيل التحليل أولاً لحساب كميات الحديد</p>
          ) : steelData.grandTotal === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">لا توجد بيانات حديد للعناصر المحددة</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">العنصر</TableHead>
                  {steelData.allDias.map(dia => (
                    <TableHead key={dia} className="text-xs text-center">Φ{dia} (طن)</TableHead>
                  ))}
                  <TableHead className="text-xs text-center font-bold">الإجمالي (طن)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs font-medium">الجسور</TableCell>
                  {steelData.allDias.map(dia => (
                    <TableCell key={dia} className="font-mono text-xs text-center">
                      {((steelData.beamSteel[dia] || 0) / 1000).toFixed(3)}
                    </TableCell>
                  ))}
                  <TableCell className="font-mono text-xs text-center font-bold">
                    {(steelData.beamTotal / 1000).toFixed(3)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs font-medium">الأعمدة</TableCell>
                  {steelData.allDias.map(dia => (
                    <TableCell key={dia} className="font-mono text-xs text-center">
                      {((steelData.colSteel[dia] || 0) / 1000).toFixed(3)}
                    </TableCell>
                  ))}
                  <TableCell className="font-mono text-xs text-center font-bold">
                    {(steelData.colTotal / 1000).toFixed(3)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs font-medium">البلاطات</TableCell>
                  {steelData.allDias.map(dia => (
                    <TableCell key={dia} className="font-mono text-xs text-center">
                      {((steelData.slabSteel[dia] || 0) / 1000).toFixed(3)}
                    </TableCell>
                  ))}
                  <TableCell className="font-mono text-xs text-center font-bold">
                    {(steelData.slabTotal / 1000).toFixed(3)}
                  </TableCell>
                </TableRow>
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell className="text-xs font-bold">الإجمالي</TableCell>
                  {steelData.allDias.map(dia => (
                    <TableCell key={dia} className="font-mono text-xs text-center font-bold text-primary">
                      {((steelData.diaTotals[dia] || 0) / 1000).toFixed(3)}
                    </TableCell>
                  ))}
                  <TableCell className="font-mono text-xs text-center font-bold text-primary">
                    {(steelData.grandTotal / 1000).toFixed(3)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
