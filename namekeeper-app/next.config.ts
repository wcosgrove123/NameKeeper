import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable static export for GitHub Pages
  output: 'export',
  // Set base path for GitHub Pages (github.io/NameKeeper)
  basePath: process.env.GITHUB_ACTIONS ? '/NameKeeper' : '',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
