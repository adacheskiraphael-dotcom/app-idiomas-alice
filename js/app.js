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

function playBlob(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.play().catch(cleanup);
  });
}

async function playWordAudio(word, lang) {
  setStatus("playing");

  // 1) gravacao dos pais (prioridade - Fase 4, painel dos pais)
  const custom = await window.AliceDB.getCustomAudio(word.id, lang).catch(() => null);
  if (custom && custom.blob) {
    await playBlob(custom.blob);
    return;
  }

  // 2) audio estatico pre-gerado (TTS, empacotado no app)
  const src = `assets/audio/${word.id}_${lang}.mp3`;
  const hasFile = await fetch(src, { method: "HEAD" }).then(
    (r) => r.ok,
    () => false
  );

  if (hasFile) {
    await new Promise((resolve) => {
      const audio = new Audio(src);
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(resolve);
    });
    return;
  }

  // 3) fallback SOMENTE para testes locais no navegador do desenvolvedor.
  console.warn(
    `[dev] audio ausente para ${word.id}/${lang}, usando speechSynthesis so p/ teste local`
  );
  await speakFallback(word.translations[lang], lang);
}

function ensureAudioContext() {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (sharedAudioCtx.state === "suspended") {
    sharedAudioCtx.resume();
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
  const audioCtx = ensureAudioContext();

  const { word, lang } = queue[queueIndex];
  queueIndex++;

  await playWordAudio(word, lang);

  setStatus("listening");
  const stream = await ensureStream().catch((err) => {
    console.error("Microfone indisponivel:", err);
    return null;
  });

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
