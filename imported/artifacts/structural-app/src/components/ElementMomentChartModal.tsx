import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Legend,
} from 'recharts';
import type { Beam, Column, Slab, FrameResult } from '@/lib/structuralEngine';

interface Props {
  open: boolean;
  onClose: () => void;
  elementType: 'beam' | 'column' | 'slab';
  elementId: string;
  beams: Beam[];
  columns: Column[];
  slabs: Slab[];
  frameResults: FrameResult[];
  beamDesigns?: { beamId: string; flexLeft: any; flexMid: any; flexRight: any }[];
  colDesigns?: { id: string; b: number; h: number; Pu: number; design: any }[];
}

/**
 * Bending-moment diagram along the length of the selected element.
 *
 * For beams: M(x) is sampled from the analysis result using a quadratic that
 * matches Mleft, Mmid, Mright (typical 3-point parabolic envelope).
 * For columns: shows a linear M(z) from base to top.
 * For slabs: shows the strip moment in the short and long directions.
 */
export default function ElementMomentChartModal({
  open, onClose, elementType, elementId,
  beams, columns, slabs, frameResults, beamDesigns, colDesigns,
}: Props) {

  const data = useMemo(() => {
    if (elementType === 'beam') {
      const beam = beams.find(b => b.id === elementId);
      if (!beam) return null;
      // Find frame result for this beam
      let Mleft = 0, Mmid = 0, Mright = 0, Vu = 0;
      for (const fr of frameResults) {
        const br = fr.beams.find(bb => bb.beamId === elementId);
        if (br) { Mleft = br.Mleft; Mmid = br.Mmid; Mright = br.Mright; Vu = (br as any).Vu ?? 0; break; }
      }
      const L = beam.length;
      // Parabolic interpolation matching the 3 control points
      // M(t) where t in [0..1]: a + b t + c t^2 ; M(0)=Mleft, M(0.5)=Mmid, M(1)=Mright
      const a = Mleft;
      const b = -3 * Mleft + 4 * Mmid - Mright;
      const c = 2 * Mleft - 4 * Mmid + 2 * Mright;
      const N = 41;
      const points = Array.from({ length: N }, (_, i) => {
        const t = i / (N - 1);
        const x = +(t * L).toFixed(3);
        const M = +(a + b * t + c * t * t).toFixed(2);
        return { x, M };
      });
      return {
        title: `الجسر ${elementId} — مخطط العزم على طول الجسر`,
        subtitle: `الطول = ${L.toFixed(2)} م · M⁻ يسار = ${Mleft.toFixed(1)} · M⁺ منتصف = ${Mmid.toFixed(1)} · M⁻ يمين = ${Mright.toFixed(1)}  (kN·m)`,
        xLabel: 'المسافة على طول الجسر  x  (م)',
        Vu,
        points,
      };
    }
    if (elementType === 'column') {
      const col = colDesigns?.find(c => c.id === elementId);
      if (!col) return null;
      const Pu = col.Pu ?? 0;
      // Approximate: assume Mtop & Mbot from design package if available
      const Mtop = (col.design && (col.design.Mtop ?? col.design.M ?? 0)) || 0;
      const Mbot = (col.design && (col.design.Mbot ?? -Mtop)) || 0;
      const H = (((col as any).L ?? (col as any).length ?? 3000) as number) / 1000;
      const N = 21;
      const points = Array.from({ length: N }, (_, i) => {
        const t = i / (N - 1);
        const z = +(t * H).toFixed(3);
        // Linear variation between Mbot (z=0) and Mtop (z=H)
        const M = +(Mbot + (Mtop - Mbot) * t).toFixed(2);
        return { x: z, M };
      });
      return {
        title: `العمود ${elementId} — مخطط العزم على ارتفاع العمود`,
        subtitle: `الارتفاع = ${H.toFixed(2)} م · Pu = ${Pu.toFixed(0)} kN · Mأعلى = ${Mtop.toFixed(1)} · Mأسفل = ${Mbot.toFixed(1)} (kN·m)`,
        xLabel: 'الارتفاع  z  (م)',
        Vu: 0,
        points,
      };
    }
    if (elementType === 'slab') {
      const slab = slabs.find(s => s.id === elementId);
      if (!slab) return null;
      // For slabs we don't have an analysis moment-line directly here,
      // so derive a parabolic strip moment ≈ wL²/8 in each direction using slab self-weight + a default LL.
      const Lx = Math.abs(slab.x2 - slab.x1);
      const Ly = Math.abs(slab.y2 - slab.y1);
      const L = Math.min(Lx, Ly);
      const w = ((slab as any).load ?? (slab as any).w ?? 6); // kN/m² fallback
      const Mmax = w * L * L / 8;
      const N = 31;
      const points = Array.from({ length: N }, (_, i) => {
        const t = i / (N - 1);
        const x = +(t * L).toFixed(3);
        const M = +(4 * Mmax * t * (1 - t)).toFixed(2);
        return { x, M };
      });
      return {
        title: `البلاطة ${elementId} — مخطط العزم في الاتجاه القصير`,
        subtitle: `Lx = ${Lx.toFixed(2)} م · Ly = ${Ly.toFixed(2)} م · w ≈ ${w.toFixed(1)} kN/m² · Mmax ≈ ${Mmax.toFixed(2)} kN·m/m`,
        xLabel: 'المسافة على عرض البلاطة  (م)',
        Vu: 0,
        points,
      };
    }
    return null;
  }, [elementType, elementId, beams, columns, slabs, frameResults, beamDesigns, colDesigns]);

  if (!data) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>لا توجد بيانات تحليل</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">شغّل التحليل أولاً ثم اضغط على العنصر مرة أخرى.</p>
        </DialogContent>
      </Dialog>
    );
  }

  const Mmax = Math.max(...data.points.map(p => Math.abs(p.M)), 0.001);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-base">{data.title}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2 mb-2">{data.subtitle}</p>

        <div className="w-full h-[340px] bg-card border border-border rounded-lg p-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.points} margin={{ top: 12, right: 16, left: 8, bottom: 28 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="x"
                type="number"
                domain={['dataMin', 'dataMax']}
                tick={{ fontSize: 10 }}
                label={{ value: data.xLabel, position: 'insideBottom', offset: -10, fontSize: 11 }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                domain={[-Mmax * 1.1, Mmax * 1.1]}
                label={{ value: 'العزم  M  (kN·m)', angle: -90, position: 'insideLeft', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', fontSize: 11 }}
                formatter={(v: number) => [`${v.toFixed(2)} kN·m`, 'M']}
                labelFormatter={(x: number) => `x = ${Number(x).toFixed(2)} م`}
              />
              <ReferenceLine y={0} stroke="hsl(var(--foreground))" strokeWidth={1} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                type="monotone"
                dataKey="M"
                fill="hsl(210 70% 50% / 0.18)"
                stroke="none"
                name="مساحة المخطط"
              />
              <Line
                type="monotone"
                dataKey="M"
                stroke="hsl(210 70% 45%)"
                strokeWidth={2}
                dot={false}
                name="منحنى العزم  M(x)"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 text-[11px] text-muted-foreground bg-muted/50 rounded p-2 leading-relaxed">
          <div>• القيم الموجبة (فوق المحور) = <b>عزم موجب  M⁺</b> (شد سفلي).</div>
          <div>• القيم السالبة (تحت المحور) = <b>عزم سالب  M⁻</b> (شد علوي).</div>
          <div>• المنحنى مستوحى من قيم التحليل عند الطرفين والمنتصف باستخدام تقريب تربيعي (parabolic envelope).</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
