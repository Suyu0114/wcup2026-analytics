import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    // Default node env for pure-logic tests; component tests opt into jsdom via a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
