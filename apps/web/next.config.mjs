/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Monorepo: trace workspace packages from the repo root so the standalone
  // bundle contains @gitweave/* and their transitive deps.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  transpilePackages: ['@gitweave/core', '@gitweave/types', '@carbon/react', '@carbon/charts-react'],
  sassOptions: {
    // Carbon and Carbon Charts still emit legacy Sass API warnings; silencing
    // keeps real build errors visible.
    silenceDeprecations: ['global-builtin', 'import', 'legacy-js-api', 'color-functions'],
    quietDeps: true,
  },
  experimental: { optimizePackageImports: ['@carbon/react', '@carbon/icons-react'] },
};
export default nextConfig;
