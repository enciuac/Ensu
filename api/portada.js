// Trae una portada de fuera y la guarda en el almacén del propio EnSu.
// Se hace aquí y no en el navegador porque esos servidores no permiten
// que una web ajena lea sus imágenes (CORS); desde el servidor sí se puede.
// Solo responde a quien tenga sesión de autor en Supabase, y sube con SU sesión:
// aquí no hay ninguna clave secreta.
const SUPABASE_URL = "https://wgtolhgtdpxasliaaxaa.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ze4N3Wl2SyqnBmEtRlcO-A_M1drZqmX";
const ORIGENES = ["https://ensu-eight.vercel.app", "http://localhost:8080", "http://127.0.0.1:8080"];
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
const MAX = 8 * 1024 * 1024;

const json = (res, code, cuerpo, origen) => {
  if (origen) res.setHeader("Access-Control-Allow-Origin", origen);
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  res.status(code).json(cuerpo);
};

module.exports = async (req, res) => {
  const origen = ORIGENES.includes(req.headers.origin) ? req.headers.origin : "";
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", origen || ORIGENES[0]);
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(204).end();
  }
  if (req.method !== "POST") return json(res, 405, { error: "Método no permitido" }, origen);

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const { id, url } = req.body || {};
  if (!token) return json(res, 401, { error: "Inicia sesión." }, origen);
  if (!/^\d+$/.test(String(id || ""))) return json(res, 400, { error: "Entrada no válida." }, origen);
  if (!/^https:\/\//i.test(String(url || ""))) return json(res, 400, { error: "La portada debe ser un enlace https." }, origen);
  if (String(url).startsWith(`${SUPABASE_URL}/storage/`)) return json(res, 200, { url, yaEstaba: true }, origen);

  const cab = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` };
  try {
    const usuario = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: cab });
    if (!usuario.ok) return json(res, 401, { error: "Tu sesión ha caducado. Vuelve a entrar." }, origen);
    const { id: uid } = await usuario.json();
    const autores = await fetch(`${SUPABASE_URL}/rest/v1/autores?select=user_id&user_id=eq.${uid}`, { headers: cab });
    const filas = autores.ok ? await autores.json() : [];
    if (!filas.length) return json(res, 403, { error: "Esta cuenta no tiene permisos de autor." }, origen);
  } catch (err) {
    return json(res, 502, { error: "No se pudo comprobar tu sesión." }, origen);
  }

  let datos, mime;
  try {
    // Algunos servidores rechazan las peticiones que no parecen de un navegador
    const img = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8"
      },
      redirect: "follow"
    });
    if (!img.ok) return json(res, 502, { error: `El servidor de la imagen respondió ${img.status}.` }, origen);
    mime = String(img.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!EXT[mime]) return json(res, 415, { error: `Eso no es una imagen admitida (${mime || "sin tipo"}).` }, origen);
    const buf = Buffer.from(await img.arrayBuffer());
    if (!buf.length) return json(res, 502, { error: "La imagen llegó vacía." }, origen);
    if (buf.length > MAX) return json(res, 413, { error: "La imagen pesa más de 8 MB." }, origen);
    datos = buf;
  } catch (err) {
    return json(res, 502, { error: "No se pudo descargar la imagen (el enlace puede estar roto)." }, origen);
  }

  const ruta = `${id}.${EXT[mime]}`;
  try {
    const subida = await fetch(`${SUPABASE_URL}/storage/v1/object/portadas/${ruta}`, {
      method: "POST",
      headers: { ...cab, "content-type": mime, "x-upsert": "true", "cache-control": "31536000" },
      body: datos
    });
    if (!subida.ok) {
      const t = await subida.text().catch(() => "");
      if (/Bucket not found/i.test(t)) return json(res, 500, { error: "Falta ejecutar supabase/13_portadas.sql." }, origen);
      return json(res, 502, { error: `No se pudo guardar la portada (${subida.status}).` }, origen);
    }
  } catch (err) {
    return json(res, 502, { error: "No se pudo guardar la portada." }, origen);
  }

  return json(res, 200, { url: `${SUPABASE_URL}/storage/v1/object/public/portadas/${ruta}`, bytes: datos.length }, origen);
};
