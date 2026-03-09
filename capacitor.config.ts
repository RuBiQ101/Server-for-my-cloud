import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vaultserver.app',
  appName: 'Vault Server',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
