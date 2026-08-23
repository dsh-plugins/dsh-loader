import { defineConfig } from 'vitest/config'

/**
 * Browser-half tests (the UI slot engine and controls) run under jsdom.
 *
 * The host-half tests stay on `node --test` against `dist/` — see
 * package.json `test`. Splitting the two runners keeps each half tested in the
 * environment it actually ships into, and keeps the Node build free of DOM/JSX.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/ui/**/*.spec.tsx', 'tests/ui/**/*.spec.ts'],
    setupFiles: ['tests/ui/setup.ts'],
    restoreMocks: true,
  },
  esbuild: {
    jsx: 'automatic',
  },
})
