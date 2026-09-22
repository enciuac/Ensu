// Vista previa para compartir (WhatsApp, redes…).
// /e/:id   → ficha de una entrada   (vercel.json la reescribe a /api/entrada?id=:id)
// /r/:anio → resumen del año        (vercel.json la reescribe a /api/entrada?anio=:anio)
// Los robots leen las etiquetas og:*; las personas son redirigidas a la web.
// Solo lee datos públicos (la seguridad RLS de Supabase oculta lo privado).
const SUPABASE_URL = "https://wgtolhgtdpxasliaaxaa.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ze4N3Wl2SyqnBmEtRlcO-A_M1drZqmX";

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const corta = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
const consulta = async q => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: { apikey: SUPABASE_KEY } });
  if (!r.ok) throw new Error("supabase " + r.status);
  return r.json();
};

module.exports = async (req, res) => {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const base = `${req.headers["x-forwarded-proto"] || "https"}://${host}`;
  const q = req.query || {};
  let titulo = "EnSu — Lo que leo me forma";
  let desc = "Una biblioteca personal: reflexiones, citas y cómo cada lectura aterriza en la vida real.";
  let imagen = `${base}/img/icon-512.png`;
  let destino = `${base}/#/`;
  let url = base;

  try {
    if (/^\d+$/.test(q.id || "")) {
      destino = `${base}/#/leer/${q.id}`;
      url = `${base}/e/${q.id}`;
      const [e] = await consulta(`entradas?id=eq.${q.id}&select=tipo,libro,autor,titulo_ref,reflexion,portada,portada_id`);
      if (e) {
        titulo = e.tipo === "reflexion" ? (e.titulo_ref || e.libro) : `${e.libro}${e.autor ? ` — ${e.autor}` : ""}`;
        desc = corta(e.titulo_ref && e.tipo !== "reflexion" ? e.titulo_ref : e.reflexion, 190) || desc;
        if (e.portada) imagen = e.portada;
        else if (e.portada_id > 0) imagen = `https://covers.openlibrary.org/b/id/${e.portada_id}-L.jpg`;
        else if (e.tipo === "libro" && e.portada_id === 0 && e.libro) {
          // Portada aún no guardada: búsqueda rápida en Open Library (máx. 2,5 s)
          try {
            const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
            const ap = String(e.autor || "").replace(/\(.*?\)/g, "").replace(/\s(y|&|and)\s.*$/i, "").trim().split(/\s+/).pop() || "";
            const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(`${e.libro} ${ap}`.trim())}&limit=5&fields=cover_i`, { signal: ctl.signal });
            clearTimeout(t);
            const d = ((await r.json()).docs || []).find(x => x.cover_i);
            if (d) imagen = `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`;
          } catch (_) { }
        }
      }
    } else if (/^\d{4}$/.test(q.anio || "")) {
      const y = q.anio;
      destino = `${base}/#/resumen/${y}`;
      url = `${base}/r/${y}`;
      const filas = await consulta(`entradas?select=*`);
      const n = filas.filter(e => e.tipo === "libro" && e.estado === "terminado" && String(e.terminado_en || e.fecha || "").startsWith(y)).length;
      titulo = `Mi ${y} en libros`;
      desc = `${n} ${n === 1 ? "libro leído" : "libros leídos"} en ${y}: mi estantería, favoritos y las ideas que más se repitieron.`;
    }
  } catch (_) { /* si falla, vista previa genérica */ }

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>${esc(titulo)} · EnSu</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="EnSu">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(imagen)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(titulo)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(imagen)}">
<link rel="icon" href="/img/icon.svg" type="image/svg+xml">
<meta http-equiv="refresh" content="0; url=${esc(destino)}">
<script>location.replace(${JSON.stringify(destino)});</script>
</head><body style="font-family:system-ui,sans-serif;background:#F7F4EF;color:#1A1714;display:grid;place-items:center;min-height:100vh;margin:0">
<p>Abriendo <a href="${esc(destino)}" style="color:#9C7F4C">${esc(titulo)}</a>…</p>
</body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
  res.status(200).send(html);
};
