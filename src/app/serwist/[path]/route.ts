import { createSerwistRoute } from "@serwist/turbopack";

// La revisión llega de next.config.ts: "/" y el manifiesto no llevan hash en la
// URL, así que sin ella el worker nuevo no sabría que cambiaron.
const revision = process.env.NEXT_PUBLIC_VERSION_APP ?? "local";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  additionalPrecacheEntries: [
    { url: "/", revision },
    { url: "/manifest.webmanifest", revision },
  ],
  useNativeEsbuild: true,
});
