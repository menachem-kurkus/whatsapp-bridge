# Optional voice notes: turns an audio file into text, locally, with faster-whisper.
#   pip install faster-whisper
import sys
from faster_whisper import WhisperModel

model = WhisperModel("base.en", device="cpu", compute_type="int8")
segments, _ = model.transcribe(sys.argv[1], beam_size=1, language="en")
print("".join(s.text for s in segments).strip())
