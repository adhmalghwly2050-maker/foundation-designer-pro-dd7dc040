import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.structural.master',
  appName: 'Structural Master',
  webDir: 'dist/public',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    Filesystem: {
      requestPermissions: true,
    },
    Toast: {
      duration: 'long',
    },
  },
};

export default config;
