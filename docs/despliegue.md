# Despliegue

## Docker local (docker-compose)

```bash
docker compose up --build
```

Levanta dos servicios:

| Servicio | Puerto | Imagen |
|---|---|---|
| `backing-tracking-web` | `8080:80` | `Dockerfile` (raíz): node:20-alpine build → nginx:1.27-alpine |
| `backing-tracking-stemsplitter` | `4000:4000` | `api/Dockerfile`: python:3.11-slim + ffmpeg + demucs |

Volúmenes (persistencia):

- `./api-data:/data` → SQLite `app.db` (checkpoints + MIDI).
- `./custom-songs:/data/custom-songs` → canciones custom.

## Imagen web (multi-stage)

```dockerfile
FROM node:20-alpine AS build        # npm ci && npm run build → dist/
FROM nginx:1.27-alpine              # sirve dist/ con template ${PORT}
```

- `nginx/default.conf` es un **template** nginx: `listen ${PORT}` (ENV `PORT=80` por defecto), SPA fallback (`try_files $uri /index.html`) y caché 1 h para `/audio/`.
- `nginx/30-runtime-config.sh` (entrypoint de nginx) escribe `/usr/share/nginx/html/config.js` al arrancar:

```js
window.__APP_CONFIG__ = { VITE_STEM_SPLITTER_URL: "${VITE_STEM_SPLITTER_URL:-}" };
```

Esto permite que la URL de la API sea **configurable en runtime** (sin rebuild).

## Configuración de la URL de la API

Precedencia en `inMemorySongRepository.js`:

1. `window.__APP_CONFIG__.VITE_STEM_SPLITTER_URL` (runtime, inyectado por nginx).
2. `import.meta.env.VITE_STEM_SPLITTER_URL` (build-time).
3. `http://localhost:4000` (default dev).

En dev (`npm run dev`), `public/config.js` (stub `window.__APP_CONFIG__ = {}`) permite sobreescribir sin tocar Vite env: editar `public/config.js` con la URL deseada.

## Railway (producción)

Según el README y los commits `trigger-build`, la web se despliega en Railway:

- **Web:** la imagen sirve en el puerto de la variable de entorno `PORT` (el template nginx usa `${PORT}`). Setear `VITE_STEM_SPLITTER_URL` como **variable de runtime** (no build-time) para que el entrypoint de nginx la inyecte a `config.js`.
- **API:** necesita un volumen persistente para `/data/custom-songs` y `/data/app.db` (SQLite), o los datos custom/checkpoints se pierden en cada redeploy.

> No hay evidencias en el repo de cómo está configurado Railway (ni dominio, ni volumen); verificar con el dueño antes de asumir detalles.

## Verificaciones

```bash
npm run lint    # ESLint
npm run build   # build de producción
docker compose config   # valida el compose
curl http://localhost:4000/health   # API viva
curl -I http://localhost:8080/      # web viva
```

## Notas

- Existen **dos** Dockerfiles de API: `api/Dockerfile` (contexto raíz; usa `tools/stemsplitter/requirements.txt` y `app.py`; el que usa compose) y `tools/stemsplitter/Dockerfile` (contexto del subdirectorio; para builds independientes dentro de la carpeta). Mantenerlos alineados si se cambia la API.
- `dist/` está gitignoreado y no se sube; el build ocurre dentro del Dockerfile.
- `.dockerignore` excluye `node_modules`, `dist`, `.git`, `.vscode`.
