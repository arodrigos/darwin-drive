# Darwin Drive

Juego web 2D de coches: diseña uno, elige pista y mira hasta dónde llega. Corre entero en el navegador (móvil e iPad), sin servidor ni cuenta.

## Cómo jugar

En la portada, «Explorar pista» enseña la pista elegida y se recorre arrastrando con el dedo. Taller, Evolución, Garaje, Linaje y Especies se irán activando en las siguientes entregas.

## Ritmos de la carrera

En la carrera (y en Evolución) una fila de cinco botones elige el ritmo: ×1, ×2, ×4, ×8 y «Hasta el final» (Turbo en Evolución), que simula sin dibujar hasta la meta con una barra de avance. El último de ×1/×2/×4/×8 se recuerda en los ajustes (`Meta.ritmo`); «Hasta el final» nunca se guarda. Si el dispositivo no llega al ritmo pedido durante 2 s, aparece «real ×N» sobre la fila, sin mover ningún botón. El resultado de un coche no depende del ritmo ni de las pausas, y al ocultarse la pestaña la simulación se pausa y se reanuda sola.

**Por qué se para un coche.** Un coche se atasca tras 5 s sin avanzar y el resultado dice la causa (`causaParada` y `pendienteParada` en `CarResult`). `src/sim/diagnostico.ts` clasifica sobre las últimas muestras con esta prioridad: vuelco, sin apoyo, panza, motor (cuesta de 33° o más; el motor de todos los coches empuja hasta 35°, `TORQUE_SLOPE_DEG`), agarre y obstáculo. La tarjeta de fin enseña la frase (`src/app/ayuda/causas.ts`) y «¿Por qué?» abre la guía; la pista dibuja una cuña con la pendiente real y la de 35° discontinua. La causa se guarda con la marca y se ve en el detalle del ranking y del Garaje. El diagnóstico no cambia la carrera: el muestreo solo lee.

**Peso y opacidad.** La opacidad del coche refleja su peso: `opacidadBase(bodyDensity)` (`src/game/opacidad.ts`) da cuatro niveles (0,4 · 0,6 · 0,8 · 1,0) en el Taller, el Garaje, el Linaje y la pista. En carrera, cada triángulo de la carrocería sube hacia 1 según la carga (ya suavizada en la simulación) de las ruedas montadas en sus vértices. El contorno es siempre opaco y pintar no cambia ningún resultado.

## Ayuda dentro del juego

Cada pantalla tiene un «?» arriba a la derecha que abre un panel con una línea por opción; en la Pista, abrirlo pausa la carrera y cerrarlo la reanuda. «Ver la guía completa» (o «Cómo se juega» en la portada) abre la guía con el recorrido entero y una ficha por pista. Los textos viven en `src/app/ayuda/textos.ts`; el «atrás» del sistema cierra la capa de arriba.

## Pistas y rankings

Hay diez pistas fijas, cada una una función pura de la distancia (`src/sim/tracks.ts`): **La Cordillera** (montañas al azar pero siempre las mismas), **La Rampa** (una recta que se empina sin parar), **Las Dunas** (olas largas que crecen), **El Pedregal** (piedras cada vez mayores), **El Glaciar** (hielo, fricción 0,05), **Los Trampolines** (suelo elástico con rebote de 0,5 a 0,85 según el tramo) **La Escalera** (escalones de 0,2 a 1,2 m cuesta abajo y con poco agarre), **El Acantilado** (escalones hacia abajo de 0,5 a 6 m con cara de 65° y placas de hielo cada vez más frecuentes; los dos primeros tramos van fijos, hielo y roca) **La Recta** (casi llana, ondulación de menos de 0,5 m, sin curva de dificultad: una contrarreloj hasta la meta, que se ordena por tiempo) y **El Mosaico** (cada tramo de 25 m es de un tipo distinto: llano, loma, ondas, piedras, hielo o suelo elástico; `tipoTramo(i)` nunca repite el anterior y el tamaño sigue la curva de dificultad; un rótulo sobre el contador nombra el tramo actual). Se trocean en tramos de 25 m (`src/sim/terrain.ts`). Las cuatro se complican pronto y siguiendo una misma curva cóncava (`src/sim/dificultad.ts`: a 120 m ya llevan la mitad de su techo y a 450 m el 80 %), con un respiro cada 250 m; los techos no suben. A los 100 m la Cordillera ya pasa de 3 m de relieve, la Rampa de 20°, las Dunas de 3 m y las piedras de 0,45 m. `npm run medir:pistas -- --umbral` (en el CI) compara con las pistas anteriores (`tests/fixtures/pistas-v-anterior.ts`) y falla si la mediana de los coches viables no baja al 70 % o si un tramo de 25 m para a más del 80 % de los que llegan. Cada pista tiene su propio ranking de 10 coches (los `Record` se derivan de `TRACKS`: una partida guardada con solo las cuatro claves clásicas carga sin avisos y las nuevas arrancan vacías). Las pistas nuevas nacen en la versión 1. Las clásicas siguen con suelo de roca (`ROCA`): las superficies no las alteran. Su dorado (`tests/fixtures/dorado-clasicas.json`) se regeneró con la rotura de fragilidad (PHYSICS_VERSION 4), que sí cambia sus resultados.

**Superficies.** Cada tramo de 25 m tiene un material (`surfaceOfSegment(i)`: fricción y rebote) que la física aplica al suelo; el dibujo lo distingue por forma además de por color (`src/game/superficies.ts`: brillos en el hielo, zigzag en el elástico) con contraste ≥ 3:1. Los selectores de pista (`TrackPicker`) son un carrusel horizontal. `npm run medir:pistas -- --umbral` exige también que cada pista nueva tenga Spearman < 0,85 con las demás (salvo La Recta, que es llana y de roca por diseño), que El Acantilado rompa piezas al menos el doble que la media de las clásicas y que ≥ 50 % de los viables lleguen a la meta de La Recta.

**Meta y clasificación.** La carrera acaba al llegar a 5000 m («¡Meta!») o a los 15 minutos de simulación (54 000 pasos). El ranking de cada pista ordena con un único criterio (`compararMarcas`, en `src/sim/clasificacion.ts`): quien no está descalificado, más décimas de distancia, llegar entero, menos tiempo hasta la marca, antes en la tabla y, por último, el hash del genoma. Cuando la distancia que se ve es la misma, una insignia en la fila dice qué clave decidió. Cada marca guarda `bestStep` (el paso de su mejor distancia) y `piezasPerdidas`; una marca sin ellos, o que la física no permite, se vuelve a medir con la migración de marcas.

## Guardado en el dispositivo

Todo se guarda en IndexedDB del propio dispositivo, con claves `dd:v1:*` validadas al leer (rankings, garaje, evolución, linaje, especies y ajustes). Tras el primer guardado se pide `navigator.storage.persist()`, y el Garaje dice en «Estado del guardado» si es duradero o si Safari puede borrarlo.

**Nombres.** «Guardar campeón» (Evolución) abre una hoja con un nombre propuesto; «Renombrar» en el Garaje la reutiliza. El nombre cambia en el coche y en sus filas de ranking sin tocar su fecha. Se le quitan los caracteres de control y de formato (Unicode Cc y Cf), se juntan espacios y se corta a 40 caracteres, también al cargar lo guardado y al importar una copia; siempre se pinta como texto.

**Copia de seguridad.** En el Garaje, «Exportar copia» descarga `darwin-drive-copia-AAAA-MM-DD.json` y «Importar copia» lo vuelve a cargar: se valida entero (máximo 5 MB), se resume lo que trae y se pide confirmación antes de reemplazar. Un fichero inválido no cambia nada. Los campos de marca fuera de rango (tiempo, piezas, causa o pendiente de la parada, fecha ilegible) no invalidan la copia: esa marca queda pendiente y se vuelve a medir al importar, y la pista de pruebas `pruebas-llana` se ignora; un genoma inválido o una pista desconocida sí la rechazan entera.

**Sin conexión.** Un service worker (Serwist) guarda el juego tras la primera visita. Una versión nueva solo se activa cuando se toca «Recargar» en el aviso «Hay una versión nueva · Recargar», nunca a mitad de una evolución. `/?sw=0` desinstala el worker y vacía su caché.

**Fragilidad.** La carrocería se rompe por triángulos (`src/sim/rotura.ts`, `src/sim/physics/rotura-sim.ts`). El impulso normal que recibe cada triángulo en un paso se acumula en el `post-solve` sin tocar el mundo; justo después de `world.step` y en orden de índice se rompe el que supera `umbral_i = V_ROTURA · (densidad/70)^0,5 · clamp(ángulo agudo/30°, 0,35, 1) · clamp(√(área/0,5), 0,5, 1,5)` por kilo de masa de origen. La pieza se separa como cuerpo nuevo con la velocidad `v + ω × r`, la rueda se suelta cuando caen los dos triángulos de su vértice, el par se recalcula con la masa que queda (repartido entre las motrices de origen, así que el empuje por kilo nunca sube) y con menos del 5 % de masa el coche queda destrozado con la distancia del último paso sano. Las piezas sueltas desaparecen a los 600 pasos o 20 m por detrás. `CarResult` gana `metroRotura` y `PHYSICS_VERSION` pasa a 4, así que todas las marcas se vuelven a medir una vez. La pista pinta lo que queda, las piezas sueltas y un destello de 300 ms de reloj real; la tarjeta de fin dice «Perdió N piezas (la primera a los M m)» y Rankings «Roto · N piezas». `npm run medir:fragilidad` (en el CI) comprueba que lo ligero rompe antes que lo pesado.

**Marcas por versión.** Cada marca guarda con qué versión de pista y de física se midió. Si cambia alguna, al abrir el juego (o al importar una copia antigua) se vuelven a medir, de una en una y en turbo, las del ranking, las del garaje y las celdas de los archivos de especies; el linaje queda como historia. Una banda «Actualizando marcas…» lo cuenta y, al acabar, un aviso, los dos en una franja propia arriba que empuja el contenido en vez de taparlo, se queda hasta cerrarlo. Cada medida se escribe solo si el elemento sigue como estaba; tras 3 fallos (o 60 s de pantalla visible) la marca se conserva con «no se pudo volver a medir». Si hay otra pestaña abierta con una versión anterior, la migración espera y ofrece «Recargar las otras pestañas». Con `?pruebas=1&migracion=frenada` la cola arranca retenida (`__debug.frenarMigracion(false)` la suelta) y `cargarEscenario({ rankings, garaje, especies: "demo-version-anterior" })` deja datos de una versión anterior.

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
