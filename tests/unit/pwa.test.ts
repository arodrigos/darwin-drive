import { test } from "node:test";
import assert from "node:assert/strict";
import { conectarCiclo, pulsarRecargar, type SerwistVentana } from "../../src/pwa/ciclo";
import { DATOS_PWA_INICIALES, obtenerDatosPwa, reducirEstadoPwa } from "../../src/pwa/estado";
import { respuestaPrecacheable } from "../../src/pwa/filtro-precache";
import { calcularRevision } from "../../src/pwa/revision";

class DobleSw implements SerwistVentana {
  oyentes = new Map<string, () => void>();
  saltos = 0;
  addEventListener(tipo: string, oyente: () => void): void {
    this.oyentes.set(tipo, oyente);
  }
  async register(): Promise<void> {}
  messageSkipWaiting(): void {
    this.saltos += 1;
  }
  emitir(tipo: string): void {
    this.oyentes.get(tipo)?.();
  }
}

test("pw-5: una versión nueva solo avisa; no recarga hasta que el jugador lo pide", () => {
  const sw = new DobleSw();
  let recargas = 0;
  conectarCiclo(sw, () => (recargas += 1));
  sw.emitir("waiting");
  assert.equal(obtenerDatosPwa().esperando, true);
  assert.equal(recargas, 0);
  assert.equal(sw.saltos, 0);
  pulsarRecargar(sw);
  assert.equal(sw.saltos, 1);
  sw.emitir("controlling");
  assert.equal(recargas, 1);
  assert.equal(obtenerDatosPwa().esperando, false);
});

test("pw-5: tomar el mando sin haber pedido recarga (primera instalación) no recarga", () => {
  assert.deepEqual(reducirEstadoPwa(DATOS_PWA_INICIALES, "controlando"), DATOS_PWA_INICIALES);
});

test("el precache rechaza redirecciones y otros orígenes", () => {
  const origen = "https://x.example";
  assert.equal(respuestaPrecacheable({ redirected: false, url: `${origen}/`, status: 200 }, origen), true);
  assert.equal(respuestaPrecacheable({ redirected: true, url: `${origen}/`, status: 200 }, origen), false);
  assert.equal(respuestaPrecacheable({ redirected: false, url: "https://login.example/", status: 200 }, origen), false);
  assert.equal(respuestaPrecacheable({ redirected: false, url: `${origen}/`, status: 404 }, origen), false);
});

test("la revisión salta cadenas vacías y cae a un uuid", () => {
  assert.equal(calcularRevision({ shaDespliegue: "", salidaGit: "abc123\n" }, () => "u"), "abc123");
  assert.equal(calcularRevision({ shaDespliegue: " ", salidaGit: null }, () => "u"), "u");
});
