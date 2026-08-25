// Wrapper minimo de IndexedDB - sem dependencias externas.
const DB_NAME = "alice_idiomas";
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;

      if (!db.objectStoreNames.contains("progress")) {
        // key: `${wordId}:${lang}`
        db.createObjectStore("progress", { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains("session_log")) {
        const store = db.createObjectStore("session_log", {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("by_day", "day");
      }

      if (!db.objectStoreNames.contains("custom_audio")) {
        // key: `${wordId}:${lang}` - gravacoes dos pais, tem prioridade
        // sobre o audio estatico (TTS) no mesmo par objeto+idioma.
        db.createObjectStore("custom_audio", { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function todayKey() {
  return dayKeyFor(new Date());
}

function dayKeyFor(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

async function logRound({ wordId, lang, spoke, audioBlob }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("session_log", "readwrite");
    tx.objectStore("session_log").add({
      day: todayKey(),
      wordId,
      lang,
      spoke,
      audioBlob: audioBlob || null,
      timestamp: Date.now(),
      parentReview: null, // true/false, preenchido no painel dos pais
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getLogByDay(day) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("session_log", "readonly");
    const idx = tx.objectStore("session_log").index("by_day");
    const req = idx.getAll(day);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getTodayLog() {
  return getLogByDay(todayKey());
}

async function setRoundReview(id, correct) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("session_log", "readwrite");
    const store = tx.objectStore("session_log");
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) return resolve();
      record.parentReview = correct;
      store.put(record);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function saveCustomAudio(wordId, lang, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("custom_audio", "readwrite");
    tx.objectStore("custom_audio").put({
      key: `${wordId}:${lang}`,
      wordId,
      lang,
      blob,
      recordedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getCustomAudio(wordId, lang) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("custom_audio", "readonly");
    const req = tx.objectStore("custom_audio").get(`${wordId}:${lang}`);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getAllCustomAudio() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("custom_audio", "readonly");
    const req = tx.objectStore("custom_audio").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteCustomAudio(wordId, lang) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("custom_audio", "readwrite");
    tx.objectStore("custom_audio").delete(`${wordId}:${lang}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

window.AliceDB = {
  openDB,
  todayKey,
  dayKeyFor,
  logRound,
  getTodayLog,
  getLogByDay,
  setRoundReview,
  saveCustomAudio,
  getCustomAudio,
  getAllCustomAudio,
  deleteCustomAudio,
};
