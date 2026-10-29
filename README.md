# Darwin Drive

Juego web 2D de coches: diseña uno, elige pista y mira hasta dónde llega, o deja que un algoritmo genético los evolucione por ti. Corre entero en el navegador (pensado para móvil e iPad), sin servidor ni cuenta: todo se guarda en el propio dispositivo y funciona sin conexión tras la primera visita.

## Cómo jugar

La portada tiene tres zonas con estilos distintos: **Jugar** (el botón relleno «Taller» y, con contorno, «Evolución», «Batalla» y, si hay algo a medias, «Continuar evolución» y «Continuar batalla»), **Récords por pista** (una tarjeta por pista con su récord; fila desplazable en móvil, rejilla en tableta) y **Más** (lista de enlaces: Garaje, Linaje, Especies, Explorar pista, Ver el coche de serie y Cómo se juega). Los estilos de control (`.boton-primario`, `.boton-secundario`, `.enlace-terciario`) están en `src/app/globals.css`.

Desde la portada se llega a todo:

- **Explorar pista**: recorre la pista elegida sin coche, arrastrando con el dedo.
- **Ver el coche de serie**: corre el coche de ejemplo en la pista elegida.
- **Taller**: diseñas el coche con el dedo; ver «El Taller» más abajo.
- **Garaje**: los coches guardados. Desde cada uno se puede probar, abrir en el Taller, evolucionar, medir en todas las pistas, renombrar o borrar. Aquí están también el «Estado del guardado» y la copia de seguridad.
- **Rankings**: al tocar una pista en la portada se abre su ranking. Cada fila se puede ver correr, abrir en el Taller o guardar en el Garaje.
- **Evolución**: se elige pista, semilla (coches aleatorios, el del Taller o uno del Garaje), tamaño de población y fuerza de mutación. Cada generación corre, se queda con los mejores, los cruza y los muta. Se puede pausar, marcar un favorito para que sobreviva, ver un aviso de estancamiento y guardar el campeón en el Garaje. La gráfica enseña la mejor marca, la del 25 % superior y la media. Si hay una evolución a medias, la portada ofrece «Continuar evolución».
- **Linaje**: el árbol de los coches (de cuál viene cada uno), con zoom y arrastre, coloreado con las marcas de la pista elegida. Tocar un nodo permite ver, abrir o guardar ese coche.
- **Especies**: busca variedad en vez de un único ganador (MAP-Elites, `src/evolution/species.ts`). Es una rejilla de 4 × 4 por pista (filas: número de ruedas; columnas: largo de la carrocería) y cada casilla guarda el coche que más lejos llegó con esa forma. Cada búsqueda prueba un lote de coches nuevos; tocar una casilla permite verla correr o evolucionarla.

### El Taller

Diseñas el coche tocando un punto de la carrocería para elegirlo (se ve su anillo amarillo y una cuña con la zona donde puede moverse) y arrastrándolo; con el punto elegido, − y + ajustan su ángulo (1°) y su longitud (0,1 m) y «Poner rueda aquí» o «Quitar rueda» le cambia la rueda. «Tamaño −» y «Tamaño +» escalan el coche entero un 10 % conservando la forma, con la lectura de largo y alto; en el límite el botón se apaga y la nota dice qué pieza lo impide. El panel separa la configuración del coche, la prueba («Pista para probar» y «Probar», el único botón relleno) y el guardado. Cada rueda dibuja su guía de suspensión (una línea con muelle y topes por la que sube y baja); con la rueda elegida, el deslizador «Inclinación de la suspensión» (−90° a +90°, con lectura en palabras) o su tirador redondo la giran. «Ver fuerzas» (apagado por defecto) pinta el centro de masas, la flecha de peso y un arco de par por rueda, calculados con las mismas fórmulas que la física (`src/sim/physics/estatica.ts`). Cada rueda tiene radio, par motor y suspensión; la carrocería tiene peso. «Probar» lo lleva a la pista y «Guardar» al Garaje. La cabecera muestra la identidad del coche: una muestra de color y su nombre (se propone uno aleatorio de dos palabras concordadas, p. ej. «Tortuga veloz»); tocar el nombre abre la hoja para cambiarlo, la fila de colores elige uno de la paleta (Okabe-Ito más hueso) y «Coche nuevo» empieza otro, pidiendo confirmación si se perdería el diseño actual.

El lienzo encuadra siempre la caja del coche (cuerpo, ruedas, guías, cuña del punto elegido y, con «Ver fuerzas», la flecha de peso) por debajo de la cabecera; durante un arrastre el encuadre queda quieto y se recalcula al soltar. Con `?pruebas=1`, `__debug.estado().tallerEncuadre` da la escala, el origen y la caja en píxeles del lienzo.

### Modo batalla

«Batalla» (zona **Jugar** de la portada) es un hot-seat de 2 a 4 jugadores en un solo dispositivo. En «Configurar» cada jugador pone nombre (obligatorio: «Cada jugador necesita un nombre») y elige color; un color ya cogido por otro se ve tachado y no se puede tocar. Después cada uno diseña su coche por turnos en el Taller, que en batalla muestra «Batalla · Ana (1 de 3)» en lugar de «Volver», parte siempre del coche de serie y cambia «Probar» y «Guardar» por «Terminar mi coche» (avisa si no tiene ruedas) y «Abandonar batalla». Entre turnos, la pantalla de relevo no dibuja ningún coche: el diseño de cada jugador queda oculto hasta la carrera. Al terminar el último, se elige la pista. La batalla se guarda en el dispositivo (`dd:v1:batalla`); tras una recarga la portada ofrece «Continuar batalla (turno de …)» y el jugador al que le tocaba rehace su diseño. «Abandonar batalla» pide confirmación y borra el estado. En «Elegir pista», «¡A correr!» (activo al elegir pista) lanza una carrera simultánea de todos los coches, cada uno en su propio mundo, así que ninguno estorba a otro y cada resultado es el mismo que correría solo. Un marcador en vivo lista a los jugadores por distancia, una flecha con «Nombre −N m» señala a los que quedan fuera de pantalla por la izquierda y el control de ritmo es el de «Probar». Al acabar sale el podio (por distancia, luego coche entero, luego tiempo; «empate» si nada desempata); cada coche entra en el ranking de la pista y «Guardar todos» (o «Guardar» por coche) lo lleva al garaje con su nombre y color. «Revancha» repite pista y coches, «Otra pista» vuelve a elegir y «Salir» pide confirmación antes de borrar la batalla.

### La carrera

- El coche corre solo y cuenta metros. Una fila de botones elige el ritmo: ×1 (3 veces el tiempo real), ×2 (6), ×4 (12), ×8 (24) y «Hasta el final», que salta al resultado sin dibujar la carrera (en Evolución, «Turbo» salta de generación en generación). El último ritmo entre ×1 y ×8 se recuerda; «Hasta el final» no. Si el dispositivo no llega al ritmo pedido, aparece «real ×N», con N en la misma escala que los botones y una cifra decimal (`ritmoReal / MULTIPLIER.x1`). Bajo los ritmos, el interruptor «Fuerzas» (apagado por defecto, en Probar y en Evolución) pinta sobre cada rueda del coche que sigue la cámara una flecha de fuerza (1 px por cada 20 N, tope de 120 px, suavizada ~150 ms) y un arco de par, con los colores de «Ver fuerzas» del Taller. El Worker solo calcula la fuerza de reacción de las articulaciones de ese coche, y solo mientras la capa está encendida, así que nunca cambia un resultado.
- **Cámara**: sigue al coche igual a cualquier ritmo de fotogramas (el suavizado depende del tiempo real entre fotogramas, no de su número) y nunca lo deja fuera de la zona entre el contador y la fila de ritmos, ni en un equipo lento ni en ninguna pista. Solo lee las poses del Worker, así que no cambia ningún resultado (`src/game/camara.ts`). Con `?rendimiento=1`, el panel añade la línea «cámara · N fps · margen M px» (fotogramas pintados en el último segundo y menor margen del coche hasta el borde de la zona). El panel se apoya encima del pie de la carrera (ritmos, «Fuerzas» y barra) y en pantallas de menos de 600 px de ancho se pega a la derecha y es más estrecho, para no tapar la columna del coche (`.panel-rendimiento` en `src/app/globals.css`).
- El ritmo y las pausas nunca cambian el resultado. Al ocultar la pestaña o apagar la pantalla, la carrera se pausa y sigue al volver.
- La carrera acaba al llegar a la meta de 5000 m o a los 15 minutos de simulación. Un coche se da por parado tras 5 s sin avanzar.
- La carrera se prepara en segundo plano al abrir el juego (un único motor Phaser y un único Worker, que se reutilizan en la Pista, la Evolución y la Batalla), así que «Probar» y «Evolucionar» no esperan a crear nada. Al salir de una pantalla el motor se suelta y queda limpio para la siguiente.
- **Por qué se para**: la tarjeta de fin dice la causa (vuelco, sin apoyo, panza, motor, agarre u obstáculo) y «¿Por qué?» abre la guía. La pista dibuja una cuña con la pendiente real. El motor de todos los coches empuja hasta 35°. La causa se guarda con la marca y se ve también en el detalle del ranking y del Garaje.
- **Si el dispositivo pierde el dibujo**: el lienzo avisa con «Recuperando el dibujo…» y rehace la escena donde iba, sin tocar la simulación (el resultado es el mismo). Si el contexto no vuelve en 5 s, o ya hubo 3 recuperaciones en un minuto, sale «Reintentar dibujo». El soporte de dibujo se comprueba una sola vez por sesión y cada pantalla libera su contexto al salir (`src/game/lienzo.ts`).
- **Fantasma del récord**: en Probar y en Evolución, si la pista tiene un n.º 1 medido con la versión de pista y de física de hoy, su coche corre a la par como un fantasma translúcido (en otra carrera, en el mismo Worker y con los mismos pasos), con el rótulo «récord · N m» o, fuera de pantalla, una flecha en el borde con la diferencia. Nunca cuenta como coche: no entra en los resultados, ni en los vivos, ni en el progreso, ni lo sigue la cámara. Al pasarlo sale «¡Adelanta al récord!» 1,5 s. «Ver repetición» (en el detalle del ranking y en el Garaje) lo reproduce solo, sin inscribir nada en el ranking, y al acabar comprueba que distancia, tiempo y causa de parada son idénticos a la marca («Repetición fiel»). Una marca de otra versión o aún sin medir no se puede repetir y lo explica.
- **Peso y opacidad**: la opacidad del coche refleja el peso de la carrocería, en cuatro escalones, igual en el Taller, el Garaje, el Linaje y la pista. En carrera, cada parte se ve más opaca cuanto más carga soporta su rueda. Es solo visual.

### Ayuda

Cada pantalla tiene un «?» arriba a la derecha con una línea por opción (en la pista, abrirlo pausa la carrera). «Ver la guía completa», o «Cómo se juega» en la portada, abre la guía con el recorrido entero y una ficha por pista. Los textos están en `src/app/ayuda/textos.ts`.

## Cómo arrancar

Se necesita Node.js y npm (el CI usa Node 22).

```
npm ci
npm run dev                  # servidor de desarrollo de Next.js
```

Para probar el build de producción (incluido el service worker):

```
npm run build
npm run start                # sirve en http://localhost:3000 por defecto
```

Stack: [Next.js](https://nextjs.org/) 16 y React 19 en TypeScript; [Phaser](https://phaser.io/) 4 para dibujar pista, taller y coches; [Planck](https://piqnt.com/planck.js/) para la física 2D, que corre en un Web Worker (`src/worker/`); `serwist` para el service worker e `idb-keyval` para IndexedDB; `@dagrejs/dagre` para el árbol del Linaje; `pure-rand` y `simplex-noise` para el azar con semilla y el relieve. El producto no usa activos externos: todo se genera por código (ver `ACTIVOS.md`).

## Variables de entorno

El juego no necesita ninguna variable para arrancar: no hay `.env` que rellenar. Las que lee el código hoy son opcionales:

| Variable | Dónde | Para qué |
| --- | --- | --- |
| `VERCEL_GIT_COMMIT_SHA` | `next.config.ts` (build) | Revisión del despliegue para versionar el precache del service worker. Si falta, se usa `git rev-parse HEAD` y, si tampoco hay git, un identificador aleatorio. |
| `BASE_URL` | `playwright.config.ts`, `tests/smoke/traspaso.spec.ts` | Probar contra un servidor ya en marcha en lugar de levantar uno local. |
| `URL_OBJETIVO` | `scripts/smoke-traspaso.sh` | Lanzar el smoke contra un despliegue en vez de en local. |
| `CAPTURAS_DIR`, `CAPTURAS_PREFIJO` | `tests/e2e/*` | Carpeta y prefijo de las capturas de las pruebas e2e. |
| `MEDIR_N`, `MEDIR_PISTA`, `MEDIR_TASA_MAX`, `MEDIR_MURO` | `scripts/medir-pistas.ts`, `scripts/medir-anomalias.ts` | Ajustes de las medidas (número de coches, una sola pista, umbrales). |
| `PATRONES_PUBLICO_EXTRA` | `scripts/comprobar-publico.mjs` | Patrones extra que `verificar:publico` no debe encontrar en el repo. |

`NEXT_PUBLIC_VERSION_APP` la fija `next.config.ts` en el build; no hay que definirla.

## Pistas y rankings

Hay diez pistas fijas (`src/sim/tracks.ts`), cada una con su propio ranking de 10 coches:

| Pista | Cómo es |
| --- | --- |
| La Cordillera | Montañas al azar, siempre las mismas, cada vez más difíciles hasta la meta. |
| La Rampa | Una recta que se empina sin parar, cada vez más difícil hasta la meta. |
| Las Dunas | Olas largas que crecen. |
| El Pedregal | Llano con piedras cada vez mayores. |
| El Glaciar | Hielo resbaladizo con lomas suaves. |
| Los Trampolines | Suelo elástico que rebota más según el tramo. |
| La Escalera | Escalones de 20 cm a más de un metro, hasta la meta. |
| El Acantilado | Escalones hacia abajo de medio metro a ocho, con placas de hielo. |
| La Recta | Casi llana hasta la meta; se ordena por tiempo. |
| El Mosaico | Cada 25 m cambia el tipo de suelo; un rótulo nombra el tramo actual. |

Las nueve pistas que no son La Recta (`PISTAS_ENDURECIDAS`) siguen una curva de dificultad común (`src/sim/dificultad.ts`) que sigue subiendo en diente de sierra hasta los 5 km, donde vale 1: respiro cada 250 m y otro más largo tras cada kilómetro. A la meta no llega cualquier coche: `npm run medir:pistas -- --umbral` lo comprueba contra campeones fijos (`tests/fixtures/campeones-5k.ts`, generado una vez con `npm run generar:campeones`). Al subir la versión de una pista, el juego vuelve a medir sus marcas guardadas y los récords pueden bajar. El dibujo distingue las superficies por forma además de por color. El selector de pista es un carrusel horizontal.

## Clasificación y desempates

Todo el juego (ranking, garaje, especies, élite del algoritmo genético) ordena con un único criterio, `compararMarcas` en `src/sim/clasificacion.ts`, sin empates posibles. Por orden:

1. Una marca descalificada (anomalía de la física) va siempre detrás.
2. Más distancia, comparada en décimas de metro, que es lo que ve el jugador.
3. Llegar entero: sin piezas perdidas gana a con piezas perdidas.
4. Menos tiempo hasta la marca (`bestStep`); una marca sin medida va por detrás de las medidas.
5. Quien la logró antes (fecha de entrada en la tabla).
6. El hash del genoma, como último recurso para que el orden sea total.

Cuando la distancia que se ve empata, una insignia en la fila dice qué criterio decidió (entero, más rápido o llegó antes).

## Fragilidad

La carrocería se rompe por triángulos con los golpes fuertes (`src/sim/rotura.ts` y `src/sim/physics/rotura-sim.ts`). Cada triángulo aguanta un impulso por kilo que crece con la densidad, con el ángulo más agudo y con el área, a partir de `V_ROTURA` (6 m/s para un triángulo grueso de referencia): los coches ligeros o puntiagudos se rompen antes. La pieza que cede se suelta y cae, un destello marca dónde se rompió y el coche sigue con lo que le queda; una rueda se suelta si pierde los dos triángulos de su vértice. Las piezas sueltas viven 600 pasos o hasta quedar a 20 m por detrás del coche, y se cuentan como mucho 8. Si queda montada menos del 5 % de la masa original, el coche está destrozado. La tarjeta de fin dice cuántas piezas perdió y en qué metro cedió la primera. El umbral se calibra con `npm run medir:fragilidad`, que también corre en el CI.

## Sonido

El juego suena, pero la primera vez está en silencio. El altavoz de la cabecera (Portada, Pista, Evolución y Especies) lo enciende y lo apaga, y el ajuste se guarda en el dispositivo (`sonido` en `dd:v1:meta`; si falta o no es válido, vale apagado). Suenan cuatro efectos, uno por evento y nunca por coche: el arranque de una carrera de «Probar» (y el de la Evolución, solo en su primera generación), un récord nuevo, una especie nueva al acabar un lote de Especies y el vuelco del coche. Como mucho suena un efecto de cada tipo por segundo, un vuelco por generación en Evolución y nada con «Hasta el final» ni con «Turbo» (`src/audio/politica.ts`).

Los efectos se sintetizan por código con ZzFX (`zzfx` 1.4.0, sin ficheros de audio ni red). La librería se carga con un `import()` dinámico en el primer toque con el sonido encendido, porque los navegadores no dejan sonar antes de un gesto; hasta entonces, y tras una recarga con el sonido encendido, el juego calla (`src/audio/sonido.ts`). Al ocultar la página el audio se suspende y al volver se reanuda. En iPhone y iPad el interruptor de silencio también calla el juego: se pide la sesión de audio `ambient`, que además se mezcla con la música de otras apps. El núcleo (`src/sim`, `src/evolution`) no puede importar audio: lo comprueba `npm run verificar:frontera-nucleo`.

## Guardado en el dispositivo

- Todo se guarda en IndexedDB del dispositivo, con claves `dd:v1:*` validadas al leer (rankings, garaje, evolución, linaje, especies y ajustes). Tras el primer guardado se pide almacenamiento persistente, y el Garaje dice en «Estado del guardado» si es duradero o si el navegador puede borrarlo.
- **Identidad del coche**: el nombre y el color son metadatos del coche, fuera de su genoma, así que no cambian su hash. Se guardan en el Garaje y en sus filas de ranking, se ven en la pista de Probar, en el Garaje y en los Rankings, y viajan en la copia de seguridad (una copia antigua sin color vale; un color que no sea de la paleta se descarta).
- **Nombres**: «Guardar campeón» (Evolución) pide un nombre con uno propuesto; «Renombrar» en el Garaje cambia el nombre en el coche y en sus filas de ranking. Se limpian caracteres de control y se corta a 40 caracteres.
- **Copia de seguridad**: en el Garaje, «Exportar copia» descarga `darwin-drive-copia-AAAA-MM-DD.json` e «Importar copia» la vuelve a cargar (máximo 5 MB). Se valida entera, se resume lo que trae y se pide confirmación antes de reemplazar; un fichero inválido no cambia nada.
- **Batalla en curso** (`src/batalla/estado.ts`): el estado de una batalla (jugadores, coches terminados, pista y resultados) se guarda en `dd:v1:batalla` en cada transición y se valida entero al leer; si no es coherente se descarta. Queda fuera de la copia de seguridad: los nombres de los jugadores no salen del dispositivo.
- **Sin conexión**: un service worker (Serwist) guarda el juego tras la primera visita, solo en el build de producción. Una versión nueva solo se activa al tocar «Recargar» en el aviso «Hay una versión nueva». `/?sw=0` desinstala el worker y vacía su caché.

## Versiones de pista y migración

Cada marca guarda con qué versión de pista y de física se midió (`PHYSICS_VERSION` en `src/sim/constants.ts` y la versión de cada pista en `src/sim/tracks.ts`). Si cambia alguna, al abrir el juego (o al importar una copia antigua) se vuelven a medir, una a una y a ritmo turbo, las marcas del ranking, del garaje y de las especies; el linaje queda como historia. Ninguna marca se borra. Una banda «Actualizando marcas…» arriba cuenta el avance (`src/storage/migracion.ts`) y, al acabar, un aviso «Marcas actualizadas…» queda hasta que se cierra; nunca se enseña con una tarjeta de fin delante.

- Cada elemento tiene 3 intentos. Una medida cuenta como fallo si tarda más de 60 s con la pantalla visible. Tras el tercer fallo, la marca se conserva con «no se pudo volver a medir».
- Si hay otra pestaña abierta con una versión anterior, la migración espera y ofrece recargarla (`src/pwa/pestanas.ts`).
- Con `?pruebas=1&migracion=frenada` la cola arranca retenida hasta `__debug.frenarMigracion(false)`.

## Pruebas

```
npm ci
npm run lint && npm run typecheck
npm run test:unit            # núcleo en Node (node:test + tsx + fast-check); `npm test` hace lo mismo
npm run build && npm run verificar:presupuesto-bundle
npm run verificar:frontera-nucleo
npm run verificar:publico    # nada interno en el árbol; con --commits <rango> y --texto <texto> revisa también mensajes y PR
npm run test:e2e             # Playwright; necesita `npx playwright install chromium` y un `npm run build` previo
npm run test:e2e:tabletas    # el recorrido a 820x1180 (tableta-vertical) y 1180x820 (tableta-horizontal); es un job aparte del CI
npm run smoke:traspaso       # construye, arranca y prueba el juego en local (o contra URL_OBJETIVO)
```

Con `?pruebas=1`, `__debug.forzarTarjetaFin({reason, causaParada, recordPendiente, avisoMigracion})` repinta la tarjeta de fin con su caso peor (récord pendiente, aviso de migración y marcador de la parada) solo en memoria; lo cubre `tests/e2e/tarjeta-gancho.spec.ts`.

El icono de la causa de parada (↻, ⤓, ▁, ▮) se coloca con `colocarMarcador` (`src/game/colocar-marcador.ts`) junto al coche, dentro de la pantalla y sin tapar el rótulo «fin · N m»; `estado().etiquetaFin` da la caja del rótulo y lo cubren `tests/unit/colocar-marcador.test.ts` y `tests/e2e/icono-causa.spec.ts`.

Medidas de la física y de las pistas (también en el CI):

```
npm run medir:fisica
npm run medir:anomalias
npm run medir:fragilidad
npm run medir:pistas -- --umbral
```

`medir:pistas --umbral` imprime la tabla por pista (campeones que pasan 1, 2, 3 y 4 km y los que llegan a meta). Los topes de la fracción que baja de 1 a 5 km y del 15 % a meta se miden sobre el conjunto de las nueve pistas, no por pista (con 4-6 campeones por pista no se pueden exigir de forma estable). `MEDIR_PISTA=<id>` mide una sola pista.

`npm run medir:evolucion` mide la evolución (acepta `MEDIR_PISTA` y `MEDIR_GENERACIONES`), y los scripts `generar:escenario*` regeneran los escenarios de demostración de `src/debug/escenarios/`.

Cada medida de `__debug.latencias()` (y cada línea del panel de `?rendimiento=1`) trae dos cifras: `trabajoMs`, desde la entrada hasta el final del JS que aplica el efecto (en la carrera, el `update()` que dibuja los coches), y `ms`, hasta el fotograma siguiente, que es lo que percibe el jugador. En el CI, donde el dibujo es por software, se juzga `trabajoMs` (≤ 200 ms); `ms` se valida en el dispositivo, donde el panel marca ✓ si baja de 200 ms y ✗ si no. `tests/e2e/latencias.spec.ts` lo cubre.

El panel de `?rendimiento=1` sale en la pista y también en el Taller. Guarda las 10 últimas latencias (`MAX_LATENCIAS = 10` en `src/app/components/PanelRendimiento.tsx`, de las 50 que conserva `src/debug/latencias.ts`), más recientes primero, y la lista se recorta por altura (`max-height: 9em` en `.panel-rendimiento .latencias`): si no caben, las más antiguas se ocultan.

### Modo pruebas

Con `?pruebas=1`, `__debug.limitarFps(n)` (de 1 a 60; `null` lo quita) hace que la carrera pinte como mucho n fotogramas por segundo, como un equipo lento, sin tocar el Worker ni el ritmo, y `estado().camara` da el encuadre del líder (`dentro`, `cajaLiderPx`, `zonaUtilPx`, `fpsDibujo`, `margenMinPx`). Lo cubre `tests/e2e/camara-fps.spec.ts`, que además comprueba a 360x640, en Probar y en Evolución, que el panel de `?rendimiento=1` no se cruza con `cajaLiderPx` mientras se llenan las latencias; `tests/smoke/traspaso.spec.ts` comprueba que `estado().camara.dentro` es cierto.

Con `?pruebas=1` en la URL se expone `window.__debug` y todo el guardado va a una base aparte (`darwin-drive-pruebas`), así que el garaje del jugador no se toca. Sin el parámetro, `__debug` no existe. `__debug.cargarEscenario({...})` carga datos de ejemplo; por ejemplo, `genoma: "demo-ligero"` o `"demo-pesado"` (el coche de serie con el peso mínimo o máximo), `"demo-fragil"` o `"demo-motor-rampa"`, y `rankings`, `garaje` o `especies: "demo-version-anterior"` para ver la migración de marcas. Con `?pruebas=1&migracion=frenada` la cola de migración arranca retenida hasta `__debug.frenarMigracion(false)`. `perderLienzo()` y `muestraLienzo()` pierden y miden el lienzo; `estado()` suma `lienzo`, `contextosWebgl` y `sondasLienzo`. `estado().fantasma` da el fantasma en pantalla (`visible`, `alpha`, `x`, `simTime`, `fiel`, `resultado`, `adelantado`; `null` si la pista no lo tiene); lo cubre `tests/e2e/fantasma.spec.ts`. `__debug.sonidos()` da `encendido`, `cargado`, `contexto`, `sesion`, los contadores `arranque`, `record`, `especie` y `vuelco` y `error`; lo cubre `tests/e2e/sonido.spec.ts`. `__debug.motor()` da el estado del motor compartido (`listo`, `juegosCreados`, `juegosVivos`, `workersCreados`, `oyentesWorker`, `escenasActivas`, `adquisiciones`, `dueno`); lo cubre `tests/e2e/motor-reutiliza.spec.ts`.

## Changelog de cambios relevantes

- 2026-10-29 · Ritmo base más rápido: ×1 va a 3 veces el tiempo real.
- 2026-10-29 · Refinamiento de Darwin (P1-P5 y ritmo base más rápido, cada uno se añade aquí al entregarse). Docs: el README cuenta las 10 latencias del panel de rendimiento, que también sale en el Taller.
- 2026-10-29 · Primera «Probar» rápida: la escena se calienta en tiempo ocioso tras medir abrir-pista y las latencias del panel `?rendimiento=1` se cierran con el fotograma ya pintado.
