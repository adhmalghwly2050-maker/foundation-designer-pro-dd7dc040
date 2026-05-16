import { registerPlugin } from '@capacitor/core';

export interface PrintPluginInterface {
  printHTML(options: { html: string; jobName?: string }): Promise<void>;
}

const PrintPlugin = registerPlugin<PrintPluginInterface>('PrintPlugin', {
  web: {
    async printHTML({ html }: { html: string; jobName?: string }) {
      const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
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
    },
  },
});

export { PrintPlugin };
