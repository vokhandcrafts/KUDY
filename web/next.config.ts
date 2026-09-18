import type { NextConfig } from 'next';

// Static-first web channel (plan 2026-09-16-web-audio-version): the build emits
// a static export; Vercel publication itself belongs to G10.02.b.
const nextConfig: NextConfig = {
  output: 'export',
};

export default nextConfig;
