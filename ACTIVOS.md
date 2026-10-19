# Activos del producto

**El producto no usa ningún activo externo (imagen, audio, fuente o icono). Todo lo que se ve se genera por código en tiempo de ejecución.**

- **Gráficos**: la pista, el cielo, las colinas del fondo y la regla se pintan con formas vectoriales de Phaser (`src/game/explore.ts`); las colinas lejanas salen de ruido simplex con semilla fija. La portada y las miniaturas de las pistas son SVG en línea generados desde el perfil de cada pista (`src/app/components/`).
- **Tipografía**: ninguna fuente embebida ni enlazada; se usa la pila del sistema.
- **Audio**: ninguno.

No hay peticiones a terceros: todo se sirve del propio origen.
