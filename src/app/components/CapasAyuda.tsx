"use client";

import { useEffect, useRef } from "react";
import { TRACKS } from "@/sim/tracks";
import { measureOnNextFrame } from "@/debug/latencias";
import { AYUDA, FICHAS_PISTA, SECCIONES_GUIA, type PantallaAyuda } from "../ayuda/textos";

/** El «?» de cada pantalla: uno solo, fijo arriba a la derecha, para no repetirlo en diez cabeceras. */
export function BotonAyuda(props: { onClick: () => void }) {
  return (
    <button type="button" className="pastilla ayuda-boton" aria-label="Ayuda" data-testid="ayuda-boton" onClick={props.onClick}>
      ?
    </button>
  );
}

function useEsc(alCerrar: () => void) {
  const ref = useRef(alCerrar);
  useEffect(() => {
    ref.current = alCerrar;
  });
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") ref.current();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);
}

export function PanelAyuda(props: { pantalla: PantallaAyuda; onCerrar: () => void; onGuia: (seccion: string) => void; visible: boolean }) {
  const t = AYUDA[props.pantalla];
  const cerrar = useRef<HTMLButtonElement>(null);
  useEsc(() => {
    // Con la guía encima, Esc la cierra a ella y no a este panel.
    if (props.visible) props.onCerrar();
  });
  useEffect(() => {
    cerrar.current?.focus();
    measureOnNextFrame("ayuda");
  }, []);
  return (
    <div
      className="capa-fondo"
      data-testid="ayuda-fondo"
      hidden={!props.visible}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onCerrar();
      }}
    >
      <div className="ayuda-panel" role="dialog" aria-modal="true" aria-labelledby="ayuda-titulo" data-testid="ayuda-panel">
        <div className="ayuda-cabecera">
          <h2 id="ayuda-titulo" data-testid="ayuda-titulo">
            {t.titulo}
          </h2>
          <button ref={cerrar} type="button" className="pastilla" aria-label="Cerrar la ayuda" data-testid="ayuda-cerrar" onClick={props.onCerrar}>
            ✕
          </button>
        </div>
        <div className="ayuda-cuerpo" data-testid="ayuda-cuerpo">
          <p className="ayuda-resumen">{t.resumen}</p>
          <ul className="ayuda-controles">
            {t.controles.map((c) => (
              <li key={c.nombre}>
                <strong>{c.nombre}</strong>: {c.texto}
              </li>
            ))}
          </ul>
        </div>
        <button type="button" className="pastilla principal" data-testid="ayuda-guia" onClick={() => props.onGuia(t.seccionGuia)}>
          Ver la guía completa
        </button>
      </div>
    </div>
  );
}

export function ComoSeJuega(props: { seccion: string | null; onVolver: () => void }) {
  const raiz = useRef<HTMLDivElement>(null);
  useEsc(props.onVolver);
  useEffect(() => {
    if (!props.seccion) return;
    raiz.current?.querySelector(`[data-seccion="${props.seccion}"]`)?.scrollIntoView({ block: "start" });
  }, [props.seccion]);
  return (
    <div className="guia" role="dialog" aria-modal="true" aria-labelledby="guia-titulo" ref={raiz} data-testid="guia">
      <div className="guia-cabecera">
        <button type="button" className="pastilla" data-testid="guia-volver" onClick={props.onVolver}>
          ← Volver
        </button>
        <h2 id="guia-titulo" data-testid="guia-titulo">
          Cómo se juega
        </h2>
      </div>
      <div className="guia-cuerpo">
        <nav aria-label="Secciones" className="guia-indice" data-testid="guia-indice">
          {SECCIONES_GUIA.map((s) => (
            <button
              key={s.id}
              type="button"
              className="pastilla chica"
              data-testid={`guia-ir-${s.id}`}
              onClick={() => raiz.current?.querySelector(`[data-seccion="${s.id}"]`)?.scrollIntoView({ block: "start" })}
            >
              {s.titulo}
            </button>
          ))}
        </nav>
        {SECCIONES_GUIA.map((s) => (
          <section key={s.id} data-seccion={s.id} data-testid={`guia-seccion-${s.id}`}>
            <h3>{s.titulo}</h3>
            {s.parrafos.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {s.id === "pistas" && (
              <ul className="guia-fichas">
                {TRACKS.map((t) => (
                  <li key={t.id} data-testid={`ficha-${t.id}`}>
                    <strong>{t.name}</strong>: {FICHAS_PISTA[t.id].mecanica} Premia: {FICHAS_PISTA[t.id].premia}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
