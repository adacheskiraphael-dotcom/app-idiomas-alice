const LANG_NAMES = { en: "inglês", es: "espanhol", fr: "francês", it: "italiano" };

let words = [];
let languages = [];
let wordById = {};

async function loadWords() {
  const res = await fetch("data/words.json");
  const data = await res.json();
  words = data.words;
  languages = data.languages;
  wordById = Object.fromEntries(words.map((w) => [w.id, w]));
}

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---------- Revisão de hoje ----------
const reviewList = document.getElementById("review-list");
const finishBtn = document.getElementById("finish-review-btn");
const summaryBox = document.getElementById("summary-box");
const summaryText = document.getElementById("summary-text");
const routineList = document.getElementById("routine-suggestions");
const shareBtn = document.getElementById("share-btn");

function playBlob(blob) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  audio.play().catch(() => URL.revokeObjectURL(url));
}

async function renderReview() {
  const rounds = await window.AliceDB.getTodayLog();
  reviewList.innerHTML = "";

  if (rounds.length === 0) {
    reviewList.innerHTML = "<p class='hint'>Ainda não tem rodadas hoje.</p>";
    return;
  }

  for (const round of rounds) {
    const word = wordById[round.wordId];
    if (!word) continue;

    const row = document.createElement("div");
    row.className = "round-row";
    row.innerHTML = `
      <span class="emoji">${word.emoji}</span>
      <span class="label">${word.pt} <span class="lang-tag">${round.lang}</span></span>
      <button class="icon-btn play-btn" ${round.audioBlob ? "" : "disabled"}>▶️</button>
      <button class="icon-btn correct" data-value="true">✓</button>
      <button class="icon-btn incorrect" data-value="false">✗</button>
    `;

    const playBtn = row.querySelector(".play-btn");
    const correctBtn = row.querySelector(".correct");
    const incorrectBtn = row.querySelector(".incorrect");

    if (round.parentReview === true) correctBtn.classList.add("selected");
    if (round.parentReview === false) incorrectBtn.classList.add("selected");

    playBtn.addEventListener("click", () => {
      if (round.audioBlob) playBlob(round.audioBlob);
    });

    const setReview = async (value) => {
      await window.AliceDB.setRoundReview(round.id, value);
      correctBtn.classList.toggle("selected", value === true);
      incorrectBtn.classList.toggle("selected", value === false);
    };

    correctBtn.addEventListener("click", () => setReview(true));
    incorrectBtn.addEventListener("click", () => setReview(false));

    reviewList.appendChild(row);
  }
}

function buildSummary(rounds) {
  const graded = rounds.filter((r) => r.parentReview !== null);
  const correct = graded.filter((r) => r.parentReview === true);
  const incorrect = graded.filter((r) => r.parentReview === false);

  const correctWords = [...new Set(correct.map((r) => wordById[r.wordId]?.pt).filter(Boolean))];
  const strugglingWords = [
    ...new Set(incorrect.map((r) => wordById[r.wordId]?.pt).filter(Boolean)),
  ];

  let line = `Hoje a Alice praticou ${rounds.length} palavra(s) em 4 idiomas. `;
  if (correctWords.length) {
    line += `Ela mandou bem em: ${correctWords.join(", ")}. `;
  }
  if (strugglingWords.length) {
    line += `Ainda pegando o jeito de: ${strugglingWords.join(", ")}.`;
  }
  if (!correctWords.length && !strugglingWords.length) {
    line += "Ainda sem rodadas marcadas como certo/errado.";
  }

  const suggestionWordIds = new Set([
    ...incorrect.map((r) => r.wordId),
    ...rounds.map((r) => r.wordId), // Fase 5 vai priorizar so novas/dificeis; por ora sugere tudo do dia
  ]);
  const suggestions = [...suggestionWordIds]
    .map((id) => wordById[id])
    .filter(Boolean)
    .map((w) => `${w.pt}: ${w.routine_tip_pt || "use no dia a dia quando surgir a oportunidade."}`);

  return { line, suggestions };
}

finishBtn.addEventListener("click", async () => {
  const rounds = await window.AliceDB.getTodayLog();
  const { line, suggestions } = buildSummary(rounds);

  summaryText.textContent = line;
  routineList.innerHTML = suggestions.map((s) => `<li>${s}</li>`).join("");
  summaryBox.hidden = false;
  summaryBox.scrollIntoView({ behavior: "smooth" });
});

shareBtn.addEventListener("click", async () => {
  const text = `${summaryText.textContent}\n\n${[...routineList.querySelectorAll("li")]
    .map((li) => "• " + li.textContent)
    .join("\n")}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: "Palavras da Alice - resumo de hoje", text });
    } catch (_) {
      // usuario cancelou o share - ignora
    }
  } else {
    await navigator.clipboard?.writeText(text).catch(() => {});
    alert("Resumo copiado! (esse aparelho não tem o menu de compartilhar nativo)");
  }
});

// ---------- Gravar vozes ----------
const recordList = document.getElementById("record-list");
let activeRecorder = null;
let activeStream = null;
let activeAudioCtx = null;

async function renderRecordList() {
  const custom = await window.AliceDB.getAllCustomAudio();
  const customKeys = new Set(custom.map((c) => c.key));

  recordList.innerHTML = "";

  for (const word of words) {
    for (const lang of languages) {
      const key = `${word.id}:${lang}`;
      const isRecorded = customKeys.has(key);

      const row = document.createElement("div");
      row.className = "record-row";
      row.innerHTML = `
        <span class="emoji">${word.emoji}</span>
        <span class="label">
          ${word.pt} → ${word.translations[lang]}
          <span class="lang-tag">${LANG_NAMES[lang]}</span>
          <span class="status-tag ${isRecorded ? "recorded" : "tts"}">
            ${isRecorded ? "gravado por vocês" : "usando voz sintética"}
          </span>
        </span>
        <button class="icon-btn play-btn" ${isRecorded ? "" : "disabled"}>▶️</button>
        <button class="icon-btn record-btn">🎙️</button>
      `;

      const playBtn = row.querySelector(".play-btn");
      const recordBtn = row.querySelector(".record-btn");

      playBtn.addEventListener("click", async () => {
        const entry = await window.AliceDB.getCustomAudio(word.id, lang);
        if (entry?.blob) playBlob(entry.blob);
      });

      recordBtn.addEventListener("click", () => toggleRecording(recordBtn, word, lang));

      recordList.appendChild(row);
    }
  }
}

async function toggleRecording(button, word, lang) {
  if (activeRecorder) {
    // ja tem uma gravacao rolando (nesse ou noutro botao) - finaliza ela
    const blob = await activeRecorder.stop();
    activeRecorder = null;
    document.querySelectorAll(".record-btn.recording").forEach((b) => {
      b.classList.remove("recording");
      b.textContent = "🎙️";
    });
    if (blob) {
      await window.AliceDB.saveCustomAudio(word.id, lang, blob);
      await renderRecordList();
    }
    return;
  }

  if (!activeStream) {
    activeStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((err) => {
      alert("Não consegui acessar o microfone: " + err.message);
      return null;
    });
    if (!activeStream) return;
  }
  if (!activeAudioCtx) {
    activeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  activeRecorder = window.AliceRecorder.createRecorder(activeStream, activeAudioCtx);
  activeRecorder.start();
  button.classList.add("recording");
  button.textContent = "⏹️";
}

(async function init() {
  await loadWords();
  await renderReview();
  await renderRecordList();
})();
