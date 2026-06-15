# Backing Tracking

Web app en React para reproducir backing tracks por cancion y alternar entre variantes
sin perder la posicion actual de reproduccion.

## Funcionalidades

- N canciones cargadas automaticamente desde public/audio/*/song.json.
- Cambio de cancion conservando tiempo y estado de play/pause.
- Cambio de modo (guitarra, bajo, bateria, cuerdas, acapella) conservando tiempo.
- Controles de transporte: retroceder 10s, avanzar 10s, play/pause y seek en timeline.

## Estructura semi hexagonal

- src/domain: entidades y reglas de seleccion de pistas.
- src/application: casos de uso y orquestacion del reproductor.
- src/infrastructure: repositorios concretos (en memoria por ahora).
- src/ui: componentes de interfaz y formateadores.

## Convencion de audios

Coloca los mp3 en public/audio/{slug-cancion}/ con estos nombres:

- guitarra.mp3
- bajo.mp3
- bateria.mp3
- cuerdas.mp3
- acapella.mp3

Ejemplo:

- public/audio/ruta-66/guitarra.mp3
- public/audio/ruta-66/bajo.mp3
- public/audio/ruta-66/bateria.mp3
- public/audio/ruta-66/cuerdas.mp3
- public/audio/ruta-66/acapella.mp3

Los slugs de ejemplo actuales son:

- ruta-66
- noche-urbana

Si agregas una canción y dejas public/audio/{slug}/song.json, aparece automáticamente en el listado.

## Desarrollo local

1. npm install
2. npm run dev

## Build

1. npm run build
2. npm run preview

## Docker

Build y run con compose:

1. docker compose up --build
2. Abrir http://localhost:8080

La app queda servida por Nginx con fallback para rutas SPA.
La API queda expuesta en http://localhost:4000 y usa `api/Dockerfile`.
Las canciones custom persisten en `./custom-songs`, montado en el contenedor como `/data/custom-songs`.

La web lee la URL de la API desde `VITE_STEM_SPLITTER_URL`.
En la imagen Docker web esta variable se inyecta al iniciar el contenedor en `/config.js`, por lo que puede configurarse como variable de ambiente de runtime en Railway.

## Separación de stems

Se agregó un servicio paralelo de separación con Demucs.

El separador queda expuesto localmente en http://localhost:4000.

Desde la interfaz se puede agregar una canción custom subiendo un archivo master.
La API separa los stems, crea `song.json`, guarda todo en `custom-songs/{slug}` y expone:

- `GET /songs/custom`: catálogo de canciones custom.
- `POST /songs/custom`: crea la entrada con multipart form (`file`, `title`, `artist`, `tempo` opcionales salvo `file`) y responde `201` con `status: processing`.
- `POST /songs/custom/manual`: guarda una canción custom ya separada con multipart form (`title`, `artist`, `tempo`, `cover`, `voz`, `guitarra`, `bajo`, `bateria`); responde `201` con `status: ready`.
- `GET /songs/custom/{slug}/status`: estado de separación (`processing`, `ready` o `error`).
- `GET /songs/custom/{slug}/song.json`: metadata de una canción custom.
- `GET /songs/custom/{slug}/{archivo}`: archivos generados (`voz.mp3`, `guitarra.mp3`, `bajo.mp3`, `bateria.mp3`, etc.).

Flujo esperado por canción:

1. Coloca el archivo master en public/audio/{slug}/raw.mp3
2. Ejecuta ./separate.sh {slug}
3. El script levanta backing-tracking-stemsplitter, sube raw.mp3 al separador y guarda separated.zip
4. Además copia los stems al formato que usa la app:

- voz.mp3 <- vocals
- bajo.mp3 <- bass
- bateria.mp3 <- drums
- guitarra.mp3 <- other

También genera public/audio/{slug}/song.json con:

- title
- artist
- tempo
- tracks

`title`, `artist` y `tempo` se leen desde la metadata del mp3 si existen. Si faltan, `title` cae al slug humanizado y `tracks` usa el set por defecto de la app.

La carpeta temporal unzipped ya no se conserva al terminar el proceso.

Nota: other no equivale a guitarra pura; es la mezcla instrumental restante que devuelve Demucs.
