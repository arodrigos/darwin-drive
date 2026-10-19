#!/usr/bin/env bash
# hig-4: un único comando para el smoke de traspaso. Con URL_OBJETIVO apunta
# a un despliegue real; sin ella construye y arranca el juego en local. Lo
# que comprueba es el juego (tests/smoke/traspaso.spec.ts), no un código HTTP.
set -euo pipefail
cd "$(dirname "$0")/.."

PUERTO=3000
PID_SERVIDOR=""

limpiar() {
  if [ -n "$PID_SERVIDOR" ]; then
    # `npm run start` lanza next como hijo: se mata el grupo entero para no
    # dejar nada escuchando en el puerto.
    kill -- "-$PID_SERVIDOR" 2>/dev/null || kill "$PID_SERVIDOR" 2>/dev/null || true
    wait "$PID_SERVIDOR" 2>/dev/null || true
  fi
}
trap limpiar EXIT

esperar_servidor() {
  local url="$1"
  for _ in $(seq 1 120); do
    if curl -s -o /dev/null "$url"; then return 0; fi
    sleep 1
  done
  echo "smoke-traspaso: el servidor no respondió en $url tras 120 s" >&2
  return 1
}

if [ -n "${URL_OBJETIVO:-}" ]; then
  # Un preview protegido responde 302 a un login: probarlo daría un verde
  # falso o un fallo confuso, así que se dice claramente.
  estado=$(curl -s -o /dev/null -w '%{http_code}' "$URL_OBJETIVO" || true)
  case "$estado" in
    301|302|303|307|308|401|403)
      echo "smoke-traspaso: $URL_OBJETIVO responde $estado: el despliegue está protegido y no se puede probar sin acceso" >&2
      exit 2
      ;;
  esac
  export BASE_URL="$URL_OBJETIVO"
else
  if [ ! -f .next/BUILD_ID ]; then
    npm run build
  fi
  if curl -s -o /dev/null "http://127.0.0.1:$PUERTO"; then
    echo "smoke-traspaso: el puerto $PUERTO ya está ocupado; usa URL_OBJETIVO=http://127.0.0.1:$PUERTO si es un servidor del juego" >&2
    exit 3
  fi
  # setsid: grupo propio, para poder matarlo entero al salir.
  setsid npm run start -- -p "$PUERTO" >/dev/null 2>&1 &
  PID_SERVIDOR=$!
  esperar_servidor "http://127.0.0.1:$PUERTO"
  export BASE_URL="http://127.0.0.1:$PUERTO"
fi

npx playwright test tests/smoke/traspaso.spec.ts
