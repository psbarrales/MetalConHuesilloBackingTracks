import io
import json
import os
import shutil
import subprocess as sp
import tempfile
import zipfile
from pathlib import Path

from flask import Flask, after_this_request, jsonify, request, send_file
from flask_cors import CORS
from mutagen import File as MutagenFile


APP_ROOT = Path(__file__).resolve().parent
UPLOAD_ROOT = APP_ROOT / "uploads"
OUTPUT_ROOT = APP_ROOT / "separated"
ALLOWED_EXTENSIONS = {"mp3", "wav", "ogg", "flac"}
MODEL_NAME = os.environ.get("DEMUCS_MODEL", "htdemucs")
OUTPUT_MP3_BITRATE = os.environ.get("DEMUCS_MP3_BITRATE", "320")

UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
CORS(app)


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4000)