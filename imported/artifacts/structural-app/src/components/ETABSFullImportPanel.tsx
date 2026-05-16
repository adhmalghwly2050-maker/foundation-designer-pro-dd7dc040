/**
 * ETABS Full Import Panel
 * Import nodes, beams, columns, slabs from simple Excel files.
 * Each file type has a specific simplified column format using point numbers.
 */

import React, { useState, useCallback, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Upload, Eye, Check, MapPin, Columns, LayoutGrid, Maximize, Info, ChevronDown, ChevronUp } from 'lucide-react';
import * as XLSX from 'xlsx';

export interface ImportedNode {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface ImportedBeam {
  id: string;
  story: string;
  nodeI: string;
  nodeJ: string;
  section?: string;
}

export interface ImportedColumn {
  id: string;
  story: string;
  nodeI: string;
  nodeJ: string;
  section?: string;
}

export interface ImportedSlab {
  id: string;
  story: string;
  nodes: string[];
  thickness?: number;
}

export interface ETABSImportedData {
  nodes: ImportedNode[];
  beams: ImportedBeam[];
  columns: ImportedColumn[];
  slabs: ImportedSlab[];
}

interface ETABSFullImportPanelProps {
  onApply: (data: ETABSImportedData) => void;
}

function parseExcel(file: File): Promise<any[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        resolve(jsonData);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

const FORMAT_GUIDE = [
  {
    type: 'nodes',
    label: 'ملف النقاط',
    color: 'text-blue-600',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800',
    columns: [
      { col: 'A', name: 'رقم النقطة', example: '1', note: 'معرّف فريد لكل نقطة' },
      { col: 'B', name: 'X', example: '0.00', note: 'إحداثي X بالمتر' },
      { col: 'C', name: 'Y', example: '5.00', note: 'إحداثي Y بالمتر' },
      { col: 'D', name: 'Z', example: '3.00', note: 'إحداثي Z (الارتفاع) بالمتر' },
    ],
    example: [['رقم النقطة','X','Y','Z'],['1','0','0','0'],['2','5','0','0'],['3','5','5','0'],['4','0','5','0']],
  },
  {
    type: 'beams',
    label: 'ملف الجسور',
    color: 'text-green-600',
    bg: 'bg-green-50 dark:bg-green-950/30',
    border: 'border-green-200 dark:border-green-800',
    columns: [
      { col: 'A', name: 'اسم الجسر', example: 'B1', note: 'اسم أو رقم الجسر' },
      { col: 'B', name: 'رقم نقطة البداية', example: '1', note: 'رقم النقطة من ملف النقاط' },
      { col: 'C', name: 'رقم نقطة النهاية', example: '2', note: 'رقم النقطة من ملف النقاط' },
    ],
    example: [['اسم الجسر','نقطة البداية','نقطة النهاية'],['B1','1','2'],['B2','2','3'],['B3','3','4']],
  },
  {
    type: 'columns',
    label: 'ملف الأعمدة',
    color: 'text-orange-600',
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    border: 'border-orange-200 dark:border-orange-800',
    columns: [
      { col: 'A', name: 'اسم العمود', example: 'C1', note: 'اسم أو رقم العمود' },
      { col: 'B', name: 'رقم نقطة البداية', example: '1', note: 'النقطة السفلية للعمود' },
      { col: 'C', name: 'رقم نقطة النهاية', example: '5', note: 'النقطة العلوية للعمود' },
    ],
    example: [['اسم العمود','نقطة البداية','نقطة النهاية'],['C1','1','5'],['C2','2','6'],['C3','3','7']],
  },
  {
    type: 'slabs',
    label: 'ملف البلاطات',
    color: 'text-purple-600',
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    border: 'border-purple-200 dark:border-purple-800',
    columns: [
      { col: 'A', name: 'اسم البلاطة', example: 'SL1', note: 'اسم أو رقم البلاطة' },
      { col: 'B', name: 'نقطة 1', example: '1', note: 'الركن الأول' },
      { col: 'C', name: 'نقطة 2', example: '2', note: 'الركن الثاني' },
      { col: 'D', name: 'نقطة 3', example: '3', note: 'الركن الثالث' },
      { col: 'E', name: 'نقطة 4', example: '4', note: 'الركن الرابع' },
    ],
    example: [['اسم البلاطة','نقطة 1','نقطة 2','نقطة 3','نقطة 4'],['SL1','1','2','3','4'],['SL2','2','5','6','3']],
  },
];

export default function ETABSFullImportPanel({ onApply }: ETABSFullImportPanelProps) {
  const [nodes, setNodes] = useState<ImportedNode[]>([]);
  const [beams, setBeams] = useState<ImportedBeam[]>([]);
  const [columns, setColumns] = useState<ImportedColumn[]>([]);
  const [slabs, setSlabs] = useState<ImportedSlab[]>([]);
  const [activePreview, setActivePreview] = useState<'nodes' | 'beams' | 'columns' | 'slabs' | null>(null);
  const [importStatus, setImportStatus] = useState<Record<string, string>>({});
  const [showGuide, setShowGuide] = useState(true);
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImportType, setPendingImportType] = useState<string>('');

  const handleFileSelect = useCallback(async (type: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const rows = await parseExcel(file);
      if (rows.length < 2) {
        setImportStatus(prev => ({ ...prev, [type]: 'ملف فارغ أو لا يحتوي على بيانات' }));
        return;
      }

      if (type === 'nodes') {
        // Format: رقم النقطة | X | Y | Z
        const imported: ImportedNode[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 2) continue;
          const id = String(row[0] ?? '').trim();
          if (!id) continue;
          imported.push({
            id,
            x: Number(row[1]) || 0,
            y: Number(row[2]) || 0,
            z: Number(row[3]) || 0,
          });
        }
        setNodes(imported);
        setImportStatus(prev => ({ ...prev, nodes: `✓ تم استيراد ${imported.length} نقطة` }));

      } else if (type === 'beams') {
        // Format: اسم الجسر | نقطة البداية | نقطة النهاية
        const imported: ImportedBeam[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 3) continue;
          const id = String(row[0] ?? '').trim();
          const ni = String(row[1] ?? '').trim();
          const nj = String(row[2] ?? '').trim();
          if (!id || !ni || !nj) continue;
          imported.push({ id, story: '', nodeI: ni, nodeJ: nj });
        }
        setBeams(imported);
        setImportStatus(prev => ({ ...prev, beams: `✓ تم استيراد ${imported.length} جسر` }));

      } else if (type === 'columns') {
        // Format: اسم العمود | نقطة البداية | نقطة النهاية
        const imported: ImportedColumn[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 3) continue;
          const id = String(row[0] ?? '').trim();
          const ni = String(row[1] ?? '').trim();
          const nj = String(row[2] ?? '').trim();
          if (!id || !ni || !nj) continue;
          imported.push({ id, story: '', nodeI: ni, nodeJ: nj });
        }
        setColumns(imported);
        setImportStatus(prev => ({ ...prev, columns: `✓ تم استيراد ${imported.length} عمود` }));

      } else if (type === 'slabs') {
        // Format: اسم البلاطة | نقطة1 | نقطة2 | نقطة3 | نقطة4
        const imported: ImportedSlab[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 3) continue;
          const id = String(row[0] ?? '').trim();
          if (!id) continue;
          const slabNodes: string[] = [];
          for (let j = 1; j <= 4; j++) {
            const pt = String(row[j] ?? '').trim();
            if (pt) slabNodes.push(pt);
          }
          if (slabNodes.length < 3) continue;
          imported.push({ id, story: '', nodes: slabNodes });
        }
        setSlabs(imported);
        setImportStatus(prev => ({ ...prev, slabs: `✓ تم استيراد ${imported.length} بلاطة` }));
      }
    } catch (err) {
      setImportStatus(prev => ({ ...prev, [type]: '✗ خطأ في قراءة الملف - تأكد من الصيغة الصحيحة' }));
    }

    if (e.target) e.target.value = '';
  }, []);

  const triggerImport = (type: string) => {
    setPendingImportType(type);
    setTimeout(() => fileRef.current?.click(), 100);
  };

  const totalImported = nodes.length + beams.length + columns.length + slabs.length;
  const canApply = nodes.length > 0 && (beams.length > 0 || columns.length > 0 || slabs.length > 0);

  const handleApply = () => {
    onApply({ nodes, beams, columns, slabs });
  };

  return (
    <div className="space-y-4 p-4">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => handleFileSelect(pendingImportType, e)}
      />

      {/* Format Guide */}
      <Card>
        <CardHeader className="pb-2">
          <button
            className="flex items-center justify-between w-full text-right"
            onClick={() => setShowGuide(v => !v)}
          >
            <CardTitle className="text-sm flex items-center gap-2">
              <Info size={15} className="text-primary" />
              صيغة ملفات الإكسل المطلوبة للاستيراد
            </CardTitle>
            {showGuide ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </CardHeader>

        {showGuide && (
          <CardContent className="space-y-3 pt-0">
            <p className="text-xs text-muted-foreground">
              أنشئ ملف إكسل منفصل لكل نوع. الصف الأول هو رأس الجدول (اختياري)، والبيانات تبدأ من الصف الثاني.
              <strong className="text-foreground"> أرقام النقاط في ملفات الجسور والأعمدة والبلاطات يجب أن تطابق أرقام النقاط في ملف النقاط.</strong>
            </p>

            <div className="grid grid-cols-1 gap-3">
              {FORMAT_GUIDE.map(guide => (
                <div key={guide.type} className={`rounded-lg border ${guide.border} ${guide.bg} overflow-hidden`}>
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 text-right"
                    onClick={() => setExpandedGuide(expandedGuide === guide.type ? null : guide.type)}
                  >
                    <span className={`text-xs font-bold ${guide.color}`}>{guide.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        {guide.columns.length} أعمدة: {guide.columns.map(c => c.col).join(' | ')}
                      </span>
                      {expandedGuide === guide.type ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </div>
                  </button>

                  {expandedGuide === guide.type && (
                    <div className="px-3 pb-3 space-y-2">
                      {/* Column description */}
                      <div className="grid gap-1">
                        {guide.columns.map(col => (
                          <div key={col.col} className="flex items-start gap-2 text-xs">
                            <span className={`font-mono font-bold ${guide.color} shrink-0 w-4`}>{col.col}</span>
                            <span className="font-semibold text-foreground shrink-0">{col.name}</span>
                            <span className="text-muted-foreground">— {col.note}</span>
                          </div>
                        ))}
                      </div>
                      {/* Example table */}
                      <div className="overflow-x-auto rounded border border-border bg-background">
                        <table className="text-[10px] w-full">
                          <thead>
                            <tr className="bg-muted/50">
                              {guide.example[0].map((h, i) => (
                                <th key={i} className="px-2 py-1 text-right font-semibold text-muted-foreground border-b border-border">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {guide.example.slice(1).map((row, ri) => (
                              <tr key={ri} className="border-b border-border last:border-0">
                                {row.map((cell, ci) => (
                                  <td key={ci} className="px-2 py-1 font-mono text-foreground">{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Import Buttons */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload size={16} /> استيراد الملفات
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            استورد النقاط أولاً، ثم استورد الجسور والأعمدة والبلاطات. بعد الاستيراد اضغط "تطبيق على النموذج".
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={nodes.length > 0 ? 'default' : 'outline'}
              className="min-h-[48px] gap-2 text-xs flex-col py-2"
              onClick={() => triggerImport('nodes')}
            >
              <MapPin size={16} />
              <span>النقاط (Nodes)</span>
              {nodes.length > 0 && <Badge variant="secondary" className="text-[9px] h-4">{nodes.length} نقطة</Badge>}
            </Button>
            <Button
              variant={beams.length > 0 ? 'default' : 'outline'}
              className="min-h-[48px] gap-2 text-xs flex-col py-2"
              onClick={() => triggerImport('beams')}
            >
              <Maximize size={16} />
              <span>الجسور (Beams)</span>
              {beams.length > 0 && <Badge variant="secondary" className="text-[9px] h-4">{beams.length} جسر</Badge>}
            </Button>
            <Button
              variant={columns.length > 0 ? 'default' : 'outline'}
              className="min-h-[48px] gap-2 text-xs flex-col py-2"
              onClick={() => triggerImport('columns')}
            >
              <Columns size={16} />
              <span>الأعمدة (Columns)</span>
              {columns.length > 0 && <Badge variant="secondary" className="text-[9px] h-4">{columns.length} عمود</Badge>}
            </Button>
            <Button
              variant={slabs.length > 0 ? 'default' : 'outline'}
              className="min-h-[48px] gap-2 text-xs flex-col py-2"
              onClick={() => triggerImport('slabs')}
            >
              <LayoutGrid size={16} />
              <span>البلاطات (Slabs)</span>
              {slabs.length > 0 && <Badge variant="secondary" className="text-[9px] h-4">{slabs.length} بلاطة</Badge>}
            </Button>
          </div>

          {/* Import status messages */}
          {Object.entries(importStatus).length > 0 && (
            <div className="space-y-1 bg-muted/50 rounded-lg p-2">
              {Object.entries(importStatus).map(([key, msg]) => (
                <div key={key} className={`flex items-center gap-2 text-xs ${msg.startsWith('✓') ? 'text-green-600' : 'text-destructive'}`}>
                  <span className="font-mono font-bold">{msg}</span>
                </div>
              ))}
            </div>
          )}

          {/* Preview toggle buttons */}
          {totalImported > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground font-medium">معاينة البيانات المستوردة:</p>
              <div className="flex flex-wrap gap-1">
                {nodes.length > 0 && (
                  <Button size="sm" variant={activePreview === 'nodes' ? 'default' : 'ghost'} className="h-7 text-xs"
                    onClick={() => setActivePreview(activePreview === 'nodes' ? null : 'nodes')}>
                    <Eye size={11} className="mr-1" /> النقاط ({nodes.length})
                  </Button>
                )}
                {beams.length > 0 && (
                  <Button size="sm" variant={activePreview === 'beams' ? 'default' : 'ghost'} className="h-7 text-xs"
                    onClick={() => setActivePreview(activePreview === 'beams' ? null : 'beams')}>
                    <Eye size={11} className="mr-1" /> الجسور ({beams.length})
                  </Button>
                )}
                {columns.length > 0 && (
                  <Button size="sm" variant={activePreview === 'columns' ? 'default' : 'ghost'} className="h-7 text-xs"
                    onClick={() => setActivePreview(activePreview === 'columns' ? null : 'columns')}>
                    <Eye size={11} className="mr-1" /> الأعمدة ({columns.length})
                  </Button>
                )}
                {slabs.length > 0 && (
                  <Button size="sm" variant={activePreview === 'slabs' ? 'default' : 'ghost'} className="h-7 text-xs"
                    onClick={() => setActivePreview(activePreview === 'slabs' ? null : 'slabs')}>
                    <Eye size={11} className="mr-1" /> البلاطات ({slabs.length})
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview: Nodes */}
      {activePreview === 'nodes' && nodes.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">النقاط المستوردة</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto max-h-64 overflow-y-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {['رقم النقطة', 'X (م)', 'Y (م)', 'Z (م)'].map(h => (
                    <TableHead key={h} className="text-xs">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.slice(0, 200).map(n => (
                  <TableRow key={n.id}>
                    <TableCell className="font-mono text-xs font-bold">{n.id}</TableCell>
                    <TableCell className="font-mono text-xs">{n.x.toFixed(3)}</TableCell>
                    <TableCell className="font-mono text-xs">{n.y.toFixed(3)}</TableCell>
                    <TableCell className="font-mono text-xs">{n.z.toFixed(3)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {nodes.length > 200 && <p className="text-xs text-muted-foreground p-2">... و {nodes.length - 200} نقطة أخرى</p>}
          </CardContent>
        </Card>
      )}

      {/* Preview: Beams */}
      {activePreview === 'beams' && beams.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">الجسور المستوردة</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto max-h-64 overflow-y-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {['اسم الجسر', 'نقطة البداية (I)', 'نقطة النهاية (J)'].map(h => (
                    <TableHead key={h} className="text-xs">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {beams.slice(0, 200).map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs font-bold">{b.id}</TableCell>
                    <TableCell className="font-mono text-xs">{b.nodeI}</TableCell>
                    <TableCell className="font-mono text-xs">{b.nodeJ}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {beams.length > 200 && <p className="text-xs text-muted-foreground p-2">... و {beams.length - 200} جسر آخر</p>}
          </CardContent>
        </Card>
      )}

      {/* Preview: Columns */}
      {activePreview === 'columns' && columns.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">الأعمدة المستوردة</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto max-h-64 overflow-y-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {['اسم العمود', 'نقطة البداية (I)', 'نقطة النهاية (J)'].map(h => (
                    <TableHead key={h} className="text-xs">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {columns.slice(0, 200).map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs font-bold">{c.id}</TableCell>
                    <TableCell className="font-mono text-xs">{c.nodeI}</TableCell>
                    <TableCell className="font-mono text-xs">{c.nodeJ}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {columns.length > 200 && <p className="text-xs text-muted-foreground p-2">... و {columns.length - 200} عمود آخر</p>}
          </CardContent>
        </Card>
      )}

      {/* Preview: Slabs */}
      {activePreview === 'slabs' && slabs.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">البلاطات المستوردة</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto max-h-64 overflow-y-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {['اسم البلاطة', 'نقطة 1', 'نقطة 2', 'نقطة 3', 'نقطة 4'].map(h => (
                    <TableHead key={h} className="text-xs">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {slabs.slice(0, 200).map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs font-bold">{s.id}</TableCell>
                    <TableCell className="font-mono text-xs">{s.nodes[0] || '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{s.nodes[1] || '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{s.nodes[2] || '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{s.nodes[3] || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {slabs.length > 200 && <p className="text-xs text-muted-foreground p-2">... و {slabs.length - 200} بلاطة أخرى</p>}
          </CardContent>
        </Card>
      )}

      {/* Model preview SVG */}
      {totalImported > 0 && nodes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">معاينة النموذج (مسقط أفقي)</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <div className="relative w-full h-52 border border-border rounded bg-background overflow-hidden">
              {(() => {
                const xs = nodes.map(n => n.x);
                const ys = nodes.map(n => n.y);
                const minX = Math.min(...xs) - 1;
                const minY = Math.min(...ys) - 1;
                const w = Math.max(...xs) - Math.min(...xs) + 2;
                const h = Math.max(...ys) - Math.min(...ys) + 2;
                return (
                  <svg viewBox={`${minX} ${minY} ${w} ${h}`} className="w-full h-full">
                    {beams.map(b => {
                      const ni = nodes.find(n => n.id === b.nodeI);
                      const nj = nodes.find(n => n.id === b.nodeJ);
                      if (!ni || !nj) return null;
                      return <line key={b.id} x1={ni.x} y1={ni.y} x2={nj.x} y2={nj.y} stroke="hsl(var(--primary))" strokeWidth={w * 0.008} />;
                    })}
                    {columns.map(c => {
                      const ni = nodes.find(n => n.id === c.nodeI);
                      if (!ni) return null;
                      const sz = w * 0.03;
                      return <rect key={c.id} x={ni.x - sz / 2} y={ni.y - sz / 2} width={sz} height={sz} fill="hsl(var(--destructive))" opacity="0.8" />;
                    })}
                    {nodes.map(n => (
                      <g key={n.id}>
                        <circle cx={n.x} cy={n.y} r={w * 0.015} fill="hsl(var(--foreground))" />
                        <text x={n.x + w * 0.018} y={n.y + w * 0.015} fontSize={w * 0.06} fill="hsl(var(--muted-foreground))">{n.id}</text>
                      </g>
                    ))}
                  </svg>
                );
              })()}
            </div>
            <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-primary inline-block" /> جسور ({beams.length})</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-destructive inline-block rounded-sm opacity-80" /> أعمدة ({columns.length})</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-foreground inline-block rounded-full" /> نقاط ({nodes.length})</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Apply button */}
      {canApply && (
        <Button className="w-full min-h-[48px] gap-2 text-sm font-bold" onClick={handleApply}>
          <Check size={18} /> تطبيق على النموذج الرئيسي وبدء التحليل
        </Button>
      )}

      {!canApply && nodes.length === 0 && (
        <p className="text-xs text-center text-muted-foreground py-2">
          ابدأ باستيراد ملف النقاط أولاً، ثم استورد الجسور أو الأعمدة أو البلاطات
        </p>
      )}
    </div>
  );
}
