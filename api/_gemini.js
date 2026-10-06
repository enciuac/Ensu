// Lo que comparten las funciones que hablan con Gemini.
// Los ficheros de api/ que empiezan por "_" no son rutas: solo se importan.
// Aquí no hay secretos; la clave (GEMINI_API_KEY) vive en las variables de Vercel.
const SUPABASE_URL = "https://wgtolhgtdpxasliaaxaa.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ze4N3Wl2SyqnBmEtRlcO-A_M1drZqmX";
const ORIGENES = ["https://ensu-eight.vercel.app", "http://localhost:8080", "http://127.0.0.1:8080"];
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

const json = (res, code, cuerpo, origen) => {
  if (origen) res.setHeader("Access-Control-Allow-Origin", origen);
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  res.status(code).json(cuerpo);
};

// Responde al preflight del navegador. Devuelve true si ya no hay más que hacer.
const preflight = (req, res, origen) => {
  if (req.method !== "OPTIONS") return false;
  res.setHeader("Access-Control-Allow-Origin", origen || ORIGENES[0]);
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.status(204).end();
  return true;
};

// ¿Quién eres? y ¿estás en la tabla de autores? Lo responde Supabase con TU sesión.
// Devuelve "" si todo va bien, o el motivo del rechazo.
async function comprobarAutor(token) {
  if (!token) return { code: 401, error: "Inicia sesión para usar la IA." };
  const cab = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` };
  try {
    const usuario = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: cab });
    if (!usuario.ok) return { code: 401, error: "Tu sesión ha caducado. Vuelve a entrar." };
    const { id } = await usuario.json();
    const autores = await fetch(`${SUPABASE_URL}/rest/v1/autores?select=user_id&user_id=eq.${id}`, { headers: cab });
    const filas = autores.ok ? await autores.json() : [];
    if (!filas.length) return { code: 403, error: "Esta cuenta no tiene permisos de autor." };
    return null;
  } catch (_) {
    return { code: 502, error: "No se pudo comprobar tu sesión." };
  }
}

// Llama a Gemini probando modelos hasta que uno responde JSON interpretable.
// Devuelve {salida, modelo} o {fallo:{code,error}}.
async function pedirJson(cuerpo) {
  let ultimo = "", agotado = false, sinPermiso = false, intentos = 0;
  // Cada intento vuelve a subir el cuerpo entero (una imagen puede pesar MB),
  // así que no se recorre la lista entera: con tres basta para sortear un
  // modelo caído, y si el problema es de la cuenta fallarán los tres igual.
  const MAX_INTENTOS = 3;
  for (const modelo of await modelosDisponibles()) {
    if (++intentos > MAX_INTENTOS) break;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify(cuerpo)
    });
    if (r.status === 404) { ultimo = `modelo ${modelo} no disponible`; continue; }
    // Puede llegar HTML en un corte de Google: leer el cuerpo nunca debe reventar
    let data = null;
    try { data = await r.json(); } catch (_) { data = null; }
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || `error ${r.status}`;
      // El agotamiento o el veto son de ESTE modelo: se prueba con el siguiente,
      // y solo si fallan todos se le cuenta al usuario qué pasó.
      if (/API key|permission|PERMISSION_DENIED/i.test(msg)) { sinPermiso = true; ultimo = msg; continue; }
      if (r.status === 429) { agotado = true; ultimo = msg; continue; }
      ultimo = msg; continue;
    }
    const texto = (((data || {}).candidates || [])[0] || {}).content?.parts?.map(p => p.text).join("") || "";
    try { return { salida: JSON.parse(texto.replace(/^```(?:json)?|```$/g, "").trim()), modelo }; }
    catch (_) { ultimo = "respuesta no interpretable"; }
  }
  if (agotado) return { fallo: { code: 429, error: "Has llegado al límite de Gemini por ahora. Inténtalo en unos minutos." } };
  if (sinPermiso) return { fallo: { code: 500, error: "La clave de Gemini no es válida o no tiene permisos." } };
  return { fallo: { code: 502, error: `Gemini no respondió correctamente (${ultimo}).` } };
}

module.exports = { SUPABASE_URL, SUPABASE_KEY, ORIGENES, modelosDisponibles, json, preflight, comprobarAutor, pedirJson };
