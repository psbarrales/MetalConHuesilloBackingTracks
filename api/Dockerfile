FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV CUSTOM_SONGS_ROOT=/data/custom-songs

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY tools/stemsplitter/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY tools/stemsplitter/app.py .

RUN mkdir -p /data/custom-songs

EXPOSE 4000

CMD ["python", "app.py"]
