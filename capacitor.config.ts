import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.harrymurrayy.slingplane',
  appName: 'Slingwing',
  webDir: 'dist',
  ios: {
    // The game draws edge to edge; the CSS handles the notch and home bar
    contentInset: 'never',
    backgroundColor: '#27306a',
  },
};

export default config;
