import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['libsodium-wrappers-sumo'] })],
    resolve: {
      alias: {
        // Point directly at the CJS build to bypass the broken ESM entry.
        'libsodium-wrappers-sumo': resolve('node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js'),
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
    build: {
      // Output as CJS so Electron loads it as index.js (not index.mjs).
      lib: { entry: resolve('src/preload/index.ts'), formats: ['cjs'] },
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer'),
      },
    },
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          dashboard: resolve('src/renderer/dashboard.html'),
        },
      },
    },
  },
});
