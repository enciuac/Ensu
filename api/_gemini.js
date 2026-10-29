// Gemini, el suplente. Solo entra cuando Claude no puede. Lo usa api/_ia.js.
// La clave (GEMINI_API_KEY) vive en las variables de Vercel, nunca en la web.
const MODELOS_RESPALDO = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash"];
let modelosCache = null;

const disponible = () => !!process.env.GEMINI_API_KEY;

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

// Gemini no acepta un esquema JSON completo, así que se le enseña la forma
// esperada dentro del propio texto, como se hacía antes.
const formaDe = esquema => JSON.stringify(Object.fromEntries(
  Object.entries((esquema && esquema.properties) || {}).map(([k, v]) =>
    [k, v.type === "array" ? [] : (v.type === "integer" || v.type === "number") ? 0 : ""])
));

async function pedir({ texto, imagen, esquema, sistema, maxTokens = 8192 }) {
  const partes = [{ text: `${sistema ? sistema + "\n\n" : ""}${texto}\n\nDevuelve ÚNICAMENTE este JSON, sin texto alrededor:\n${formaDe(esquema)}` }];
  if (imagen) partes.push({ inline_data: { mime_type: imagen.mime, data: imagen.base64 } });
  const cuerpo = {
    contents: [{ parts: partes }],
    generationConfig: { temperature: 0.3, responseMimeType: "application/json", maxOutputTokens: maxTokens }
  };

  let ultimo = "", agotado = false, sinPermiso = false, intentos = 0;
  // Cada intento vuelve a subir el cuerpo entero: con tres basta para sortear un
  // modelo caído, y si el problema es de la cuenta fallarán los tres igual.
  for (const modelo of await modelosDisponibles()) {
    if (++intentos > 3) break;
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify(cuerpo)
      });
    } catch (_) { ultimo = "no se pudo contactar"; continue; }
    if (r.status === 404) { ultimo = `modelo ${modelo} no disponible`; continue; }
    let data = null;
    try { data = await r.json(); } catch (_) { data = null; }
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || `error ${r.status}`;
      if (/API key|permission|PERMISSION_DENIED/i.test(msg)) { sinPermiso = true; ultimo = msg; continue; }
      if (r.status === 429) { agotado = true; ultimo = msg; continue; }
      ultimo = msg; continue;
    }
    const txt = (((data || {}).candidates || [])[0] || {}).content?.parts?.map(p => p.text).join("") || "";
    try { return { salida: JSON.parse(txt.replace(/^```(?:json)?|```$/g, "").trim()), modelo }; }
    catch (_) { ultimo = "respuesta no interpretable"; }
  }
  if (agotado) return { fallo: { code: 429, error: "Gemini está al límite ahora mismo." } };
  if (sinPermiso) return { fallo: { code: 500, error: "La clave de Gemini no es válida o no tiene permisos." } };
  return { fallo: { code: 502, error: `Gemini no respondió correctamente (${ultimo}).` } };
}

module.exports = { disponible, pedir, modelosDisponibles };
