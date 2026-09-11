import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  /**
   * Bundle our own workspace packages, but never anything from node_modules.
   *
   * Without skipNodeModulesBundle, tsup resolves externals from THIS package's
   * dependencies only — so transitive deps of @gitweave/* (dotenv, mongodb,
   * pino) got inlined. CJS packages that call require('fs') then die at boot
   * inside an ESM bundle with "Dynamic require of fs is not supported".
   */
  noExternal: [/^@gitweave\//],
  skipNodeModulesBundle: true,
  splitting: false,
  sourcemap: true,
});
