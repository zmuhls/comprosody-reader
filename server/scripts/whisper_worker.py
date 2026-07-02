"""Long-running faster-whisper worker.

Reads JSON requests from stdin (one per line):
  {"id": "uuid", "audio_path": "/tmp/file.webm", "model_size": "base"}
Writes JSON responses to stdout (one per line):
  {"id": "uuid", "result": {...}}  or  {"id": "uuid", "error": "..."}
"""

import json
import sys
from pathlib import Path

try:
    from faster_whisper import WhisperModel
except ImportError as exc:
    print(json.dumps({"id": None, "error": f"faster-whisper not installed: {exc}"}))
    sys.exit(1)


def load_model(model_size: str) -> WhisperModel:
    return WhisperModel(model_size, compute_type="int8")


def transcribe(model: WhisperModel, audio_path: str):
    segments, info = model.transcribe(audio_path, word_timestamps=True)

    words = []
    transcript_parts = []

    for segment in segments:
        text = segment.text.strip()
        if text:
            transcript_parts.append(text)
        if segment.words:
            for w in segment.words:
                word_text = w.word.strip()
                if word_text:
                    words.append({
                        "word": word_text,
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                    })

    return {
        "transcript": " ".join(transcript_parts),
        "words": words,
        "language": info.language,
        "duration": round(info.duration, 3),
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"id": None, "error": "Usage: whisper_worker.py <model_size>"}))
        sys.exit(1)

    model_size = sys.argv[1]
    try:
        model = load_model(model_size)
    except Exception as exc:
        print(json.dumps({"id": None, "error": f"Failed to load Whisper model: {exc}"}))
        sys.exit(1)

    print(json.dumps({"id": None, "status": "ready", "model_size": model_size}))
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            print(json.dumps({"id": None, "error": f"Invalid JSON: {exc}"}))
            sys.stdout.flush()
            continue

        req_id = req.get("id")
        audio_path = req.get("audio_path")
        requested_model = req.get("model_size") or model_size

        if req.get("action") == "exit":
            print(json.dumps({"id": req_id, "status": "exiting"}))
            sys.stdout.flush()
            break

        if not audio_path:
            print(json.dumps({"id": req_id, "error": "Missing audio_path"}))
            sys.stdout.flush()
            continue

        try:
            if requested_model != model_size:
                # Reload if a different model size is requested.
                model = load_model(requested_model)
                model_size = requested_model
            result = transcribe(model, audio_path)
            print(json.dumps({"id": req_id, "result": result}))
        except Exception as exc:
            print(json.dumps({"id": req_id, "error": str(exc)}))
        sys.stdout.flush()


if __name__ == "__main__":
    main()
