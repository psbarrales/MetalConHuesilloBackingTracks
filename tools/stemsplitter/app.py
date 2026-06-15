import io
import json
import os
import re
import shutil
import subprocess as sp
import tempfile
import threading
import zipfile
from pathlib import Path

from flask import Flask, after_this_request, jsonify, request, send_file, send_from_directory
from flask_cors import CORS
from mutagen import File as MutagenFile
from werkzeug.utils import secure_filename


APP_ROOT = Path(__file__).resolve().parent
UPLOAD_ROOT = APP_ROOT / "uploads"
OUTPUT_ROOT = APP_ROOT / "separated"
CUSTOM_SONGS_ROOT = Path(os.environ.get("CUSTOM_SONGS_ROOT", APP_ROOT / "custom-songs"))
ALLOWED_EXTENSIONS = {"mp3", "wav", "ogg", "flac"}
ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
MODEL_NAME = os.environ.get("DEMUCS_MODEL", "htdemucs")
OUTPUT_MP3_BITRATE = os.environ.get("DEMUCS_MP3_BITRATE", "320")
CUSTOM_TRACK_MAP = {
    "vocals": "voz",
    "bass": "bajo",
    "drums": "bateria",
    "other": "guitarra",
}

UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
CUSTOM_SONGS_ROOT.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
CORS(app)


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def allowed_image_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


def slugify(value: str) -> str:
    safe_value = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.lower()).strip("-")
    return safe_value or next(tempfile._get_candidate_names())


def unique_song_slug(base_slug: str) -> str:
    slug = base_slug
    counter = 2
    while (CUSTOM_SONGS_ROOT / slug).exists():
        slug = f"{base_slug}-{counter}"
        counter += 1
    return slug


def humanize_slug(value: str) -> str:
    return " ".join(part.capitalize() for part in value.replace("_", "-").split("-") if part)


def coerce_tempo(value):
    if value in (None, ""):
        return None
    try:
        tempo = float(value)
    except (TypeError, ValueError):
        return None
    return tempo if tempo > 0 else None


def extract_metadata(input_path: Path) -> dict:
    audio_file = MutagenFile(input_path, easy=True)
    if audio_file is None:
        return {"title": None, "artist": None, "tempo": None}

    def first_value(key: str):
        value = audio_file.get(key)
        if isinstance(value, list):
            return value[0] if value else None
        return value

    tempo_raw = first_value("bpm") or first_value("tbpm")
    tempo = None
    if tempo_raw not in (None, ""):
        try:
            tempo = float(tempo_raw)
        except (TypeError, ValueError):
            tempo = None

    return {
        "title": first_value("title"),
        "artist": first_value("artist"),
        "tempo": tempo,
    }


def separate(input_path: Path, output_path: Path) -> None:
    output_path.mkdir(parents=True, exist_ok=True)
    cmd = [
        "python",
        "-m",
        "demucs.separate",
        "-n",
        MODEL_NAME,
        "-o",
        str(output_path),
        "--mp3",
        f"--mp3-bitrate={OUTPUT_MP3_BITRATE}",
        str(input_path),
    ]
    sp.run(cmd, check=True)


def create_zip(output_path: Path) -> io.BytesIO:
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file_path in output_path.rglob("*"):
            if file_path.is_file():
                zip_file.write(file_path, arcname=file_path.relative_to(output_path))
    memory_file.seek(0)
    return memory_file


def map_separated_tracks(output_dir: Path, song_dir: Path) -> list[str]:
    tracks = []
    for source_name, target_name in CUSTOM_TRACK_MAP.items():
        source_file = next(output_dir.rglob(f"{source_name}.mp3"), None)
        if source_file is None:
            source_file = next(output_dir.rglob(f"{source_name}.wav"), None)

        if source_file is not None:
            shutil.copy2(source_file, song_dir / f"{target_name}.mp3")
            tracks.append(target_name)

    return tracks


def read_song_manifest(song_dir: Path) -> dict | None:
    manifest_path = song_dir / "song.json"
    if not manifest_path.is_file():
        return None

    with manifest_path.open("r", encoding="utf-8") as file_handle:
        return json.load(file_handle)


def write_song_manifest(song_dir: Path, song: dict) -> None:
    with (song_dir / "song.json").open("w", encoding="utf-8") as file_handle:
        json.dump(song, file_handle, ensure_ascii=False, indent=2)
        file_handle.write("\n")


def song_response(song: dict) -> dict:
    slug = song["slug"]
    return {
        **song,
        "baseUrl": f"{request.host_url.rstrip('/')}/songs/custom/{slug}",
        "custom": True,
    }


def process_custom_song(song_dir: Path, source_path: Path, song: dict) -> None:
    output_dir = OUTPUT_ROOT / song["slug"]

    try:
        separate(source_path, output_dir)
        tracks = map_separated_tracks(output_dir, song_dir)
        if not tracks:
            raise RuntimeError("No separated tracks were produced")

        song.update(
            {
                "status": "ready",
                "tracks": tracks,
                "sourceTracks": [f"{source}.mp3" for source in CUSTOM_TRACK_MAP],
                "error": None,
            }
        )
    except (sp.CalledProcessError, RuntimeError) as error:
        song.update({"status": "error", "tracks": [], "error": str(error)})
    finally:
        shutil.rmtree(output_dir, ignore_errors=True)
        write_song_manifest(song_dir, song)


def save_uploaded_track(file_key: str, song_dir: Path) -> str | None:
    uploaded_file = request.files.get(file_key)
    if uploaded_file is None or uploaded_file.filename == "":
        return None

    if not allowed_file(uploaded_file.filename):
        raise ValueError(f"Invalid file format for {file_key}")

    uploaded_file.save(song_dir / f"{file_key}.mp3")
    return file_key


def save_uploaded_cover(song_dir: Path) -> str | None:
    cover_file = request.files.get("cover")
    if cover_file is None or cover_file.filename == "":
        return None

    if not allowed_image_file(cover_file.filename):
        raise ValueError("Invalid cover file format")

    cover_file.save(song_dir / "portada.png")
    return "portada.png"


@app.get("/health")
def healthcheck():
    return jsonify(status="ok")


@app.post("/metadata")
def read_audio_metadata():
    if "file" not in request.files:
        return jsonify(error="No audio part in the request"), 400

    audio_file = request.files["file"]
    if audio_file.filename == "":
        return jsonify(error="No selected file"), 400

    if not audio_file or not allowed_file(audio_file.filename):
        return jsonify(error="Invalid file format"), 400

    temp_dir = Path(tempfile.mkdtemp(dir=UPLOAD_ROOT))
    source_path = temp_dir / Path(audio_file.filename).name
    audio_file.save(source_path)

    try:
        metadata = extract_metadata(source_path)
        return jsonify(metadata)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.post("/separate")
def separate_audio_file():
    if "file" not in request.files:
        return jsonify(error="No audio part in the request"), 400

    audio_file = request.files["file"]
    if audio_file.filename == "":
        return jsonify(error="No selected file"), 400

    if not audio_file or not allowed_file(audio_file.filename):
        return jsonify(error="Invalid file format"), 400

    job_id = next(tempfile._get_candidate_names())
    filename = Path(audio_file.filename).name
    input_dir = UPLOAD_ROOT / job_id
    output_dir = OUTPUT_ROOT / job_id
    input_dir.mkdir(parents=True, exist_ok=True)

    source_path = input_dir / filename
    audio_file.save(source_path)

    try:
        separate(source_path, output_dir)
        zip_data = create_zip(output_dir)
    except sp.CalledProcessError as error:
        shutil.rmtree(input_dir, ignore_errors=True)
        shutil.rmtree(output_dir, ignore_errors=True)
        return jsonify(error=f"Separation failed: {error}"), 500

    @after_this_request
    def cleanup(response):
        shutil.rmtree(input_dir, ignore_errors=True)
        shutil.rmtree(output_dir, ignore_errors=True)
        return response

    download_name = f"{Path(filename).stem}.zip"
    return send_file(zip_data, mimetype="application/zip", as_attachment=True, download_name=download_name)


@app.get("/songs/custom")
def list_custom_songs():
    songs = []
    for song_dir in CUSTOM_SONGS_ROOT.iterdir():
        if not song_dir.is_dir():
            continue
        song = read_song_manifest(song_dir)
        if song is not None:
            songs.append(song_response(song))

    songs.sort(key=lambda item: (item.get("title") or "").lower())
    return jsonify(songs=songs)


@app.post("/songs/custom")
def create_custom_song():
    if "file" not in request.files:
        return jsonify(error="No audio part in the request"), 400

    audio_file = request.files["file"]
    if audio_file.filename == "":
        return jsonify(error="No selected file"), 400

    if not audio_file or not allowed_file(audio_file.filename):
        return jsonify(error="Invalid file format"), 400

    filename = secure_filename(audio_file.filename)
    if not filename:
        return jsonify(error="Invalid filename"), 400

    source_stem = Path(filename).stem
    requested_title = request.form.get("title", "").strip()
    requested_artist = request.form.get("artist", "").strip()
    requested_tempo = coerce_tempo(request.form.get("tempo"))

    temp_dir = Path(tempfile.mkdtemp(dir=UPLOAD_ROOT))
    temp_source_path = temp_dir / filename
    audio_file.save(temp_source_path)
    metadata = extract_metadata(temp_source_path)
    title = requested_title or metadata.get("title") or humanize_slug(source_stem)
    slug = unique_song_slug(slugify(title or source_stem))
    song_dir = CUSTOM_SONGS_ROOT / slug
    song_dir.mkdir(parents=True, exist_ok=False)
    source_path = song_dir / f"raw{temp_source_path.suffix.lower()}"
    shutil.move(temp_source_path, source_path)
    shutil.rmtree(temp_dir, ignore_errors=True)

    song = {
        "id": f"custom:{slug}",
        "slug": slug,
        "title": title,
        "artist": requested_artist or metadata.get("artist") or "",
        "tempo": requested_tempo or metadata.get("tempo"),
        "tracks": [],
        "sourceTracks": [],
        "status": "processing",
        "error": None,
        "custom": True,
    }
    write_song_manifest(song_dir, song)

    thread = threading.Thread(target=process_custom_song, args=(song_dir, source_path, song), daemon=True)
    thread.start()

    return jsonify(song=song_response(song)), 201


@app.post("/songs/custom/manual")
def create_manual_custom_song():
    title = request.form.get("title", "").strip()
    artist = request.form.get("artist", "").strip()
    tempo = coerce_tempo(request.form.get("tempo"))

    if not title:
        return jsonify(error="Title is required"), 400

    required_tracks = ["voz", "guitarra", "bajo", "bateria"]
    missing_tracks = [
        track_id
        for track_id in required_tracks
        if request.files.get(track_id) is None or request.files.get(track_id).filename == ""
    ]
    if missing_tracks:
        return jsonify(error=f"Missing tracks: {', '.join(missing_tracks)}"), 400

    slug = unique_song_slug(slugify(title))
    song_dir = CUSTOM_SONGS_ROOT / slug
    song_dir.mkdir(parents=True, exist_ok=False)

    try:
        tracks = [save_uploaded_track(track_id, song_dir) for track_id in required_tracks]
        save_uploaded_cover(song_dir)
    except ValueError as error:
        shutil.rmtree(song_dir, ignore_errors=True)
        return jsonify(error=str(error)), 400

    song = {
        "id": f"custom:{slug}",
        "slug": slug,
        "title": title,
        "artist": artist,
        "tempo": tempo,
        "tracks": [track_id for track_id in tracks if track_id],
        "sourceTracks": [f"{track_id}.mp3" for track_id in required_tracks],
        "status": "ready",
        "error": None,
        "custom": True,
        "createdBy": "manual",
    }
    write_song_manifest(song_dir, song)

    return jsonify(song=song_response(song)), 201


@app.get("/songs/custom/<slug>/status")
def get_custom_song_status(slug):
    song_dir = CUSTOM_SONGS_ROOT / slug
    song = read_song_manifest(song_dir)
    if song is None:
        return jsonify(error="Song not found"), 404
    return jsonify(song=song_response(song))


@app.get("/songs/custom/<slug>/song.json")
def get_custom_song_manifest(slug):
    song_dir = CUSTOM_SONGS_ROOT / slug
    song = read_song_manifest(song_dir)
    if song is None:
        return jsonify(error="Song not found"), 404
    return jsonify(song_response(song))


@app.get("/songs/custom/<slug>/<path:filename>")
def get_custom_song_file(slug, filename):
    song_dir = CUSTOM_SONGS_ROOT / slug
    if not song_dir.is_dir():
        return jsonify(error="Song not found"), 404
    return send_from_directory(song_dir, filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4000)
