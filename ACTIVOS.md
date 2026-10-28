# Activos del producto

**El producto no usa ningún activo externo (imagen, audio, fuente o icono). Todo lo que se ve y se oye se genera por código en tiempo de ejecución.**

- **Gráficos**: la pista, el cielo, las colinas del fondo y la regla se pintan con formas vectoriales de Phaser (`src/game/explore.ts`); las colinas lejanas salen de ruido simplex con semilla fija. La portada y las miniaturas de las pistas son SVG en línea generados desde el perfil de cada pista (`src/app/components/`).
- **Tipografía**: ninguna fuente embebida ni enlazada; se usa la pila del sistema.
- **Audio**: cuatro efectos (arranque de carrera, nuevo récord, especie nueva y vuelco) sintetizados con ZzFX 1.4.0 (MIT, menos de 1 KB, sin ficheros) en `src/audio/sonido.ts`. Las muestras se calculan en el dispositivo la primera vez que se enciende el sonido. Empieza apagado y el ajuste se guarda en el dispositivo.

No hay peticiones a terceros: todo se sirve del propio origen.
