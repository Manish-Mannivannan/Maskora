import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// Next.js is the interface's build tool only: `next build` writes a static
// export to `out/`, which Tauri bundles. No Next.js server runs in the
// installed app, so server features (route handlers, server actions, proxy,
// image optimisation) are unavailable by design (architecture §14.1).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // Tauri serves the export from its own origin; keep asset URLs relative to it.
  trailingSlash: false,
  devIndicators: false,
  // Always defined so it is inlined as a constant and the probe branch is
  // dropped from normal builds, not merely skipped at run time.
  env: {
    NEXT_PUBLIC_MASKORA_PROBE: process.env.NEXT_PUBLIC_MASKORA_PROBE === "1" ? "1" : "0",
    // Recorded in saved projects and exported images.
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
