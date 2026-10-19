"use client";

import dynamic from "next/dynamic";

// Todo lee IndexedDB y window al montarse: sin SSR no hay estado de servidor que la hidratación arrastre.
const App = dynamic(() => import("@/app/App").then((m) => m.App), { ssr: false });

export default function Home() {
  return (
    <main className="raiz">
      <App />
    </main>
  );
}
