// Lee una imagen de takeaways con Gemini y devuelve su contenido en texto.
// La clave (GEMINI_API_KEY) vive solo en Vercel, nunca en la web.
// Solo responde a quien tenga sesión de autor en Supabase.
const { ORIGENES, modelosDisponibles, json, preflight, comprobarAutor, pedirJson } = require("./_gemini");

const INSTRUCCIONES = `Eres un lector atento. Esta imagen es un resumen visual ("takeaways") de un libro.
Extrae su contenido en español, respetando el texto original de la imagen: no lo reescribas ni lo resumas más, solo corrige erratas evidentes y la puntuación.
Devuelve únicamente JSON con esta forma:
{"takeaways":[{"titulo":"…","texto":"…"}],"idea":"…","frase":"…"}
- takeaways: cada punto numerado de la imagen, en su orden. "titulo" es el encabezado corto; "texto", su explicación.
- idea: el bloque destacado tipo "la gran idea del libro", si existe; si no, "".
- frase: la frase de cierre destacada, si existe; si no, "".
Si la imagen no contiene takeaways de un libro, devuelve {"takeaways":[],"idea":"","frase":""}.`;

module.exports = async (req, res) => {
  const origen = ORIGENES.includes(req.headers.origin) ? req.headers.origin : "";
  if (preflight(req, res, origen)) return;

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
  if (!/^https:\/\/[\w.-]+\.supabase\.co\/storage\/v1\/object\/public\//.test(String(imagen || "")))
    return json(res, 400, { error: "Imagen no válida." }, origen);
  const fallo = await comprobarAutor(token);
  if (fallo) return json(res, fallo.code, { error: fallo.error }, origen);

  try {
    // La imagen (pública, del propio Supabase) se envía a Gemini
    const img = await fetch(imagen);
    if (!img.ok) return json(res, 400, { error: "No se pudo leer la imagen." }, origen);
    const datos = Buffer.from(await img.arrayBuffer()).toString("base64");
    const mime = img.headers.get("content-type") || "image/jpeg";
    if (datos.length > 9_000_000) return json(res, 413, { error: "La imagen es demasiado grande." }, origen);

    const { salida, modelo, fallo: malo } = await pedirJson({
      contents: [{ parts: [{ text: INSTRUCCIONES }, { inline_data: { mime_type: mime, data: datos } }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
    });
    if (malo) return json(res, malo.code, { error: malo.error }, origen);

    const lista = Array.isArray(salida.takeaways) ? salida.takeaways : [];
    return json(res, 200, {
      modelo,
      takeaways: lista.map(t => ({ titulo: String(t.titulo || "").trim(), texto: String(t.texto || "").trim() }))
        .filter(t => t.titulo || t.texto).slice(0, 20),
      idea: String(salida.idea || "").trim(),
      frase: String(salida.frase || "").trim()
    }, origen);
  } catch (err) {
    return json(res, 500, { error: "Error inesperado al leer la imagen." }, origen);
  }
};
