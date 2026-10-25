"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { limpiarNombre } from "@/storage/nombres";
import { markInput, measureOnNextFrame } from "@/debug/latencias";

export const AYUDA_NOMBRE = "Pon el nombre que quieras: podrás cambiarlo en el Garaje";

/**
 * Hoja anclada arriba, para que el teclado del móvil no la tape, con la evolución o el garaje a la vista debajo.
 * Quien la monta decide qué hace «Guardar»; cerrar (Esc, fuera, «Cancelar» o «atrás») es siempre `onCerrar`.
 */
export function HojaNombre(props: {
  modo: "guardar" | "renombrar";
  valorInicial: string;
  ficha: string;
  onGuardar: (valor: string) => Promise<void>;
  onCerrar: () => void;
  /** Con él, un nombre vacío no se acepta: la hoja avisa y conserva el anterior (el Taller no tiene un propuesto de repuesto). */
  exigirTexto?: boolean;
}) {
  const [valor, setValor] = useState(props.valorInicial);
  const [guardando, setGuardando] = useState(false);
  const [vacio, setVacio] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cerrar = useRef(props.onCerrar);
  const previo = useRef<Element | null>(null);

  useEffect(() => {
    cerrar.current = props.onCerrar;
  });

  useEffect(() => {
    // El foco vuelve a quien abrió la hoja, también si se cierra por «atrás».
    previo.current = document.activeElement;
    const el = input.current;
    el?.focus();
    el?.select();
    measureOnNextFrame("hoja-nombre");
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar.current();
    };
    window.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("keydown", tecla);
      const volver = previo.current;
      if (volver instanceof HTMLElement && volver.isConnected) volver.focus();
    };
  }, []);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    if (props.exigirTexto && limpiarNombre(valor) === "") {
      setVacio(true);
      return;
    }
    setGuardando(true);
    if (props.modo === "guardar") markInput("guardar-nombre");
    await props.onGuardar(valor);
  };

  return (
    <div
      className="hoja-nombre-fondo"
      data-testid="hoja-nombre-fondo"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onCerrar();
      }}
    >
      <form className="hoja-nombre" role="dialog" aria-modal="true" aria-labelledby="hoja-nombre-titulo" data-testid="hoja-nombre" onSubmit={enviar}>
        <h2 id="hoja-nombre-titulo">{props.modo === "guardar" ? "Guardar campeón" : "Renombrar coche"}</h2>
        <p className="hoja-nombre-ficha" data-testid="hoja-nombre-ficha">
          {props.ficha}
        </p>
        <input
          ref={input}
          type="text"
          className="hoja-nombre-input"
          data-testid="nombre-input"
          aria-label="Nombre del coche"
          aria-describedby="hoja-nombre-ayuda"
          autoComplete="off"
          enterKeyHint="done"
          value={valor}
          onChange={(e) => {
            setValor(e.target.value);
            setVacio(false);
          }}
        />
        <p id="hoja-nombre-ayuda" className="hoja-nombre-ayuda" data-testid="nombre-ayuda">
          {AYUDA_NOMBRE}
        </p>
        {vacio && (
          <p className="hoja-nombre-error" role="alert" data-testid="nombre-error">
            Ponle un nombre de al menos una letra
          </p>
        )}
        <div className="acciones">
          <button type="submit" className="pastilla principal" disabled={guardando} data-testid="nombre-guardar">
            Guardar
          </button>
          <button type="button" className="pastilla" data-testid="nombre-cancelar" onClick={props.onCerrar}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
