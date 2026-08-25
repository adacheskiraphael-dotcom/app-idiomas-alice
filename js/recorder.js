// Grava audio do microfone com o melhor metodo disponivel no aparelho.
//
// iPad Air com iOS 12.5.8 (aparelho alvo) NAO tem MediaRecorder (so chegou no
// Safari a partir do iOS 14.3). Por isso: usa MediaRecorder quando existe, e
// cai num gravador manual via ScriptProcessorNode (API mais antiga, deprecated
// mas presente desde o iOS 6) que codifica WAV na mao - sem dependencia externa.

function supportsMediaRecorder() {
  return typeof MediaRecorder !== "undefined";
}

class MediaRecorderClip {
  constructor(stream) {
    this._rec = new MediaRecorder(stream);
    this._chunks = [];
    this._rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this._chunks.push(e.data);
    };
  }

  start() {
    this._chunks = [];
    this._rec.start();
  }

  stop() {
    return new Promise((resolve) => {
      if (this._rec.state !== "recording") {
        resolve(new Blob(this._chunks));
        return;
      }
      this._rec.onstop = () => {
        resolve(new Blob(this._chunks, { type: this._chunks[0]?.type || "audio/webm" }));
      };
      this._rec.stop();
    });
  }
}

class ScriptProcessorClip {
  // Fallback pro iPad Air / iOS 12.5.8 (sem MediaRecorder).
  constructor(stream, audioCtx) {
    this._ctx = audioCtx;
    this._source = this._ctx.createMediaStreamSource(stream);
    this._processor = this._ctx.createScriptProcessor(4096, 1, 1);
    // Safari so dispara onaudioprocess se o node estiver conectado ate o
    // destino - por isso passa por um ganho mudo em vez de tocar o audio de
    // volta (senao a Alice ouviria o proprio microfone em eco).
    this._silentGain = this._ctx.createGain();
    this._silentGain.gain.value = 0;
    this._buffers = [];
    this._recording = false;

    this._processor.onaudioprocess = (e) => {
      if (!this._recording) return;
      this._buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
  }

  start() {
    this._buffers = [];
    this._recording = true;
    this._source.connect(this._processor);
    this._processor.connect(this._silentGain);
    this._silentGain.connect(this._ctx.destination);
  }

  stop() {
    this._recording = false;
    try {
      this._source.disconnect();
      this._processor.disconnect();
      this._silentGain.disconnect();
    } catch (_) {
      // ja desconectado - ignora
    }
    return Promise.resolve(this._encodeWav());
  }

  _encodeWav() {
    const totalLength = this._buffers.reduce((sum, b) => sum + b.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const b of this._buffers) {
      merged.set(b, offset);
      offset += b.length;
    }

    const sampleRate = this._ctx.sampleRate;
    const buffer = new ArrayBuffer(44 + merged.length * 2);
    const view = new DataView(buffer);

    const writeStr = (pos, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(pos + i, str.charCodeAt(i));
    };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + merged.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, merged.length * 2, true);

    let pos = 44;
    for (let i = 0; i < merged.length; i++, pos += 2) {
      const s = Math.max(-1, Math.min(1, merged[i]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return new Blob([buffer], { type: "audio/wav" });
  }
}

/**
 * @param {MediaStream} stream
 * @param {AudioContext} audioCtx - contexto compartilhado do app (necessario so
 *   pro fallback ScriptProcessor; MediaRecorder ignora este parametro)
 */
function createRecorder(stream, audioCtx) {
  if (supportsMediaRecorder()) return new MediaRecorderClip(stream);
  return new ScriptProcessorClip(stream, audioCtx);
}

window.AliceRecorder = { createRecorder, supportsMediaRecorder };
