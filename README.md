# Backing Tracking

Web app en React para reproducir backing tracks por cancion y alternar entre variantes
sin perder la posicion actual de reproduccion.

## Funcionalidades

- N canciones (repositorio en memoria, facil de reemplazar por API).
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

Si cambias slugs o agregas canciones, actualiza src/infrastructure/repositories/inMemorySongRepository.js.

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
