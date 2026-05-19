import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/share-image": ["./public/fonts/*.woff2"],
  },
};

export default nextConfig;
