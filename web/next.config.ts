import type { NextConfig } from 'next';

// Static-first web channel (plan 2026-09-16-web-audio-version): the build emits
// a static export; Vercel publication itself belongs to G10.02.b.
// experimental.globalNotFound: the exported site has locale root layouts
// (route groups, G21.01) and no single top-level root layout, so the global
// 404 uses the global-not-found file convention that renders its own
// document — the only way the shared 404.html declares a lang. The
// document-language scan (scan-rendered.ts) fails the build if that lang is
// lost again.
const nextConfig: NextConfig = {
  output: 'export',
  experimental: {
    globalNotFound: true,
  },
};

export default nextConfig;
