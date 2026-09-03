/* =====================================================================
   Service worker do Collector.

   Duas regras, e só:

   1. A PÁGINA vem da rede primeiro, com o cache como rede de segurança.
      Assim uma publicação nova chega na próxima vez que você abrir com
      internet — e o app continua abrindo no metrô.

   2. IMAGEM DE CARTA fica no cache depois de vista uma vez. É o que
      pesa e o que nunca muda: a arte de uma impressão é sempre a mesma.

   O que NUNCA é cacheado: preço, busca do Scryfall, banco. Dado velho
   de preço é pior que dado nenhum.
   ===================================================================== */

const VERSAO = "collector-v1";
const CASCA = VERSAO + "-casca";
const ARTES = VERSAO + "-artes";
const MAX_ARTES = 400;

const ESSENCIAIS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icone-192.png",
  "./icone-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CASCA)
      .then(c => c.addAll(ESSENCIAIS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => !n.startsWith(VERSAO)).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/* corta o cache de artes quando passa do teto, jogando fora as mais antigas */
async function podar(nome, teto){
  const c = await caches.open(nome);
  const chaves = await c.keys();
  if(chaves.length <= teto) return;
  await Promise.all(chaves.slice(0, chaves.length - teto).map(k => c.delete(k)));
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;

  const url = new URL(req.url);
  const ehArte = /(^|\.)scryfall\.io$/.test(url.hostname)
              || /product-images\.tcgplayer\.com$/.test(url.hostname);
  const ehApi  = /api\.scryfall\.com$|supabase\.co$|mtgjson\.com$|tcgcsv\.com$|awesomeapi\.com\.br$/.test(url.hostname);

  if(ehApi) return;                       // preço e busca sempre da rede

  if(ehArte){
    e.respondWith((async () => {
      const cache = await caches.open(ARTES);
      const guardada = await cache.match(req);
      if(guardada) return guardada;
      try{
        const resp = await fetch(req);
        if(resp.ok || resp.type === "opaque"){
          cache.put(req, resp.clone());
          podar(ARTES, MAX_ARTES);
        }
        return resp;
      }catch(err){
        return guardada || Response.error();
      }
    })());
    return;
  }

  // a casca do app: rede primeiro, cache como plano B
  if(url.origin === self.location.origin){
    e.respondWith((async () => {
      try{
        const resp = await fetch(req);
        if(resp.ok){
          const cache = await caches.open(CASCA);
          cache.put(req, resp.clone());
        }
        return resp;
      }catch(err){
        const cache = await caches.open(CASCA);
        return (await cache.match(req))
            || (await cache.match("./index.html"))
            || Response.error();
      }
    })());
  }
});
