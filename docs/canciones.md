# Canciones y audio

## Dos vías para tener canciones

| Vía | Dónde vive | Versionado en git | Cómo se agrega |
|---|---|---|---|
| **Estática** | `public/audio/{slug}/` | Sí (los mp3 están en el repo) | Archivos + `song.json` a mano, o pipeline `./separate.sh {slug}` |
| **Custom** | `custom-songs/{slug}/` (volumen Docker / carpeta local) | No | Desde la UI ("Agregar canción"): separar master por Demucs o subir stems ya separados |

La UI muestra ambas mezcladas, ordenadas por título. Las custom solo aparecen si la API está disponible.

## Convención de archivos por canción

```
public/audio/{slug}/
├── song.json        # obligatorio — manifiesto (ver formato abajo)
├── voz.mp3          # stem de voz
├── guitarra.mp3     # stem de guitarra
├── bajo.mp3         # stem de bajo
├── bateria.mp3      # stem de batería
├── metronomo.mp3    # opcional — si falta, se usa el metrónomo sintético
├── lyrics.srt       # opcional — letra sincronizada (SRT)
└── portada.png      # opcional — portada (la app también busca /{slug}/portada.png)
```

Para canciones **custom**, los stems se sirven desde la API (`GET /songs/custom/{slug}/{archivo}`) y el `baseUrl` lo setea la API; el resto de la convención es idéntica.

## Formato `song.json`

```json
{
  "id": "song:paranoid",
  "slug": "paranoid",
  "title": "Paranoid",
  "artist": "Black Sabbath",
  "tempo": 164,
  "tracks": ["voz", "guitarra", "bajo", "bateria"],
  "sourceTracks": ["vocals.mp3", "bass.mp3", "drums.mp3", "other.mp3"]
}
```

- `tempo` = BPM base (la app lo usa para calcular `playbackRate` con el BPM objetivo). Default 120 si falta o es inválido.
- `tracks` sin `metronomo` es normal: `createSong()` (dominio) lo agrega siempre.
- `sourceTracks` es informativo (nombres originales de Demucs).
- El catálogo estático se construye con `import.meta.glob` en build time: **agregar un `song.json` nuevo basta para que la canción aparezca** (tras rebuild en producción, o con HMR en dev).

## Catálogo actual (estático, `public/audio/`)

| Slug | Canción | Artista | BPM | Notas |
|---|---|---|---|---|
| `aces_spades` | Ace of Spades | Motörhead | — | Con `metronomo.mp3` |
| `breaking_the_law` | Breaking the Law | Judas Priest | — | Con `metronomo.mp3` |
| `crazy_train` | Crazy Train | Ozzy Osbourne | — | Con `metronomo.mp3` y stem `others.mp3` extra |
| `holy_diver` | Holy Diver | Dio | — | Con `metronomo.mp3` |
| `paranoid` | Paranoid | Black Sabbath | 164 | Ejemplo del formato en este doc |
| `we_arent_gonna_take_it` | We're Not Gonna Take It | Twisted Sister | — | Con `metronomo.mp3` |

> ⚠️ El `README.md` de la raíz menciona slugs de ejemplo (`ruta-66`, `noche-urbana`) que **no existen**; quedaron de la primera versión de la documentación.

## Pipeline de separación local (`separate.sh {slug}`)

Para una canción estática con `raw.mp3`:

1. Levanta el contenedor de la API (`docker compose up -d --build backing-tracking-stemsplitter`) y espera `/health`.
2. `POST /metadata` → lee title/artist/tempo de los tags del mp3.
3. `POST /separate` → descarga el zip con los stems.
4. Descomprime y copia: `vocals→voz.mp3`, `bass→bajo.mp3`, `drums→bateria.mp3`, `other→guitarra.mp3`.
5. Genera `song.json` (title/artist/tempo desde metadata; fallback slug humanizado; tracks por defecto).
6. Limpia `separated.zip` y `.separation-tmp` (trap EXIT).

Requisitos: `curl`, `unzip`, `docker`, `python3`. URL configurable con `STEM_SPLITTER_URL` (default `http://localhost:4000`).

## Letras sincronizadas (SRT)

`lyrics.srt` opcional por canción; la app la fetchea de `{baseUrl}/lyrics.srt` y la parsea con `src/ui/formatters/srt.js`:

- Formato estándar de bloques: índice opcional, línea de tiempos `HH:MM:SS,mmm --> HH:MM:SS,mmm`, texto (se unen las líneas restantes).
- El parser aguanta `-->` con comas o puntos y `\r\n`; bloques inválidos se descartan.
- `LyricsPanel` muestra la línea actual y la siguiente (búsqueda por `currentTime`).

## Metadata de mp3 (fallback del pipeline)

La API lee con mutagen (easy tags): `title`, `artist`, `bpm` (o `tbpm`). Precedencia en custom: valor del form > metadata del mp3 > slug humanizado.
