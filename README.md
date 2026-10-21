# Darwin Drive

Juego web 2D de coches: diseña uno, elige pista y mira hasta dónde llega. Corre entero en el navegador (móvil e iPad), sin servidor ni cuenta.

## Cómo jugar

En la portada, «Explorar pista» enseña la pista elegida y se recorre arrastrando con el dedo. Taller, Evolución, Garaje, Linaje y Especies se irán activando en las siguientes entregas.

## Ritmos de la carrera

En la carrera (y en Evolución) una fila de cinco botones elige el ritmo: ×1, ×2, ×4, ×8 y «Hasta el final» (Turbo en Evolución), que simula sin dibujar hasta la meta con una barra de avance. El último de ×1/×2/×4/×8 se recuerda en los ajustes (`Meta.ritmo`); «Hasta el final» nunca se guarda. Si el dispositivo no llega al ritmo pedido durante 2 s, aparece «real ×N» sobre la fila, sin mover ningún botón. El resultado de un coche no depende del ritmo ni de las pausas, y al ocultarse la pestaña la simulación se pausa y se reanuda sola.

## Pistas y rankings

Hay cuatro pistas fijas, cada una una función pura de la distancia (`src/sim/tracks.ts`): **La Cordillera** (montañas al azar pero siempre las mismas), **La Rampa** (una recta que se empina sin parar), **Las Dunas** (olas largas que crecen) y **El Pedregal** (piedras cada vez mayores). Se trocean en tramos de 25 m (`src/sim/terrain.ts`). Cada pista tendrá su propio ranking de 10 coches.

## Guardado en el dispositivo

Todo se guarda en IndexedDB del propio dispositivo, con claves `dd:v1:*` validadas al leer (rankings, garaje, evolución, linaje, especies y ajustes). Tras el primer guardado se pide `navigator.storage.persist()`, y el Garaje dice en «Estado del guardado» si es duradero o si Safari puede borrarlo.

**Copia de seguridad.** En el Garaje, «Exportar copia» descarga `darwin-drive-copia-AAAA-MM-DD.json` y «Importar copia» lo vuelve a cargar: se valida entero (máximo 5 MB), se resume lo que trae y se pide confirmación antes de reemplazar. Un fichero inválido no cambia nada.

**Sin conexión.** Un service worker (Serwist) guarda el juego tras la primera visita. Una versión nueva solo se activa cuando se toca «Recargar» en el aviso «Hay una versión nueva · Recargar», nunca a mitad de una evolución. `/?sw=0` desinstala el worker y vacía su caché.

**Marcas por versión.** Cada marca guarda con qué versión de pista y de física se midió. Si cambia alguna, al abrir el juego (o al importar una copia antigua) se vuelven a medir, de una en una y en turbo, las del ranking, las del garaje y las celdas de los archivos de especies; el linaje queda como historia. Una banda «Actualizando marcas…» lo cuenta y, al acabar, un aviso arriba se queda hasta cerrarlo. Cada medida se escribe solo si el elemento sigue como estaba; tras 3 fallos (o 60 s de pantalla visible) la marca se conserva con «no se pudo volver a medir». Si hay otra pestaña abierta con una versión anterior, la migración espera y ofrece «Recargar las otras pestañas». Con `?pruebas=1&migracion=frenada` la cola arranca retenida (`__debug.frenarMigracion(false)` la suelta) y `cargarEscenario({ rankings, garaje, especies: "demo-version-anterior" })` deja datos de una versión anterior.

## Pruebas

Con `?pruebas=1` se expone `window.__debug` y todo el guardado va a una base aparte (`darwin-drive-pruebas`), de modo que el garaje del jugador no se toca. Sin el parámetro, `__debug` no existe.

```
npm ci
npm run lint && npm run typecheck
npm run test:unit            # núcleo en Node (node:test + fast-check)
npm run build && npm run verificar:presupuesto-bundle
npm run verificar:publico    # sin infraestructura interna; con --commits <rango> y --texto <texto> revisa también mensajes y PR
npm run test:e2e             # Playwright; necesita `npx playwright install chromium`
```
