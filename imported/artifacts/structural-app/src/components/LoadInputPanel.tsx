/**
 * LoadInputPanel — لوحة إدخال الأحمال
 * - اكتشاف تلقائي للجسور الطرفية والداخلية
 * - تطبيق حمل جدار جماعي على كل مجموعة
 * - إدخال توليفات تحميل مخصصة
 */

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Home, Building2, Layers, Zap, Plus, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import type { Beam, Slab } from '@/lib/structuralEngine';

interface LoadCombo {
  id: string;
  label: string;
  factorDL: number;
  factorLL: number;
  isDefault?: boolean;
}

interface LoadInputPanelProps {
  beams: Beam[];
  slabs: Slab[];
  beamOverrides: Record<string, { wallLoad?: number; b?: number; h?: number }>;
  onSetBeamWallLoad: (beamId: string, wallLoad: number) => void;
  loadCombos: LoadCombo[];
  onSetLoadCombos: (combos: LoadCombo[]) => void;
  defaultDL?: number;
  defaultLL?: number;
}

const EPS = 1e-4;

function detectBeamType(beam: Beam, slabs: Slab[]): 'exterior' | 'interior' {
  const isH = Math.abs(beam.y2 - beam.y1) < EPS;
  const isV = Math.abs(beam.x2 - beam.x1) < EPS;
  if (!isH && !isV) return 'interior';

  let adjacentSlabCount = 0;

  for (const slab of slabs) {
    if (beam.storyId && slab.storyId && beam.storyId !== slab.storyId) continue;
    const [sx1, sx2] = [Math.min(slab.x1, slab.x2), Math.max(slab.x1, slab.x2)];
    const [sy1, sy2] = [Math.min(slab.y1, slab.y2), Math.max(slab.y1, slab.y2)];

    if (isH) {
      const by = beam.y1;
      const [bx1, bx2] = [Math.min(beam.x1, beam.x2), Math.max(beam.x1, beam.x2)];
      const edgeMatch = Math.abs(by - sy1) < EPS || Math.abs(by - sy2) < EPS;
      const xOverlap = bx1 < sx2 - EPS && bx2 > sx1 + EPS;
      if (edgeMatch && xOverlap) adjacentSlabCount++;
    } else {
      const bx = beam.x1;
      const [by1, by2] = [Math.min(beam.y1, beam.y2), Math.max(beam.y1, beam.y2)];
      const edgeMatch = Math.abs(bx - sx1) < EPS || Math.abs(bx - sx2) < EPS;
      const yOverlap = by1 < sy2 - EPS && by2 > sy1 + EPS;
      if (edgeMatch && yOverlap) adjacentSlabCount++;
    }
  }

  return adjacentSlabCount <= 1 ? 'exterior' : 'interior';
}

const DEFAULT_COMBOS: LoadCombo[] = [
  { id: 'combo_1_4dl',    label: '1.4DL',            factorDL: 1.4, factorLL: 0.0, isDefault: true },
  { id: 'combo_12dl_16ll',label: '1.2DL + 1.6LL',    factorDL: 1.2, factorLL: 1.6, isDefault: true },
  { id: 'combo_1dl_1ll',  label: '1.0DL + 1.0LL (أساسات)', factorDL: 1.0, factorLL: 1.0, isDefault: true },
];

export default function LoadInputPanel({
  beams,
  slabs,
  beamOverrides,
  onSetBeamWallLoad,
  loadCombos,
  onSetLoadCombos,
  defaultDL = 0,
  defaultLL = 0,
}: LoadInputPanelProps) {
  const [exteriorBulkLoad, setExteriorBulkLoad] = useState(0);
  const [interiorBulkLoad, setInteriorBulkLoad] = useState(0);
  const [appliedMsg, setAppliedMsg] = useState('');

  const [newComboLabel, setNewComboLabel] = useState('');
  const [newComboDL, setNewComboDL] = useState(1.2);
  const [newComboLL, setNewComboLL] = useState(1.6);

  const classifiedBeams = useMemo(() => {
    return beams
      .map(b => ({
        ...b,
        beamType: detectBeamType(b, slabs),
        currentWallLoad: beamOverrides[b.id]?.wallLoad ?? b.wallLoad ?? 0,
      }));
  }, [beams, slabs, beamOverrides]);

  const exteriorBeams = useMemo(() => classifiedBeams.filter(b => b.beamType === 'exterior'), [classifiedBeams]);
  const interiorBeams = useMemo(() => classifiedBeams.filter(b => b.beamType === 'interior'), [classifiedBeams]);

  const applyBulkLoad = (group: 'exterior' | 'interior') => {
    const load = group === 'exterior' ? exteriorBulkLoad : interiorBulkLoad;
    const targetBeams = group === 'exterior' ? exteriorBeams : interiorBeams;
    targetBeams.forEach(b => onSetBeamWallLoad(b.id, load));
    setAppliedMsg(`✓ تم تطبيق ${load} kN/m على ${targetBeams.length} جسر ${group === 'exterior' ? 'طرفي' : 'داخلي'}`);
    setTimeout(() => setAppliedMsg(''), 3000);
  };

  const addCombo = () => {
    if (!newComboLabel.trim()) return;
    const id = `combo_custom_${Date.now()}`;
    onSetLoadCombos([...loadCombos, { id, label: newComboLabel.trim(), factorDL: newComboDL, factorLL: newComboLL }]);
    setNewComboLabel('');
    setNewComboDL(1.2);
    setNewComboLL(1.6);
  };

  const removeCombo = (id: string) => {
    onSetLoadCombos(loadCombos.filter(c => c.id !== id));
  };

  const clearAllWallLoads = () => {
    classifiedBeams.forEach(b => onSetBeamWallLoad(b.id, 0));
    setAppliedMsg(`✓ تم مسح أحمال الجدران عن جميع الجسور (${classifiedBeams.length} جسر)`);
    setTimeout(() => setAppliedMsg(''), 3000);
  };

  return (
    <div className="space-y-4">
      {/* ── Clear All Overlaps ── */}
      <Card className="border-red-200 dark:border-red-800 bg-red-500/5">
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-foreground">حذف تراكب الأحمال / صفر جميع أحمال الجدران</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                يعيد تعيين حمل الجدار إلى 0 لجميع الجسور (الطرفية والداخلية) دفعة واحدة.
              </p>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="h-9 gap-1.5 shrink-0"
              onClick={clearAllWallLoads}
            >
              <XCircle size={14} />
              صفر جميع الأحمال
            </Button>
          </div>
          {appliedMsg && <p className="text-xs text-green-600 font-medium mt-2">{appliedMsg}</p>}
        </CardContent>
      </Card>

      {/* ── Exterior Beams ── */}
      <Card className="border-amber-200 dark:border-amber-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Home size={14} className="text-amber-500" />
            الجسور الطرفية (الخارجية)
            <Badge variant="secondary" className="text-[10px]">{exteriorBeams.length} جسر</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={exteriorBulkLoad}
              onChange={e => setExteriorBulkLoad(Number(e.target.value))}
              className="h-9 w-32 font-mono text-sm"
              placeholder="0"
              step="0.5"
            />
            <span className="text-xs text-muted-foreground">kN/m (حمل جدار)</span>
            <Button size="sm" className="h-9 gap-1 bg-amber-600 hover:bg-amber-700" onClick={() => applyBulkLoad('exterior')}>
              <CheckCircle2 size={14} />
              تطبيق على الطرفية
            </Button>
          </div>
          <div className="overflow-x-auto max-h-48 overflow-y-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  {['الجسر', 'الدور', 'من', 'إلى', 'حمل جدار (kN/m)'].map(h => (
                    <TableHead key={h} className="text-[10px]">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {exteriorBeams.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-[10px]">{b.id}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{b.storyId || '—'}</TableCell>
                    <TableCell className="font-mono text-[10px]">({b.x1.toFixed(1)},{b.y1.toFixed(1)})</TableCell>
                    <TableCell className="font-mono text-[10px]">({b.x2.toFixed(1)},{b.y2.toFixed(1)})</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={b.currentWallLoad}
                        onChange={e => onSetBeamWallLoad(b.id, Number(e.target.value))}
                        className="h-7 w-20 font-mono text-[10px]"
                        step="0.5"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Interior Beams ── */}
      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 size={14} className="text-blue-500" />
            الجسور الداخلية
            <Badge variant="secondary" className="text-[10px]">{interiorBeams.length} جسر</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={interiorBulkLoad}
              onChange={e => setInteriorBulkLoad(Number(e.target.value))}
              className="h-9 w-32 font-mono text-sm"
              placeholder="0"
              step="0.5"
            />
            <span className="text-xs text-muted-foreground">kN/m (حمل جدار)</span>
            <Button size="sm" className="h-9 gap-1 bg-blue-600 hover:bg-blue-700" onClick={() => applyBulkLoad('interior')}>
              <CheckCircle2 size={14} />
              تطبيق على الداخلية
            </Button>
          </div>
          <div className="overflow-x-auto max-h-48 overflow-y-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  {['الجسر', 'الدور', 'من', 'إلى', 'حمل جدار (kN/m)'].map(h => (
                    <TableHead key={h} className="text-[10px]">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {interiorBeams.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-[10px]">{b.id}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{b.storyId || '—'}</TableCell>
                    <TableCell className="font-mono text-[10px]">({b.x1.toFixed(1)},{b.y1.toFixed(1)})</TableCell>
                    <TableCell className="font-mono text-[10px]">({b.x2.toFixed(1)},{b.y2.toFixed(1)})</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={b.currentWallLoad}
                        onChange={e => onSetBeamWallLoad(b.id, Number(e.target.value))}
                        className="h-7 w-20 font-mono text-[10px]"
                        step="0.5"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Load Combinations ── */}
      <Card className="border-purple-200 dark:border-purple-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap size={14} className="text-purple-500" />
            توليفات التحميل
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  {['التوليفة', 'معامل DL', 'معامل LL', ''].map(h => (
                    <TableHead key={h} className="text-[10px]">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadCombos.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs font-medium">{c.label}</TableCell>
                    <TableCell className="font-mono text-xs">{c.factorDL.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs">{c.factorLL.toFixed(1)}</TableCell>
                    <TableCell>
                      {!c.isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive"
                          onClick={() => removeCombo(c.id)}
                        >
                          <Trash2 size={12} />
                        </Button>
                      )}
                      {c.isDefault && (
                        <Badge variant="outline" className="text-[9px]">افتراضي</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">إضافة توليفة جديدة</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={newComboLabel}
                onChange={e => setNewComboLabel(e.target.value)}
                placeholder="مثال: 1.2DL + 1.0LL"
                className="h-9 text-xs flex-1 min-w-[160px]"
              />
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">DL×</span>
                <Input
                  type="number"
                  value={newComboDL}
                  onChange={e => setNewComboDL(Number(e.target.value))}
                  className="h-9 w-16 font-mono text-xs"
                  step="0.1"
                />
                <span className="text-xs text-muted-foreground">LL×</span>
                <Input
                  type="number"
                  value={newComboLL}
                  onChange={e => setNewComboLL(Number(e.target.value))}
                  className="h-9 w-16 font-mono text-xs"
                  step="0.1"
                />
              </div>
              <Button size="sm" className="h-9 gap-1" onClick={addCombo}>
                <Plus size={14} />
                إضافة
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
