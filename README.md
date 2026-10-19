# Darwin Drive

Juego web 2D de coches: diseña uno, elige pista y mira hasta dónde llega. Corre entero en el navegador (móvil e iPad), sin servidor ni cuenta.

## Cómo jugar

En la portada, «Explorar pista» enseña la pista elegida y se recorre arrastrando con el dedo. Taller, Evolución, Garaje, Linaje y Especies se irán activando en las siguientes entregas.

## Pistas y rankings

Hay cuatro pistas fijas, cada una una función pura de la distancia (`src/sim/tracks.ts`): **La Cordillera** (montañas al azar pero siempre las mismas), **La Rampa** (una recta que se empina sin parar), **Las Dunas** (olas largas que crecen) y **El Pedregal** (piedras cada vez mayores). Se trocean en tramos de 25 m (`src/sim/terrain.ts`). Cada pista tendrá su propio ranking de 10 coches.

## Guardado en el dispositivo

Todo se guarda en IndexedDB del propio dispositivo, con claves `dd:v1:*` validadas al leer. Ahora mismo solo se recuerda la última pista elegida.

## Pruebas

```
npm ci
npm run lint && npm run typecheck
npm run test:unit            # núcleo en Node (node:test + fast-check)
npm run build && npm run verificar:presupuesto-bundle
npm run test:e2e             # Playwright; necesita `npx playwright install chromium`
```
