/* EnSu · Service worker
   - La web (HTML, CSS, JS, iconos): red primero; sin conexión, la copia guardada.
   - Datos públicos (entradas, ajustes): primero red; sin conexión, la última copia.
   - Portadas: caché primero (no cambian).
   Nunca se cachean notas privadas, tareas ni historial. Al cerrar sesión la web
   borra la caché de datos ("ensu-datos"). */
const VERSION = "ensu-web-v17";
const DATOS = "ensu-datos";
const PORTADAS = "ensu-portadas";
// Las direcciones van EXACTAMENTE como las pide index.html, con su ?v=2:
// caches.match compara también la query, y sin ella estas copias no se usarían.
const SHELL = ["./", "index.html", "css/ensu.css", "js/ensu.js", "manifest.webmanifest?v=2",
  "img/icon.svg?v=2", "img/icon-192.png?v=2", "img/icon-512.png?v=2",
  "img/favicon-32.png?v=2", "img/apple-touch-icon.png?v=2"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    // DATOS se tira entera al actualizar: las copias viejas pueden llevar campos
    // que ya no deben salir de casa (la fecha completa, sin ir más lejos).
    .then(ks => Promise.all([caches.delete(DATOS), ...ks.filter(k => ![VERSION, DATOS, PORTADAS].includes(k) && !k.startsWith("ensu-ext")).map(k => caches.delete(k))]))
    .then(() => self.clients.claim()));
});

const redPrimero = async (req, cache) => {
  try {
    const r = await fetch(req);
    if (r.ok) (await caches.open(cache)).put(req, r.clone());
    return r;
  } catch (err) {
    const c = await caches.match(req);
    if (c) return c;
    throw err;
  }
};
const cachePrimero = async (req, cache) => {
  const c = await caches.match(req);
  if (c) return c;
  // Se pide en cors primero: así la respuesta SÍ dice si vino bien y no se
  // guarda un 404. Open Library y el almacén de Supabase lo permiten. Si el
  // servidor no admite cors, se cae a la petición normal y no se guarda nada:
  // mejor volver a pedirla cada vez que dejar una portada rota fijada.
  try {
    const r = await fetch(req.url, { mode: "cors", credentials: "omit" });
    if (r.ok) {
      (await caches.open(cache)).put(req, r.clone());
      return r;
    }
    if (r.status) return fetch(req);        // respondió, pero mal: ni guardar ni insistir
  } catch (_) { /* sin cors: seguimos por el camino de siempre */ }
  return fetch(req);
};
const cacheYActualiza = async (req, cache) => {
  const c = await caches.match(req);
  const red = fetch(req).then(async r => { if (r.ok) (await caches.open(cache)).put(req, r.clone()); return r; }).catch(() => c);
  return c || red;
};

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  // Datos públicos de Supabase
  if (/\.supabase\.co$/.test(u.hostname) && /^\/rest\/v1\/(entradas|entradas_publicas|ajustes)$/.test(u.pathname)) { e.respondWith(redPrimero(req, DATOS)); return; }
  // Portadas propias (Storage) y de Open Library
  if ((/\.supabase\.co$/.test(u.hostname) && u.pathname.startsWith("/storage/v1/object/public/portadas/")) || u.hostname === "covers.openlibrary.org") { e.respondWith(cachePrimero(req, PORTADAS)); return; }
  // Fuentes y librería de Supabase
  if (["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"].includes(u.hostname)) { e.respondWith(cacheYActualiza(req, "ensu-ext")); return; }
  // La propia web: red primero (siempre la versión más nueva) y, sin conexión, la guardada.
  // No se tocan las funciones de /api ni las vistas previas /e/ y /r/.
  if (u.origin === self.location.origin && !/^\/(api|e|r)\//.test(u.pathname)) {
    e.respondWith(redPrimero(req, VERSION).catch(async () => (req.mode === "navigate" && await caches.match("./")) || Response.error()));
  }
});
