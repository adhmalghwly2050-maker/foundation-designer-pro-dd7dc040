import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Toast } from '@capacitor/toast';

const isNative = () => Capacitor.isNativePlatform();

async function showToast(text: string) {
  if (isNative()) {
    try {
      await Toast.show({ text, duration: 'long' });
    } catch {
      console.warn('Toast failed:', text);
    }
  }
}

async function saveToDocuments(filename: string, data: string, encoding?: Encoding): Promise<void> {
  const opts: Parameters<typeof Filesystem.writeFile>[0] = {
    path: filename,
    data,
    directory: Directory.Documents,
    recursive: true,
  };
  if (encoding) opts.encoding = encoding;
  await Filesystem.writeFile(opts);
  await showToast(`تم حفظ الملف: ${filename}`);
}

export async function downloadText(filename: string, content: string, _mimeType = 'text/plain'): Promise<void> {
  if (!isNative()) {
    const blob = new Blob([content], { type: _mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }
  try {
    await saveToDocuments(filename, content, Encoding.UTF8);
  } catch (err: any) {
    console.error('Capacitor file save error:', err);
    await showToast(`حدث خطأ أثناء حفظ الملف: ${err?.message || ''}`);
  }
}

export async function downloadTextWithBOM(filename: string, content: string): Promise<void> {
  return downloadText(filename, '\uFEFF' + content, 'text/csv;charset=utf-8;');
}

export async function downloadBase64(filename: string, base64Data: string, mimeType = 'application/octet-stream'): Promise<void> {
  if (!isNative()) {
    const byteChars = atob(base64Data);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArray], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }
  try {
    await saveToDocuments(filename, base64Data);
  } catch (err: any) {
    console.error('Capacitor base64 save error:', err);
    await showToast(`حدث خطأ أثناء حفظ الملف: ${err?.message || ''}`);
  }
}

export async function downloadDXF(content: string, filename: string): Promise<void> {
  return downloadText(filename, content, 'application/dxf');
}

export async function downloadCSV(filename: string, content: string): Promise<void> {
  return downloadTextWithBOM(filename, content);
}

export async function downloadJsPDF(doc: any, filename: string): Promise<void> {
  if (!isNative()) {
    doc.save(filename);
    return;
  }
  try {
    const base64 = doc.output('datauristring').split(',')[1];
    await saveToDocuments(filename, base64);
  } catch (err: any) {
    console.error('PDF save error:', err);
    await showToast(`حدث خطأ أثناء حفظ PDF: ${err?.message || ''}`);
  }
}

export async function openHTMLForPrint(htmlContent: string, jobName = 'اللوحات الإنشائية'): Promise<void> {
  if (!isNative()) {
    const blob = new Blob([htmlContent], { type: 'text/html; charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const w = window.open(blobUrl, '_blank');
    if (w) {
      w.addEventListener('load', () => {
        setTimeout(() => {
          w.print();
          URL.revokeObjectURL(blobUrl);
        }, 800);
      });
    }
    return;
  }
  try {
    const { PrintPlugin } = await import('@/lib/printPlugin');
    await PrintPlugin.printHTML({ html: htmlContent, jobName });
  } catch (err: any) {
    console.error('Android print error:', err);
    await showToast('جاري فتح مربع حوار الطباعة...');
    try {
      const filename = `sheets_${Date.now()}.html`;
      await saveToDocuments(filename, htmlContent, Encoding.UTF8);
    } catch (e2: any) {
      await showToast('حدث خطأ أثناء تصدير اللوحات للطباعة');
    }
  }
}
