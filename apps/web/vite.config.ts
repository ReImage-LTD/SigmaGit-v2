import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteTsConfigPaths from 'vite-tsconfig-paths';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { nitro } from 'nitro/vite';
import { buildWebSecurityHeaders } from './lib/security-headers';

const isProduction = process.env.NODE_ENV === 'production';
const apiUrl = process.env.VITE_API_URL || process.env.API_URL || 'http://localhost:3001';
const enableDatabuddy = process.env.VITE_ENABLE_DATABUDDY === 'true';

const securityHeaders = buildWebSecurityHeaders({
  isProduction,
  apiUrl,
  enableDatabuddy,
});

export default defineConfig({
  // Load .env from monorepo root so root-level deployment config is respected.
  envDir: '../..',
  server: {
    port: 3000,
    allowedHosts: ['sigmagit.com'],
    headers: securityHeaders,
  },
  plugins: [
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart({
      srcDirectory: '.',
      router: {
        routesDirectory: 'app',
      },
    }),
    nitro({
      routeRules: {
        '/**': {
          headers: securityHeaders,
        },
      },
    }),
    viteReact(),
  ],
});
