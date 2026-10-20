# Darwin Drive

Juego web 2D de coches: diseña uno, elige pista y mira hasta dónde llega. Corre entero en el navegador (móvil e iPad), sin servidor ni cuenta.

## Cómo jugar

En la portada, «Explorar pista» enseña la pista elegida y se recorre arrastrando con el dedo. Taller, Evolución, Garaje, Linaje y Especies se irán activando en las siguientes entregas.

## Pistas y rankings

Hay cuatro pistas fijas, cada una una función pura de la distancia (`src/sim/tracks.ts`): **La Cordillera** (montañas al azar pero siempre las mismas), **La Rampa** (una recta que se empina sin parar), **Las Dunas** (olas largas que crecen) y **El Pedregal** (piedras cada vez mayores). Se trocean en tramos de 25 m (`src/sim/terrain.ts`). Cada pista tendrá su propio ranking de 10 coches.

## Guardado en el dispositivo

Todo se guarda en IndexedDB del propio dispositivo, con claves `dd:v1:*` validadas al leer (rankings, garaje, evolución, linaje, especies y ajustes). Tras el primer guardado se pide `navigator.storage.persist()`, y el Garaje dice en «Estado del guardado» si es duradero o si Safari puede borrarlo.

**Copia de seguridad.** En el Garaje, «Exportar copia» descarga `darwin-drive-copia-AAAA-MM-DD.json` y «Importar copia» lo vuelve a cargar: se valida entero (máximo 5 MB), se resume lo que trae y se pide confirmación antes de reemplazar. Un fichero inválido no cambia nada.

**Sin conexión.** Un service worker (Serwist) guarda el juego tras la primera visita. Una versión nueva solo se activa cuando se toca «Recargar» en el aviso «Hay una versión nueva · Recargar», nunca a mitad de una evolución. `/?sw=0` desinstala el worker y vacía su caché.

## Pruebas

```
npm ci
npm run lint && npm run typecheck
npm run test:unit            # núcleo en Node (node:test + fast-check)
npm run build && npm run verificar:presupuesto-bundle
npm run test:e2e             # Playwright; necesita `npx playwright install chromium`
```
