// Service worker cache-first, vanilla (sem Workbox).
// Sobe a versao do cache sempre que a lista de assets mudar (ex: Fase 6,
// quando entrarem os ~40 objetos com imagem/audio reais).
const CACHE_VERSION = "v7";
const CACHE_NAME = `alice-idiomas-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "index.html",
  "parent.html",
  "manifest.json",
  "css/style.css",
  "css/parent.css",
  "js/db.js",
  "js/vad.js",
  "js/recorder.js",
  "js/app.js",
  "js/parent.js",
  "data/words.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

// Monta a lista de audios/imagens a partir do words.json, pra nao precisar
// editar este arquivo toda vez que a Fase 6 adicionar objetos novos.
async function wordAssetUrls() {
  const res = await fetch("data/words.json");
  const data = await res.json();
  const urls = [];
  for (const word of data.words) {
    if (word.image) urls.push(word.image);
    for (const lang of data.languages) {
      urls.push(`assets/audio/${word.id}_${lang}.mp3`);
    }
  }
  return urls;
}

async function cacheAll(cache, urls) {
  // addAll() falha tudo se UM recurso faltar (ex: audio ainda nao gerado
  // pra um objeto novo) - aqui cada um falha isolado, so avisa no console.
  await Promise.all(
    urls.map((url) =>
      cache.add(url).catch((err) => console.warn("[sw] nao cacheou", url, err))
    )
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(APP_SHELL);
        const assets = await wordAssetUrls().catch(() => []);
        await cacheAll(cache, assets);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // cacheia oportunisticamente qualquer asset novo servido com sucesso
          // (ex: audio/imagem adicionados depois do primeiro install)
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
