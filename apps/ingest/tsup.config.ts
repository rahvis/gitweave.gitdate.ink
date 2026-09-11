import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  // Inline workspace packages so the container needs no workspace resolution.
  noExternal: [/^@gitweave\//],
  splitting: false,
  sourcemap: true,
});
