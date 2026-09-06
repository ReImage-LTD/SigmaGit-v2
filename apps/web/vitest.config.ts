import { defineConfig } from 'vitest/config';

// Unit tests do not need to start the application's SSR server or Nitro workers.
export default defineConfig({ test: { environment: 'node' } });
