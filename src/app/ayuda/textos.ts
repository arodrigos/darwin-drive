import { TORQUE_SLOPE_DEG } from "@/sim/constants";
import type { TrackId } from "@/sim/tracks";
import { textoCausa } from "./causas";

/** Las once pantallas del juego; cada una tiene su «?». */
export type PantallaAyuda =
  | "portada"
  | "explorar"
  | "pista"
  | "taller"
  | "garaje"
  | "rankings"
  | "evolucion-inicio"
  | "evolucion"
  | "linaje"
  | "especies"
  | "batalla";

export const PANTALLAS_AYUDA: readonly PantallaAyuda[] = [
  "portada",
  "explorar",
  "pista",
  "taller",
  "garaje",
  "rankings",
  "evolucion-inicio",
  "evolucion",
  "linaje",
  "especies",
  "batalla",
];

export interface SeccionGuia {
  id: string;
  titulo: string;
  /** Párrafos del recorrido; cada uno es texto plano. */
  parrafos: string[];
}

export interface TextoAyuda {
  titulo: string;
  resumen: string;
  controles: { nombre: string; texto: string }[];
  /** Sección de la guía que amplía esta pantalla. */
  seccionGuia: string;
}

const PAUSA_SEGUNDO_PLANO = "Si apagas la pantalla o cambias de app, se pausa y sigue al volver";

export const SECCIONES_GUIA: readonly SeccionGuia[] = [
  {
    id: "taller",
    titulo: "El Taller",
    parrafos: [
      "En el Taller diseñas el coche con el dedo: toca un punto blanco para elegirlo y arrástralo para dar forma a la carrocería. Con el punto elegido ajustas su ángulo y su longitud con − y +, y le pones o quitas una rueda con «Poner rueda aquí» o «Quitar rueda». «Tamaño −» y «Tamaño +» encogen o agrandan el coche entero un 10 % sin cambiarle la forma.",
      "Cada rueda tiene su radio, su par motor y su suspensión; la carrocería tiene su peso. Un coche pesado agarra más pero necesita más fuerza para moverse.",
      "La suspensión es la línea con muelle que sale de cada rueda: por ella sube y baja. «Inclinación de la suspensión» (de −90° a +90°) la gira: 0° es vertical y amortigua baches; inclinada hacia atrás cede al chocar de frente y hacia delante empuja la rueda contra el obstáculo.",
      "«Ver fuerzas» dibuja el centro de masas (el punto donde se equilibra el coche), la flecha «peso» y, en cada rueda, un arco de par. Si el centro de masas queda muy atrás o muy alto, el coche vuelca antes.",
      "Cada coche nace con un nombre de dos palabras y un color de la paleta. Toca el nombre para cambiarlo y la muestra de color para elegir otro; «Coche nuevo» empieza de cero con otra identidad.",
      "«Probar» lleva el coche a la pista elegida abajo. Si te gusta, «Guardar» lo deja en el Garaje.",
    ],
  },
  {
    id: "batalla",
    titulo: "Batalla",
    parrafos: [
      "La batalla es para 2 a 4 jugadores en el mismo dispositivo. En «Configurar» cada uno pone su nombre y elige un color distinto.",
      "Pasa el dispositivo: cada jugador diseña su coche en el Taller por su turno, empezando del coche de serie. Entre turnos, la pantalla de relevo no enseña ningún coche, así que nadie ve el diseño de los demás hasta la carrera. «Terminar mi coche» cierra tu turno y pide confirmación.",
      "Cuando todos han terminado, se elige la pista y todos los coches corren a la vez; gana el que llega más lejos. Si dos llegan igual de lejos, desempata el que llegó entero, después el más rápido y, si aún coinciden, es empate.",
      "Todos los coches entran en el ranking de la pista, como cuando pruebas uno. En el resultado puedes guardar cada coche en el Garaje, con su nombre y su color, y evolucionarlo más tarde.",
      "La batalla se guarda en el dispositivo en cada paso: si sales o recargas, la portada ofrece «Continuar batalla» (el jugador al que le tocaba rehace su diseño). «Abandonar batalla» la borra entera, con los nombres de los jugadores.",
    ],
  },
  {
    id: "peso-opacidad",
    titulo: "Peso y opacidad",
    parrafos: [
      "La opacidad del coche cuenta cuánto pesa la carrocería: más peso = más opaco. Hay cuatro escalones, de translúcido a sólido, y se ven igual en el Taller, el Garaje, el Linaje y la pista.",
      "En carrera, cada parte del coche se vuelve más opaca cuanto más peso soporta su rueda: al subir una cuesta, la parte de atrás se ve más sólida que la de delante. El contorno siempre se ve entero.",
      "Es solo una pista visual: la opacidad no cambia cómo corre el coche.",
    ],
  },
  {
    id: "probar-ritmos",
    titulo: "Probar un coche y la velocidad",
    parrafos: [
      "En la pista el coche corre solo. La fila de abajo cambia el ritmo: ×1 ya es 3 veces el tiempo real; ×2, ×4 y ×8 van más deprisa y «Hasta el final» salta al resultado sin esperar.",
      "El ritmo nunca cambia el resultado: el mismo coche llega a la misma distancia a cualquier velocidad. Si tu dispositivo no puede con ×8, un «real ×N» te dice la velocidad que consigue de verdad.",
      "Si apagas la pantalla o cambias de app, la carrera se pausa y sigue al volver.",
      "«Repetir» vuelve a correr con el mismo coche y el mismo ritmo.",
    ],
  },
  {
    id: "fragilidad",
    titulo: "Fragilidad",
    parrafos: [
      "La carrocería se rompe por triángulos. Un golpe fuerte contra el suelo (una caída, un salto mal aterrizado) arranca los triángulos que no lo aguantan: se ve un destello, la pieza cae y el coche sigue con lo que le queda.",
      "Aguantan más los coches densos, los triángulos gruesos y los grandes; se rompen antes los ligeros y los que acaban en punta fina.",
      "Una rueda se suelta cuando pierde los dos triángulos de su vértice. Al romperse el coche pesa menos, pero el motor nunca empuja más por kilo: romperse no sale a cuenta. Si casi no queda carrocería, el coche queda destrozado y la carrera acaba en el último metro sano.",
      "Perder piezas penaliza: a igual distancia en el ranking gana el coche que llegó entero. La tarjeta de fin dice cuántas piezas perdió y a qué metro cedió la primera.",
    ],
  },
  {
    id: "por-que-se-para",
    titulo: "Por qué se para un coche",
    parrafos: [
      `Un coche se para cuando lleva 5 segundos sin avanzar. La tarjeta de fin dice la causa y la pista marca dónde se quedó, con una cuña que enseña la pendiente real.`,
      `El motor de todos los coches empuja hasta ${TORQUE_SLOPE_DEG}°: es un límite del juego, no de tu diseño. En La Rampa la pendiente crece sin parar, así que tarde o temprano cualquier coche se queda sin fuerza; solo pasa quien llega lanzado.`,
      `Si la cuesta es de menos de ${TORQUE_SLOPE_DEG}° y aun así se para, la causa es otra. Estas son todas, de la más grave a la más corriente, con un consejo para cada una:`,
      `Vuelco. ${textoCausa("vuelco")}`,
      `Sin apoyo. ${textoCausa("sin-apoyo")}`,
      `Panza. ${textoCausa("panza")}`,
      `Motor. Más de ${TORQUE_SLOPE_DEG}° de cuesta: el límite del motor. Gana velocidad antes de la subida; un coche más ligero no cambia el límite, pero llega más lanzado.`,
      `Agarre. ${textoCausa("agarre")}`,
      `Obstáculo. ${textoCausa("obstaculo")}`,
    ],
  },
  {
    id: "pistas",
    titulo: "Las pistas",
    parrafos: [
      "Cada pista tiene su propia mecánica y premia una cosa distinta. Elige pista en el selector del Taller, del Garaje o de la Evolución.",
      "Una marca solo cuenta en la pista donde se consiguió: lo que funciona en una cuesta no tiene por qué funcionar entre piedras.",
      "Nueve de las diez pistas se complican cada vez más hasta la meta de 5 km, donde son muy difíciles: no cualquier coche llega. La Recta sigue siendo la contrarreloj, casi llana, y se ordena por tiempo.",
      "Cuando una pista se hace más difícil, el juego vuelve a medir tus marcas guardadas en ella y los récords pueden bajar; ningún coche se borra.",
    ],
  },
  {
    id: "evolucionar",
    titulo: "Evolucionar",
    parrafos: [
      "La Evolución crea una población de coches, los hace correr, se queda con los que llegan más lejos y los cruza y los muta para la generación siguiente.",
      "Puedes marcar un favorito para que sobreviva, ver cuándo se estanca y guardar un campeón en el Garaje. La gráfica muestra la mejor marca, la del 25 % superior y la media.",
      "Los ritmos son los mismos que en la pista, con «Turbo» para saltar de generación en generación.",
    ],
  },
  {
    id: "rankings-clasificacion",
    titulo: "Rankings y clasificación",
    parrafos: [
      "Cada pista tiene su ranking con las mejores marcas de tus coches. Manda la distancia: gana quien llega más lejos. La carrera acaba al llegar a la meta (5000 m) o a los 15 minutos.",
      "Si dos coches llegan igual de lejos en la pantalla, gana el que llegó entero, después el más rápido en alcanzar su marca y, por último, el que la logró antes. Una insignia en la fila dice cuál de esos criterios decidió.",
      "Toca una fila para verla correr, abrirla en el Taller o guardarla en el Garaje.",
    ],
  },
  {
    id: "garaje-nombres",
    titulo: "El Garaje",
    parrafos: [
      "El Garaje guarda tus coches en este dispositivo. Desde cada uno puedes probarlo, abrirlo en el Taller, evolucionarlo, renombrarlo o borrarlo. Al guardar un campeón de la Evolución te pide un nombre; si lo dejas vacío, se queda el propuesto.",
      "«Medir en todas las pistas» corre el coche en cada pista y rellena sus marcas. La copia de seguridad exporta e importa todo el juego como un fichero.",
    ],
  },
  {
    id: "linaje",
    titulo: "El Linaje",
    parrafos: ["El Linaje dibuja el árbol de tus coches: de cuál viene cada uno y qué marca logró. Toca un nodo para ver, abrir o guardar ese coche."],
  },
  {
    id: "especies",
    titulo: "Especies",
    parrafos: [
      "Especies busca variedad en vez de un único ganador: una rejilla de formas de coche, y en cada casilla el que más lejos llegó con esa forma.",
      "Cada tanda de búsqueda rellena casillas nuevas; toca una para verla correr o evolucionarla.",
    ],
  },
  {
    id: "guardado",
    titulo: "Dónde se guarda todo",
    parrafos: [
      "Todo se guarda en este dispositivo: no hay cuentas ni servidor. El juego funciona sin conexión una vez cargado.",
      "Para cambiar de dispositivo o protegerte de un borrado del navegador, usa la copia de seguridad del Garaje.",
    ],
  },
];

export const AYUDA: Record<PantallaAyuda, TextoAyuda> = {
  portada: {
    titulo: "Portada",
    resumen: "Desde aquí llegas a todo. Toca una pista para ver su ranking.",
    seccionGuia: "taller",
    controles: [
      { nombre: "Explorar pista", texto: "Recorre una pista sin coche para ver cómo es." },
      { nombre: "Ver el coche de serie", texto: "Corre el coche de ejemplo en la pista elegida." },
      { nombre: "Medallas", texto: "Cada pista da bronce, plata y oro por la distancia (o el tiempo, en La Recta y el Acantilado). La de autor es la marca del coche de referencia de la pista." },
      { nombre: "Taller", texto: "Diseña tu propio coche." },
      { nombre: "Garaje", texto: "Tus coches guardados y la copia de seguridad." },
      { nombre: "Evolución", texto: "Deja que un algoritmo genético evolucione coches." },
      { nombre: "Linaje y Especies", texto: "El árbol de tus coches y la rejilla de variedad." },
    ],
  },
  explorar: {
    titulo: "Explorar pista",
    resumen: "Mira la pista sin coche, a tu ritmo.",
    seccionGuia: "pistas",
    controles: [
      { nombre: "Arrastrar", texto: "Mueve la cámara por la pista." },
      { nombre: "Selector de pista", texto: "Cambia a otra pista y mira su aspecto." },
      { nombre: "← Volver", texto: "Regresa a la portada." },
    ],
  },
  pista: {
    titulo: "Pista",
    resumen: `El coche corre solo y mientras tanto cuenta metros. ${PAUSA_SEGUNDO_PLANO}.`,
    seccionGuia: "probar-ritmos",
    controles: [
      { nombre: "×1", texto: "Tres veces el tiempo real." },
      { nombre: "×2", texto: "El doble de rápido." },
      { nombre: "×4", texto: "Cuatro veces más rápido." },
      { nombre: "×8", texto: "Ocho veces más rápido; si el dispositivo no llega, avisa con «real ×N»." },
      { nombre: "Hasta el final", texto: "Salta al resultado sin esperar la carrera." },
      { nombre: "Fuerzas", texto: "Enciende, sobre cada rueda del coche que sigue la cámara, una flecha rosa con la fuerza que el suelo le hace (más larga, más fuerza; cambia con cada piedra) y un arco verde con su par. Apagada no gasta nada." },
      { nombre: "Repetir", texto: "Vuelve a correr desde el principio con el mismo ritmo." },
      { nombre: "¿Por qué?", texto: "En la tarjeta de fin, explica por qué se paró el coche." },
      { nombre: "Destello", texto: "Una estrella marca dónde se rompió una pieza; la tarjeta cuenta cuántas perdió. Más en «Fragilidad»." },
      { nombre: "Medalla", texto: "La tarjeta de fin dice qué medalla ganó la carrera y cuánto falta para la siguiente: bronce, plata, oro y autor, que es la marca del coche de referencia de la pista." },
      { nombre: "Bandera", texto: "Marca el récord de la pista: el coche que llegue más lejos." },
      { nombre: "Apagar la pantalla", texto: PAUSA_SEGUNDO_PLANO + "." },
    ],
  },
  taller: {
    titulo: "Taller",
    resumen: "Diseña el coche con el dedo y pruébalo.",
    seccionGuia: "taller",
    controles: [
      { nombre: "Puntos blancos", texto: "Toca un punto para elegirlo; arrástralo para darle forma. Con el punto elegido puedes ponerle una rueda." },
      { nombre: "Punto elegido", texto: "La cuña amarilla marca hasta dónde puede moverse. Ángulo y Longitud con − y + lo ajustan con precisión; «Poner rueda aquí» o «Quitar rueda» cambia su rueda." },
      { nombre: "Tamaño", texto: "«Tamaño −» y «Tamaño +» cambian el coche entero un 10 %. Si una pieza llega a su límite, el botón se apaga y te dice cuál." },
      { nombre: "Guía de suspensión", texto: "Cada rueda se mueve arriba y abajo por la línea con muelle que sale de ella. Toca una rueda y arrastra el círculo de su guía, o usa «Inclinación de la suspensión», para inclinarla: vertical amortigua baches; inclinada hacia atrás cede al chocar de frente." },
      { nombre: "Centro de masas", texto: "Con «Ver fuerzas», el círculo blanco y negro es el punto donde se equilibra el coche. Si queda muy atrás o muy alto, el coche vuelca antes." },
      { nombre: "Peso", texto: "La flecha «peso» sale del centro de masas hacia abajo: cuanto más larga, más pesa el coche." },
      { nombre: "Par", texto: "El arco «par» de cada rueda muestra el giro del motor, en el sentido en que rueda: cuanto más largo el arco, más fuerza tiene para empujar." },
      { nombre: "Deslizadores", texto: "Radio de la rueda y peso de la carrocería: más peso = más opaco." },
      { nombre: "Opacidad", texto: "Cuanto más pesa la carrocería, más opaca se ve; en carrera, más opaca donde más carga la rueda. Mira «Peso y opacidad» en la guía." },
      { nombre: "Pista", texto: "Elige dónde se prueba el coche." },
      { nombre: "Probar", texto: "Lleva el coche a la pista elegida." },
      { nombre: "Guardar y Evolucionar", texto: "Déjalo en el Garaje o úsalo como semilla de una evolución." },
    ],
  },
  garaje: {
    titulo: "Garaje",
    resumen: "Tus coches guardados en este dispositivo.",
    seccionGuia: "garaje-nombres",
    controles: [
      { nombre: "Probar", texto: "Corre el coche en la pista elegida." },
      { nombre: "Abrir en el Taller", texto: "Edita una copia del coche." },
      { nombre: "Evolucionar", texto: "Empieza una evolución con él." },
      { nombre: "Medir en todas las pistas", texto: "Corre el coche en cada pista y rellena sus marcas." },
      { nombre: "Renombrar", texto: "Cambia el nombre del coche, también en los rankings." },
      { nombre: "Borrar", texto: "Quita el coche del Garaje." },
      { nombre: "Copia de seguridad", texto: "Exporta o importa todo el juego como fichero." },
    ],
  },
  rankings: {
    titulo: "Rankings",
    resumen: "Las mejores marcas de cada pista.",
    seccionGuia: "rankings-clasificacion",
    controles: [
      { nombre: "Pestañas", texto: "Cambian de pista." },
      { nombre: "Fila", texto: "Toca una para ver sus opciones." },
      { nombre: "Ver correr", texto: "Repite la carrera de esa marca." },
      { nombre: "Abrir en el Taller y Guardar", texto: "Edita el coche o llévalo al Garaje." },
    ],
  },
  "evolucion-inicio": {
    titulo: "Empezar una evolución",
    resumen: "Elige de dónde parte la población y cómo evoluciona.",
    seccionGuia: "evolucionar",
    controles: [
      { nombre: "Pista", texto: "Dónde corren los coches." },
      { nombre: "Semilla", texto: "Los coches de partida: aleatorios, el del Taller o uno del Garaje." },
      { nombre: "Ajustes", texto: "Tamaño de la población y fuerza de la mutación." },
      { nombre: "Empezar", texto: "Lanza la primera generación." },
    ],
  },
  evolucion: {
    titulo: "Evolución",
    resumen: "Cada generación corre, se queda con los mejores y muta.",
    seccionGuia: "evolucionar",
    controles: [
      { nombre: "×1, ×2, ×4, ×8", texto: "La velocidad de la generación en curso." },
      { nombre: "Turbo", texto: "Salta de generación en generación sin dibujar la carrera." },
      { nombre: "Pausar", texto: "Detiene la evolución y la retoma donde estaba." },
      { nombre: "Favorito", texto: "Marca un coche para que sobreviva a la siguiente generación." },
      { nombre: "Estancamiento", texto: "Avisa cuando varias generaciones seguidas no mejoran." },
      { nombre: "Guardar campeón", texto: "Lleva el mejor coche al Garaje." },
      { nombre: "Mejor, Top 25 % y Media", texto: "Las tres líneas de la gráfica: el mejor coche, el cuarto superior y el promedio." },
      { nombre: "Apagar la pantalla", texto: PAUSA_SEGUNDO_PLANO + "." },
    ],
  },
  linaje: {
    titulo: "Linaje",
    resumen: "El árbol de tus coches: de cuál viene cada uno.",
    seccionGuia: "linaje",
    controles: [
      { nombre: "Nodo", texto: "Toca un coche para ver su marca y sus opciones." },
      { nombre: "Zoom", texto: "Acerca y aleja el árbol; arrastra para moverlo." },
      { nombre: "Selector de pista", texto: "Colorea el árbol con las marcas de esa pista." },
    ],
  },
  especies: {
    titulo: "Especies",
    resumen: "Busca variedad: la mejor marca para cada forma de coche.",
    seccionGuia: "especies",
    controles: [
      { nombre: "Casilla", texto: "Toca una para ver su coche." },
      { nombre: "Buscar", texto: "Prueba coches nuevos y rellena casillas." },
      { nombre: "Ver correr y Evolucionar", texto: "Repite la carrera o parte de ese coche." },
    ],
  },
  batalla: {
    titulo: "Batalla",
    resumen: "De 2 a 4 jugadores en el mismo dispositivo: cada uno diseña su coche por turnos, sin ver el de los demás.",
    seccionGuia: "batalla",
    controles: [
      { nombre: "Jugadores", texto: "Elige cuántos sois, un nombre y un color distinto para cada uno." },
      { nombre: "Pantalla de relevo", texto: "Pasa el dispositivo al jugador que se nombra y que toque «Soy …, empezar»: no se ve ningún coche." },
      { nombre: "Terminar mi coche", texto: "Cierra tu turno y pide confirmación. Los demás no verán tu coche hasta la carrera." },
      { nombre: "Salir y continuar luego", texto: "Guarda la batalla: la portada ofrece «Continuar batalla». Si recargas en pleno turno, ese diseño vuelve a empezar." },
      { nombre: "Abandonar batalla", texto: "Borra la batalla entera, con los nombres de los jugadores." },
    ],
  },
};

export interface FichaPista {
  mecanica: string;
  premia: string;
}

/** Record sobre TrackId: añadir una pista sin su ficha no compila. */
export const FICHAS_PISTA: Record<TrackId, FichaPista> = {
  cordillera: { mecanica: "Montañas al azar, siempre las mismas, cada vez más altas.", premia: "Un coche equilibrado que sube y baja sin volcar." },
  rampa: { mecanica: "Una recta que se empina sin parar hasta que el motor no puede más.", premia: "Par motor y agarre en las ruedas." },
  dunas: { mecanica: "Olas largas que crecen: con velocidad, se vuela.", premia: "Velocidad constante y suspensión que aterriza bien." },
  pedregal: { mecanica: "Llano sembrado de piedras cada vez mayores.", premia: "Ruedas grandes que pasan por encima." },
  glaciar: { mecanica: "Hielo resbaladizo con lomas suaves: las ruedas patinan y frenar cuesta.", premia: "Ruedas anchas, peso bajo y un motor que no patina de más." },
  trampolines: { mecanica: "Suelo elástico que rebota cada vez más fuerte según el tramo.", premia: "Suspensión que absorbe el golpe y un coche que no vuelca al botar." },
  escalera: { mecanica: "Escalones de 20 cm a más de un metro que suben y bajan.", premia: "Ruedas grandes y par motor para trepar cada contrahuella." },
  acantilado: { mecanica: "Escalones hacia abajo de medio metro a seis, con placas de hielo cada vez más frecuentes.", premia: "Un coche robusto que aguante las caídas sin romperse ni volcar." },
  recta: { mecanica: "Una pista casi llana hasta la meta: gana el más rápido, no el que más lejos llega.", premia: "Velocidad punta y buen reparto de peso: se ordena por tiempo." },
  mosaico: { mecanica: "Cada 25 metros cambia el suelo: lomas, ondas, piedras, hielo y suelo elástico.", premia: "El coche que sirve para todo, no el que brilla en una sola pista." },
};
