/* =====================================================================
   Service worker do Velvo.

   Duas regras, e só:

   1. A PÁGINA vem da rede primeiro, com o cache como rede de segurança.
      Assim uma publicação nova chega na próxima vez que você abrir com
      internet — e o app continua abrindo no metrô.

   2. IMAGEM DE CARTA fica no cache depois de vista uma vez. É o que
      pesa e o que nunca muda: a arte de uma impressão é sempre a mesma.

   O que NUNCA é cacheado: preço, busca do Scryfall, banco. Dado velho
   de preço é pior que dado nenhum.
   ===================================================================== */

const VERSAO = "velvo-v3";
const CASCA = VERSAO + "-casca";
const ARTES = VERSAO + "-artes";
const MAX_ARTES = 400;

const ESSENCIAIS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icone-192.png",
  "./icone-512.png",
  "./fontes/archivo.woff2",
  "./fontes/plex-mono-400.woff2",
  "./fontes/plex-mono-500.woff2",
  "./fontes/plex-mono-600.woff2",
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

/* =====================================================================
   Notificação no telefone

   O robô diário assina o envio com a chave privada VAPID e o serviço de
   push do navegador entrega aqui — mesmo com o app fechado. No iPhone
   isso só existe para app que foi posto na tela de início; em aba do
   Safari este trecho nunca roda, e é por isso que a tela de avisos
   explica isso em vez de oferecer um botão que não funciona.

   Duas regras:

   1. **Toda notificação é visível.** A permissão foi dada para o app
      avisar de coisa; usá-la para acordar em silêncio seria trapaça, e
      os navegadores derrubam a inscrição de quem faz isso.
   2. **Tocar leva ao lugar certo.** Se o app já está aberto numa aba,
      ela ganha foco e navega; senão abre uma. Notificação que abre a
      Home e faz a pessoa procurar não vale a interrupção.
   ===================================================================== */

self.addEventListener("push", e => {
  let d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(err){ d = { corpo: e.data && e.data.text() }; }
  const titulo = d.titulo || "Velvo";
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.corpo || "",
    icon: "./icone-192.png",
    badge: "./icone-192.png",
    tag: d.tag || "velvo",
    data: { ir: d.ir || "" },
    // duas notificações do mesmo assunto se substituem, mas a nova avisa
    renotify: !!d.tag,
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.ir) || "./",
                          self.location.href).href;
  e.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type:"window", includeUncontrolled:true });
    for(const c of abertas){
      if(c.url.startsWith(self.location.origin)){
        await c.focus();
        if("navigate" in c && c.url !== destino) await c.navigate(destino).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
