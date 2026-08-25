// Voice Activity Detection simples via Web Audio API.
// NAO tenta reconhecer o que foi falado - so detecta "houve som de fala".
// 100% offline, sem dependencias.
//
// Reusa um unico AudioContext compartilhado (passado de fora) em vez de criar
// um novo a cada rodada: no iPad Air com iOS 12.5.8 (aparelho alvo), abrir e
// fechar AudioContext repetidamente e uma fonte conhecida de instabilidade no
// WebKit antigo.

class VoiceActivityDetector {
  constructor({
    // Limiares propositalmente tolerantes: e melhor a rodada avancar cedo
    // demais (ela so ouve a palavra de novo no dia seguinte) do que ela ter
    // que repetir varias vezes ate o app "ouvir". Ajustar aqui se, no uso
    // real, estiver passando rodada sem ela falar nada.
    threshold = 0.025, // RMS minimo pra considerar "falando"
    minSpeechMs = 280, // duracao minima de som acima do limiar
    silenceGraceMs = 350, // tolerancia a micro-silencios/gagueira no meio da fala
  } = {}) {
    this.threshold = threshold;
    this.minSpeechMs = minSpeechMs;
    this.silenceGraceMs = silenceGraceMs;
    this._raf = null;
  }

  /**
   * Escuta o microfone ate detectar fala sustentada ou o timeout expirar.
   * @param {MediaStream} stream
   * @param {AudioContext} audioCtx - contexto compartilhado do app
   * @returns {Promise<boolean>} true se detectou fala, false se deu timeout
   */
  listenForSpeech(stream, audioCtx, { timeoutMs = 15000 } = {}) {
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const data = new Float32Array(analyser.fftSize);
    const startedAt = performance.now();
    let speechStartedAt = null;
    let lastAboveThresholdAt = null;

    const cleanup = () => {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
      try {
        source.disconnect();
        analyser.disconnect();
      } catch (_) {
        // ja desconectado - ignora
      }
    };

    return new Promise((resolve) => {
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) sumSquares += data[i] * data[i];
        const rms = Math.sqrt(sumSquares / data.length);

        const now = performance.now();

        if (rms > this.threshold) {
          if (speechStartedAt === null) speechStartedAt = now;
          lastAboveThresholdAt = now;

          if (now - speechStartedAt >= this.minSpeechMs) {
            cleanup();
            resolve(true);
            return;
          }
        } else if (
          speechStartedAt !== null &&
          now - lastAboveThresholdAt > this.silenceGraceMs
        ) {
          // silencio longo demais no meio da tentativa - reinicia contagem
          speechStartedAt = null;
        }

        if (now - startedAt > timeoutMs) {
          cleanup();
          resolve(false);
          return;
        }

        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    });
  }
}

window.VoiceActivityDetector = VoiceActivityDetector;
