import type { MetadataRoute } from "next";

// Sin iconos binarios: el repositorio no lleva activos externos. Con el
// manifiesto basta para «Añadir a pantalla de inicio» y abrirlo sin barra.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Darwin Drive",
    short_name: "Darwin Drive",
    start_url: "/",
    display: "standalone",
    background_color: "#12141a",
    theme_color: "#12141a",
    lang: "es",
  };
}
