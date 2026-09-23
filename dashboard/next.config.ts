import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  // Fix: two package-lock.json files (root API + dashboard) confuse Next.js workspace
  // root detection. In Next.js 15 this moved from experimental to top-level.
  outputFileTracingRoot: path.join(__dirname, '../'),
}
export default nextConfig
