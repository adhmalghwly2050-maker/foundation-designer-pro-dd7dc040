/**
 * ManualConnectionManager
 * ═══════════════════════════════════════════════════════════════
 * إبداعي: واجهة لإدارة اتصالات الجسور-الأعمدة يدوياً
 *
 * يعرض لكل عمود قائمة بالجسور القريبة مع:
 *  - 🟢 تلقائي: مركز الجسر داخل صندوق العمود (يتصل دائماً)
 *  - 🔵 يدوي: المستخدم فرض الاتصال
 *  - 🟡 قريب: خارج الصندوق لكن ضمن 500mm
 *  - ⚫ بعيد: أكثر من 500mm
 *
 * عند تفعيل التبديل → يُضاف ManualJointOverride → يُعاد التحليل تلقائياً
 */

import { useState, useMemo, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Column, Beam, Story } from '@/lib/structuralEngine';
import type { ManualJointOverride } from '@/pages/indexReducer';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Distance (mm) from the nearest beam endpoint to the column centre. */
function beamToColDist(beam: Beam, col: Column): number {
  const cx = col.x, cy = col.y;
  const d1 = Math.sqrt((beam.x1 - cx) ** 2 + (beam.y1 - cy) ** 2) * 1000;
  const d2 = Math.sqrt((beam.x2 - cx) ** 2 + (beam.y2 - cy) ** 2) * 1000;
  return Math.min(d1, d2);
}

/** True when a beam endpoint falls inside the column cross-section bounding box. */
function isAutoConnected(beam: Beam, col: Column): boolean {
  const bH = col.b / 2 + 1;   // +1mm float tolerance
  const hH = col.h / 2 + 1;
  const cx = col.x * 1000, cy = col.y * 1000;
  const ok = (xMm: number, yMm: number) =>
    Math.abs(xMm - cx) <= bH && Math.abs(yMm - cy) <= hH;
  return ok(beam.x1 * 1000, beam.y1 * 1000) || ok(beam.x2 * 1000, beam.y2 * 1000);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface BeamRow {
  beam: Beam;
  dist: number;
  auto: boolean;
  manual: boolean;
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Column[];
  beams: Beam[];
  stories: Story[];
  selectedStoryId: string;
  manualJointOverrides: ManualJointOverride[];
  onOverridesChange: (overrides: ManualJointOverride[]) => void;
  onRequestReanalyze?: () => void;
}

export default function ManualConnectionManager({
  open,
  onOpenChange,
  columns,
  beams,
  stories,
  selectedStoryId,
  manualJointOverrides,
  onOverridesChange,
  onRequestReanalyze,
}: Props) {
  const [selectedColId, setSelectedColId] = useState<string>('');
  const [showFar, setShowFar] = useState(false);

  // Columns for selected story (or all if no storyId)
  const storyColumns = useMemo(
    () => columns.filter(c => !c.isRemoved && (c.storyId === selectedStoryId || !c.storyId)),
    [columns, selectedStoryId],
  );

  // Auto-select first column when dialog opens
  useEffect(() => {
    if (open && storyColumns.length > 0 && (!selectedColId || !storyColumns.find(c => c.id === selectedColId))) {
      setSelectedColId(storyColumns[0].id);
    }
  }, [open, storyColumns]);

  const selectedColumn = storyColumns.find(c => c.id === selectedColId);

  // Compute beam rows for selected column
  const beamRows = useMemo<BeamRow[]>(() => {
    if (!selectedColumn) return [];
    const rows = beams
      .filter(b => !b.isRemoved)
      .map(b => ({
        beam: b,
        dist: beamToColDist(b, selectedColumn),
        auto: isAutoConnected(b, selectedColumn),
        manual: manualJointOverrides.some(
          o => o.beamId === b.id && o.columnId === selectedColId,
        ),
      }))
      .filter(r => r.dist <= (showFar ? 5000 : 1000))
      .sort((a, b) => a.dist - b.dist);
    return rows;
  }, [selectedColumn, beams, manualJointOverrides, selectedColId, showFar]);

  const autoCount   = beamRows.filter(r => r.auto).length;
  const manualCount = beamRows.filter(r => r.manual && !r.auto).length;
  const nearCount   = beamRows.filter(r => !r.auto && !r.manual && r.dist <= 500).length;

  // Toggle a manual override for a beam
  const toggleManual = (beamId: string) => {
    const exists = manualJointOverrides.find(
      o => o.beamId === beamId && o.columnId === selectedColId,
    );
    if (exists) {
      onOverridesChange(manualJointOverrides.filter(
        o => !(o.beamId === beamId && o.columnId === selectedColId),
      ));
    } else {
      onOverridesChange([
        ...manualJointOverrides,
        {
          id: `${selectedColId}_${beamId}`,
          columnId: selectedColId,
          beamId,
          storyId: selectedStoryId,
        },
      ]);
    }
  };

  // Status icon + color
  const rowStyle = (r: BeamRow) => {
    if (r.auto)   return { icon: '🟢', cls: 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800' };
    if (r.manual) return { icon: '🔵', cls: 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800' };
    if (r.dist <= 50)  return { icon: '🟡', cls: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30' };
    if (r.dist <= 200) return { icon: '🟠', cls: 'bg-orange-50 border-orange-200 dark:bg-orange-950/30' };
    return { icon: '⚫', cls: 'bg-muted/20 border-border' };
  };

  const story = stories.find(s => s.id === selectedStoryId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden"
        dir="rtl"
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <DialogHeader className="px-4 pt-4 pb-2 border-b">
          <DialogTitle className="text-sm flex items-center gap-1.5">
            🔗 مدير الاتصالات اليدوية
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            {story?.label ?? selectedStoryId} ·{' '}
            <span className="text-green-600 font-medium">{autoCount} تلقائي</span>
            {manualCount > 0 && <> · <span className="text-blue-600 font-medium">{manualCount} يدوي</span></>}
            {nearCount > 0  && <> · <span className="text-yellow-700 font-medium">{nearCount} قابل للربط</span></>}
          </DialogDescription>
        </DialogHeader>

        {/* ── Column Selector ────────────────────────────────────── */}
        <div className="px-4 py-3 border-b bg-muted/20">
          <p className="text-[10px] text-muted-foreground mb-1.5 font-medium">اختر العمود</p>
          <Select value={selectedColId} onValueChange={setSelectedColId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="اختر عموداً..." />
            </SelectTrigger>
            <SelectContent>
              {storyColumns.map(col => {
                const manCount = manualJointOverrides.filter(o => o.columnId === col.id).length;
                return (
                  <SelectItem key={col.id} value={col.id} className="text-xs">
                    <span className="font-mono font-semibold">{col.id}</span>
                    <span className="text-muted-foreground mr-1">
                      ({col.x.toFixed(1)}, {col.y.toFixed(1)})m · {col.b}×{col.h}mm
                    </span>
                    {manCount > 0 && (
                      <span className="mr-1 text-blue-600">🔵 {manCount}</span>
                    )}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* ── Legend ────────────────────────────────────────────── */}
        <div className="px-4 py-2 flex gap-2 flex-wrap border-b text-[9px]">
          <span>🟢 تلقائي (داخل المقطع)</span>
          <span>🔵 يدوي (مفعَّل)</span>
          <span>🟡 ≤50mm</span>
          <span>🟠 ≤200mm</span>
          <span>⚫ أبعد</span>
        </div>

        {/* ── Beam List ─────────────────────────────────────────── */}
        <ScrollArea className="flex-1 px-4 py-2">
          {beamRows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">
              {selectedColumn
                ? 'لا توجد جسور ضمن 1000mm من هذا العمود'
                : 'اختر عموداً لعرض الجسور القريبة'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {beamRows.map(r => {
                const { icon, cls } = rowStyle(r);
                return (
                  <div
                    key={r.beam.id}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs border transition-colors ${cls}`}
                  >
                    {/* Left: icon + beam info */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm shrink-0">{icon}</span>
                      <div className="min-w-0">
                        <span className="font-mono font-semibold">{r.beam.id}</span>
                        <span className="text-muted-foreground text-[10px] mr-1">
                          {r.beam.b}×{r.beam.h}mm
                        </span>
                        <span className="text-muted-foreground text-[10px]">
                          ({r.beam.direction === 'horizontal' ? 'أفقي' : 'رأسي'})
                        </span>
                      </div>
                    </div>

                    {/* Right: distance + control */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant={r.dist < 1 ? 'default' : r.dist < 100 ? 'secondary' : 'outline'}
                        className="text-[9px] px-1.5 h-4"
                      >
                        {r.dist < 1 ? '≈0' : `${r.dist.toFixed(0)}`}mm
                      </Badge>

                      {r.auto ? (
                        <span className="text-[10px] text-green-600 font-semibold whitespace-nowrap">
                          تلقائي ✓
                        </span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">
                            {r.manual ? 'مفعَّل' : 'ربط'}
                          </span>
                          <Switch
                            checked={r.manual}
                            onCheckedChange={() => toggleManual(r.beam.id)}
                            className="scale-75 origin-right"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Show/hide far beams toggle */}
          {selectedColumn && (
            <button
              onClick={() => setShowFar(v => !v)}
              className="w-full mt-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors py-1 text-center"
            >
              {showFar ? '← إخفاء الجسور البعيدة' : '← إظهار الجسور البعيدة (>1m)'}
            </button>
          )}
        </ScrollArea>

        {/* ── Footer ────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-t bg-muted/20 flex items-center justify-between gap-3">
          <p className="text-[10px] text-muted-foreground leading-tight">
            💡 فعّل التبديل لربط جسر بهذا العمود يدوياً، ثم أعد التحليل.
          </p>
          {onRequestReanalyze && (
            <Button
              size="sm"
              className="text-xs h-7 px-3 shrink-0"
              onClick={() => { onRequestReanalyze(); onOpenChange(false); }}
            >
              🔄 إعادة التحليل
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
