import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.analyzer.structural3d',
  appName: '3D Structural Analyzer',
  webDir: 'dist',
  server: {
    url: 'https://63357288-609b-4a55-b49b-078a3ba9d5ce.lovableproject.com?forceHideBadge=true',
    cleartext: true
  }
};

export default config;
