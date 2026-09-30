// Lee una imagen de takeaways con Gemini y devuelve su contenido en texto.
// La clave (GEMINI_API_KEY) vive solo aquí, nunca en la web.
// Solo responde a quien tenga sesión de autor en Supabase.
const SUPABASE_URL = "https://wgtolhgtdpxasliaaxaa.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ze4N3Wl2SyqnBmEtRlcO-A_M1drZqmX";
const MODELOS_RESPALDO = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash"];
let modelosCache = null;

// Pregunta a Google qué modelos hay y se queda con el Flash más nuevo.
// Así no depende de una lista escrita a mano que envejece.
async function modelosDisponibles() {
  if (modelosCache) return modelosCache;
  const fijo = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [];
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY }
    });
    if (!r.ok) throw new Error("lista " + r.status);
    const nombres = ((await r.json()).models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => String(m.name || "").replace(/^models\//, ""))
      .filter(n => /flash/i.test(n) && !/(embedding|tts|image|audio|live|native)/i.test(n));
    const version = n => { const m = n.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
    const penaliza = n => (/preview|exp|thinking|lite/i.test(n) ? 1 : 0);
    nombres.sort((a, b) => penaliza(a) - penaliza(b) || version(b) - version(a) || a.length - b.length);
    modelosCache = [...fijo, ...nombres, ...MODELOS_RESPALDO];
  } catch (_) {
    modelosCache = [...fijo, ...MODELOS_RESPALDO];
  }
  return modelosCache;
}
const ORIGENES = ["https://ensu-eight.vercel.app", "http://localhost:8080", "http://127.0.0.1:8080"];

const INSTRUCCIONES = `Eres un lector atento. Esta imagen es un resumen visual ("takeaways") de un libro.
Extrae su contenido en español, respetando el texto original de la imagen: no lo reescribas ni lo resumas más, solo corrige erratas evidentes y la puntuación.
Devuelve únicamente JSON con esta forma:
{"takeaways":[{"titulo":"…","texto":"…"}],"idea":"…","frase":"…"}
- takeaways: cada punto numerado de la imagen, en su orden. "titulo" es el encabezado corto; "texto", su explicación.
- idea: el bloque destacado tipo "la gran idea del libro", si existe; si no, "".
- frase: la frase de cierre destacada, si existe; si no, "".
Si la imagen no contiene takeaways de un libro, devuelve {"takeaways":[],"idea":"","frase":""}.`;

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
  // Diagnóstico: qué modelos ve la función (no consume cuota de generación)
  if (req.method === "GET") {
    if (!process.env.GEMINI_API_KEY) return json(res, 500, { error: "Falta la clave GEMINI_API_KEY en Vercel." }, origen);
    const lista = await modelosDisponibles();
    return json(res, 200, { usara: lista[0], candidatos: lista.slice(0, 8) }, origen);
  }
  if (req.method !== "POST") return json(res, 405, { error: "Método no permitido" }, origen);
  if (!process.env.GEMINI_API_KEY) return json(res, 500, { error: "Falta la clave GEMINI_API_KEY en Vercel." }, origen);

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const { imagen } = req.body || {};
  if (!token) return json(res, 401, { error: "Inicia sesión para usar la IA." }, origen);
  if (!/^https:\/\/[\w.-]+\.supabase\.co\/storage\/v1\/object\/public\//.test(String(imagen || "")))
    return json(res, 400, { error: "Imagen no válida." }, origen);

  try {
    // ¿Quién eres? y ¿estás en la tabla de autores? (lo responde Supabase con tu propia sesión)
    const cab = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` };
    const usuario = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: cab });
    if (!usuario.ok) return json(res, 401, { error: "Tu sesión ha caducado. Vuelve a entrar." }, origen);
    const { id } = await usuario.json();
    const autores = await fetch(`${SUPABASE_URL}/rest/v1/autores?select=user_id&user_id=eq.${id}`, { headers: cab });
    const filas = autores.ok ? await autores.json() : [];
    if (!filas.length) return json(res, 403, { error: "Esta cuenta no tiene permisos de autor." }, origen);

    // La imagen (pública, del propio Supabase) se envía a Gemini
    const img = await fetch(imagen);
    if (!img.ok) return json(res, 400, { error: "No se pudo leer la imagen." }, origen);
    const datos = Buffer.from(await img.arrayBuffer()).toString("base64");
    const mime = img.headers.get("content-type") || "image/jpeg";
    if (datos.length > 9_000_000) return json(res, 413, { error: "La imagen es demasiado grande." }, origen);

    const cuerpo = {
      contents: [{ parts: [{ text: INSTRUCCIONES }, { inline_data: { mime_type: mime, data: datos } }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
    };

    let ultimo = "";
    for (const modelo of await modelosDisponibles()) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify(cuerpo)
      });
      if (r.status === 404) { ultimo = `modelo ${modelo} no disponible`; continue; }   // probamos el siguiente
      const data = await r.json();
      if (!r.ok) {
        const msg = (data && data.error && data.error.message) || `error ${r.status}`;
        if (/API key|permission|PERMISSION_DENIED/i.test(msg)) return json(res, 500, { error: "La clave de Gemini no es válida o no tiene permisos." }, origen);
        if (r.status === 429) return json(res, 429, { error: "Has llegado al límite de Gemini por ahora. Inténtalo en unos minutos." }, origen);
        ultimo = msg; continue;
      }
      const texto = (((data.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text).join("") || "";
      let salida;
      try { salida = JSON.parse(texto.replace(/^```(?:json)?|```$/g, "").trim()); }
      catch (_) { ultimo = "respuesta no interpretable"; continue; }
      const lista = Array.isArray(salida.takeaways) ? salida.takeaways : [];
      return json(res, 200, {
        modelo,
        takeaways: lista.map(t => ({ titulo: String(t.titulo || "").trim(), texto: String(t.texto || "").trim() }))
          .filter(t => t.titulo || t.texto).slice(0, 20),
        idea: String(salida.idea || "").trim(),
        frase: String(salida.frase || "").trim()
      }, origen);
    }
    return json(res, 502, { error: `Gemini no respondió correctamente (${ultimo}).` }, origen);
  } catch (err) {
    return json(res, 500, { error: "Error inesperado al leer la imagen." }, origen);
  }
};
