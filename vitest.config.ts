import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Strip .js extensions so vitest resolves .ts files (ESM-compatible imports)
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/__tests__/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
  },
})


