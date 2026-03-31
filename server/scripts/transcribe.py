"""Transcribe audio with faster-whisper, output JSON with word timestamps.

Usage: python transcribe.py <audio_file> [model_size]
Outputs JSON to stdout:
  { "transcript": "...", "words": [{"word": "...", "start": 0.0, "end": 0.5}, ...] }
"""

import json
import sys
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: transcribe.py <audio_file> [model_size]"}))
        sys.exit(1)

    audio_path = Path(sys.argv[1])
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

    if not audio_path.exists():
        print(json.dumps({"error": f"File not found: {audio_path}"}))
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({"error": "faster-whisper not installed. Run: pip install faster-whisper"}))
        sys.exit(1)

    model = WhisperModel(model_size, compute_type="int8")
    segments, info = model.transcribe(str(audio_path), word_timestamps=True)

    words = []
    transcript_parts = []

    for segment in segments:
        transcript_parts.append(segment.text.strip())
        if segment.words:
            for w in segment.words:
                words.append({
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                })

    result = {
        "transcript": " ".join(transcript_parts),
        "words": words,
        "language": info.language,
        "duration": round(info.duration, 3),
    }

    print(json.dumps(result))

if __name__ == "__main__":
    main()
