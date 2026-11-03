import { defineConfig } from 'vitest/config'
import { arcoStyle } from './scripts/arco-style.mjs'

/**
 * Browser-half tests (the UI slot engine and controls) run under jsdom.
 *
 * The host-half tests stay on `node --test` against `dist/` — see
 * package.json `test`. Splitting the two runners keeps each half tested in the
 * environment it actually ships into, and keeps the Node build free of DOM/JSX.
 */
export default defineConfig({
  plugins: [arcoStyle()],
  test: {
    environment: 'jsdom',
    include: ['tests/ui/**/*.spec.tsx', 'tests/ui/**/*.spec.ts'],
    setupFiles: ['tests/ui/setup.ts'],
    restoreMocks: true,
    // 宿主原语包含 CSS 模块，需要由 Vite 转换后在 jsdom 中渲染。
    server: { deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives', '@arco-design/web-react'] } },
  },
  esbuild: {
    jsx: 'automatic',
  },
})
