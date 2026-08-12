# Documentación — Metal Con Huesillo Backing Tracks

Documentación técnica del proyecto: qué es, cómo está construido, cómo funciona cada pieza y cómo operarlo.

## Índice

| Documento | Contenido |
|---|---|
| [diagrama.html](diagrama.html) | **Mapa interactivo del proyecto** (HTML + D3 vía CDN): 32 cajas clickeables con detalle, zoom/pan, búsqueda y zonas colapsables — abre en cualquier navegador |
| [arquitectura.md](arquitectura.md) | Arquitectura general, capas, flujos principales, decisiones de diseño |
| [reproductor.md](reproductor.md) | Motor de reproducción multi-track: sincronía, BPM, pitch, metrónomo, loop A-B, checkpoints y MIDI |
| [api-stems.md](api-stems.md) | API Flask de separación de stems (Demucs), canciones custom, checkpoints — endpoints completos |
| [canciones.md](canciones.md) | Convención de audios, formato `song.json`, catálogo actual, pipeline `separate.sh` |
| [despliegue.md](despliegue.md) | Docker, docker-compose, nginx, runtime config, Railway |
| [estado-actual.md](estado-actual.md) | **Cómo está construido hasta ahora**: historia por fases, estado, deuda técnica y próximos pasos |

Para quienes trabajan en el código: [`.agents/AGENTS.md`](../.agents/AGENTS.md) (reglas) y [`.agents/SKILLS.md`](../.agents/SKILLS.md) (procedimientos operativos).

## Resumen ejecutivo

- **Qué es:** una SPA en React 19 + Vite 5 que reproduce backing tracks por stems (voz, guitarra, bajo, batería, metrónomo) para ensayar con la banda *Metal Con Huesillo*. Se controla desde un navegador y, con un controlador **Bluetooth MIDI**, se navegan checkpoints (secciones de la canción) sin tocar la computadora.
- **Stack:** React 19, Vite 5, ESLint 9 (flat config), Python 3.11 + Flask + Demucs (separación de stems), SQLite (persistencia), Docker + nginx, deploy en Railway.
- **Catálogo:** canciones estáticas versionadas en `public/audio/{slug}/` (6 actuales) + canciones custom subidas desde la UI, separadas por Demucs en background y persistidas en `custom-songs/`.
- **Características clave:** mezcla de stems con mute y paneo L/R/stereo, cambio de tempo (40–220 BPM) y transposición (−6..+6 semitonos) sin re-exportar audio, metrónomo sintético con count-in de 4 tiempos, loop A-B, letras sincronizadas (SRT), checkpoints por grupos con salto por MIDI.

> 📌 **Nota:** el `README.md` de la raíz contiene la referencia operativa (endpoints y flujos). Esta carpeta `docs/` profundiza en *cómo* está construido. Si encuentras discrepancias, el código manda; actualiza ambos.
