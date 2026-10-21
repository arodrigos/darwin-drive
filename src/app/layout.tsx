import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegistroPwa } from "@/pwa/RegistroPwa";

export const metadata: Metadata = {
  title: "Darwin Drive",
  description: "Diseña un coche o deja que evolucione: siete pistas infinitas, cada una con su ranking.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body>{children}
        <RegistroPwa />
      </body>
    </html>
  );
}
