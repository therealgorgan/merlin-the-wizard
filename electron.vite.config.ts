import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          sprite: resolve(__dirname, 'src/preload/sprite.ts'),
          bubble: resolve(__dirname, 'src/preload/bubble.ts'),
          settings: resolve(__dirname, 'src/preload/settings.ts'),
          debug: resolve(__dirname, 'src/preload/debug.ts'),
          history: resolve(__dirname, 'src/preload/history.ts'),
          chatPanel: resolve(__dirname, 'src/preload/chatPanel.ts'),
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias },
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          sprite: resolve(__dirname, 'src/renderer/sprite/index.html'),
          bubble: resolve(__dirname, 'src/renderer/bubble/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
          debug: resolve(__dirname, 'src/renderer/debug/index.html'),
          history: resolve(__dirname, 'src/renderer/history/index.html'),
          chatPanel: resolve(__dirname, 'src/renderer/chat-panel/index.html'),
        },
        // React is imported from settings/main.tsx; ensure it's included.
      },
    },
  },
});
