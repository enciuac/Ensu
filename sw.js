/* EnSu · Service worker
   - La web (HTML, CSS, JS, iconos): red primero; sin conexión, la copia guardada.
   - Datos públicos (entradas, ajustes): primero red; sin conexión, la última copia.
   - Portadas: caché primero (no cambian).
   Nunca se cachean notas privadas, tareas ni historial. Al cerrar sesión la web
   borra la caché de datos ("ensu-datos"). */
const VERSION = "ensu-web-v3";
const DATOS = "ensu-datos";
const PORTADAS = "ensu-portadas";
const SHELL = ["./", "index.html", "css/ensu.css", "js/ensu.js", "manifest.webmanifest",
  "img/icon.svg", "img/icon-192.png", "img/icon-512.png", "img/favicon-32.png", "img/logo.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => ![VERSION, DATOS, PORTADAS].includes(k) && !k.startsWith("ensu-ext")).map(k => caches.delete(k))))
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
  const r = await fetch(req);
  if (r.ok || r.type === "opaque") (await caches.open(cache)).put(req, r.clone());
  return r;
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
  if (/\.supabase\.co$/.test(u.hostname) && /^\/rest\/v1\/(entradas|ajustes)$/.test(u.pathname)) { e.respondWith(redPrimero(req, DATOS)); return; }
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
