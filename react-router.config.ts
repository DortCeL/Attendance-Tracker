import type { Config } from "@react-router/dev/config";

export default {
  // All data lives in IndexedDB on the device, so the app is a client-only SPA.
  ssr: false,
} satisfies Config;
