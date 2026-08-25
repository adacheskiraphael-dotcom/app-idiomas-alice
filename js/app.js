// Loop principal da tela da Alice.
// Fase 2 (fatia fina): sem motor de repeticao espacada ainda (isso e Fase 5).
// A composicao da sessao aqui e so um sorteio simples pra validar a mecanica:
// tocar -> ouvir -> falar -> reforco -> proxima rodada.

const stage = document.getElementById("stage");
const wordImage = document.getElementById("word-image");
const statusDot = document.getElementById("status-dot");
const parentCorner = document.getElementById("parent-corner");

let words = [];
let languages = [];
let queue = [];
let queueIndex = 0;
let sharedStream = null;
let sharedAudioCtx = null; // criado/desbloqueado no 1o toque - iOS exige gesto do usuario
let awaitingTap = true;
const audioBufferCache = new Map(); // src -> AudioBuffer decodado, evita rebaixar/redecodificar toda rodada

const SPEECH_SYNTH_FALLBACK_LANG = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
};

function setStatus(state) {
  // estados: idle | playing | listening | success
  statusDot.dataset.state = state;
}

async function loadWords() {
  const res = await fetch("data/words.json");
  const data = await res.json();
  words = data.words;
  languages = data.languages;
}

function buildTodayQueue() {
  // Fase 2: sorteio simples de todos os pares objeto x idioma.
  // TODO(Fase 5): substituir por session.js com repeticao espacada real
  // (erros do dia anterior primeiro, novos limitados a 2-3/dia, etc.)
  const pairs = [];
  for (const w of words) {
    for (const lang of languages) {
      pairs.push({ word: w, lang });
    }
  }
  // Fisher-Yates
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  return pairs;
}

function speakFallback(text, lang) {
  // Fallback SOMENTE para testes locais no navegador do desenvolvedor.
  // No app final (Fase 6), todo audio vem de arquivo pre-gerado (pais ou TTS),
  // nunca de sintese em tempo real no aparelho da Alice - o iOS 12.5.8 do
  // iPad Air, alias, nem tem vozes offline garantidas pra isso.
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = SPEECH_SYNTH_FALLBACK_LANG[lang] || lang;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    speechSynthesis.speak(utter);
  });
}

// Toca tudo pelo MESMO AudioContext usado pro microfone (em vez de um
// elemento <audio> separado). No Safari (iOS e macOS), alternar entre tocar
// por <audio> e gravar por getUserMedia forca uma troca de "modo" na sessao
// de audio do sistema que trava por 1-3s toda vez - era essa a "trava
// aleatoria entre as fases" relatada no teste. Mantendo tudo no mesmo grafo
// de audio, a sessao fica sempre em modo "tocar e gravar" e nao precisa
// renegociar nada a cada rodada.
function playBuffer(buffer, audioCtx) {
  return new Promise((resolve) => {
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(safety);
      resolve();
    };

    // Rede de seguranca: se o AudioContext nao conseguir tocar de verdade
    // (por qualquer motivo - suspenso, aparelho recusou, etc.) o evento
    // "onended" nunca dispara e a rodada trava pra sempre. Isso e pior que
    // so seguir em frente sem o audio ter tocado direito.
    const safety = setTimeout(finish, buffer.duration * 1000 + 3000);

    source.onended = finish;
    try {
      source.start(0);
    } catch (err) {
      console.error("Falha ao iniciar playback:", err);
      finish();
    }
  });
}

async function loadStaticBuffer(src, audioCtx) {
  if (audioBufferCache.has(src)) return audioBufferCache.get(src);

  const res = await fetch(src);
  if (!res.ok) return null;

  const arrayBuffer = await res.arrayBuffer();
  const buffer = await audioCtx.decodeAudioData(arrayBuffer).catch(() => null);
  if (buffer) audioBufferCache.set(src, buffer);
  return buffer;
}

async function loadBlobBuffer(blob, audioCtx) {
  const arrayBuffer = await blob.arrayBuffer();
  return audioCtx.decodeAudioData(arrayBuffer).catch(() => null);
}

async function playWordAudio(word, lang, audioCtx) {
  setStatus("playing");

  // 1) gravacao dos pais (prioridade - Fase 4, painel dos pais)
  const custom = await window.AliceDB.getCustomAudio(word.id, lang).catch(() => null);
  if (custom && custom.blob) {
    const buffer = await loadBlobBuffer(custom.blob, audioCtx);
    if (buffer) {
      await playBuffer(buffer, audioCtx);
      return;
    }
  }

  // 2) audio estatico pre-gerado (TTS, empacotado no app)
  const src = `assets/audio/${word.id}_${lang}.mp3`;
  const buffer = await loadStaticBuffer(src, audioCtx).catch(() => null);
  if (buffer) {
    await playBuffer(buffer, audioCtx);
    return;
  }

  // 3) fallback SOMENTE para testes locais no navegador do desenvolvedor.
  console.warn(
    `[dev] audio ausente para ${word.id}/${lang}, usando speechSynthesis so p/ teste local`
  );
  await speakFallback(word.translations[lang], lang);
}

async function ensureAudioContext() {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (sharedAudioCtx.state === "suspended") {
    await sharedAudioCtx.resume().catch((err) => {
      console.error("Nao consegui retomar o AudioContext:", err);
    });
  }
  return sharedAudioCtx;
}

async function ensureStream() {
  if (sharedStream) return sharedStream;
  sharedStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return sharedStream;
}

async function runRound() {
  if (queueIndex >= queue.length) {
    queue = buildTodayQueue();
    queueIndex = 0;
  }
  const { word } = queue[queueIndex];
  wordImage.textContent = word.emoji;
  awaitingTap = true;
  setStatus("idle");
}

async function onStageTap() {
  if (!awaitingTap) return;
  awaitingTap = false;

  // Desbloqueia audio/mic dentro do gesto de toque (essencial no iOS antigo).
  const audioCtx = await ensureAudioContext();

  const { word, lang } = queue[queueIndex];
  queueIndex++;

  // Pede o microfone ANTES de tocar a palavra: assim a sessao de audio do
  // aparelho ja fica em modo "tocar e gravar" antes do playback comecar, e
  // nao precisa trocar de modo no meio da rodada (era essa troca que travava).
  const stream = await ensureStream().catch((err) => {
    console.error("Microfone indisponivel:", err);
    return null;
  });

  await playWordAudio(word, lang, audioCtx);

  setStatus("listening");

  let spoke = false;
  let clip = null;

  if (stream) {
    const recorder = window.AliceRecorder.createRecorder(stream, audioCtx);
    recorder.start();

    const vad = new VoiceActivityDetector();
    spoke = await vad.listenForSpeech(stream, audioCtx, { timeoutMs: 15000 });

    clip = await recorder.stop();
  }

  await window.AliceDB.logRound({
    wordId: word.id,
    lang,
    spoke,
    audioBlob: clip,
  });

  setStatus("success");
  await celebrate();
  await runRound();
}

function celebrate() {
  // Reforco sempre positivo e neutro - nunca "errado", sem campainha negativa.
  wordImage.classList.add("bounce");
  return new Promise((resolve) => {
    setTimeout(() => {
      wordImage.classList.remove("bounce");
      resolve();
    }, 700);
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.error("Falha ao registrar service worker:", err);
    });
  });
}

// Acesso ao modo pais: toque longo (3s) no canto, sem PIN digitado.
let holdTimer = null;
parentCorner.addEventListener("pointerdown", () => {
  holdTimer = setTimeout(() => {
    window.location.href = "parent.html";
  }, 3000);
});
["pointerup", "pointerleave", "pointercancel"].forEach((evt) =>
  parentCorner.addEventListener(evt, () => clearTimeout(holdTimer))
);

stage.addEventListener("click", onStageTap);

(async function init() {
  registerServiceWorker();
  await loadWords();
  queue = buildTodayQueue();
  await runRound();
})();
