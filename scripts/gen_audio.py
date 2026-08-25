"""Gera os audios estaticos (Fase 6, mas adiantado pra fatia fina de testes).

Le data/words.json e gera um mp3 por par objeto+idioma via ElevenLabs,
salvando em assets/audio/{id}_{lang}.mp3. Pula arquivos que ja existem
(idempotente) - rode de novo a vontade sem gastar cota a toa.

Precisa de ELEVENLABS_API_KEY no ambiente.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

ROOT = os.path.join(os.path.dirname(__file__), "..")
WORDS_PATH = os.path.join(ROOT, "data", "words.json")
AUDIO_DIR = os.path.join(ROOT, "assets", "audio")

API_KEY = os.environ.get("ELEVENLABS_API_KEY")
VOICE_ID = "EXAVITQu4vr4xnSDxMaL"  # Sarah - feminina, suave, boa p/ conteudo infantil
MODEL_ID = "eleven_multilingual_v2"

if not API_KEY:
    print("ELEVENLABS_API_KEY nao encontrada no ambiente.", file=sys.stderr)
    sys.exit(1)

os.makedirs(AUDIO_DIR, exist_ok=True)

with open(WORDS_PATH, encoding="utf-8") as f:
    data = json.load(f)

languages = data["languages"]
words = data["words"]

url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"

total_chars = 0
generated = 0
skipped = 0

for word in words:
    for lang in languages:
        text = word["translations"][lang]
        out_path = os.path.join(AUDIO_DIR, f"{word['id']}_{lang}.mp3")

        if os.path.exists(out_path):
            skipped += 1
            continue

        payload = json.dumps({
            "text": text,
            "model_id": MODEL_ID,
            "voice_settings": {
                "stability": 0.6,
                "similarity_boost": 0.8,
                "speed": 0.85,  # um pouco mais devagar, mais facil pra crianca acompanhar
            },
        }).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "xi-api-key": API_KEY,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req) as resp:
                audio_bytes = resp.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            print(f"ERRO {word['id']}/{lang} ({text!r}): HTTP {e.code} - {body}", file=sys.stderr)
            continue

        with open(out_path, "wb") as f:
            f.write(audio_bytes)

        total_chars += len(text)
        generated += 1
        print(f"OK  {word['id']}/{lang}: {text!r} -> {out_path}")
        time.sleep(0.3)  # gentil com o rate limit

print(f"\nGerados: {generated}  Pulados (ja existiam): {skipped}  Caracteres usados: ~{total_chars}")
