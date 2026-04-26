/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cache Components are GA in Next 16. They require every uncached fetch to
  // be wrapped in <Suspense>. We design our pages around them in v0.2 — for
  // the hackathon MVP we keep it disabled so dashboard data can stream without
  // a Suspense boundary. See PLAN.md §6.3 for the future-state pattern.
  // cacheComponents: true,
  typedRoutes: true,
  transpilePackages: ['@peec-lab/ui', '@peec-lab/database'],
};

export default nextConfig;
