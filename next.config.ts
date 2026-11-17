import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // VEX is local-first: the production server binds to loopback only (see `npm start`).
  // The dev server may be run with -H 0.0.0.0 behind a preview proxy (e.g. *.e2b.app),
  // so allow those origins for dev assets.
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;
