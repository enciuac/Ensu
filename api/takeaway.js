// Lee una imagen de takeaways con IA y devuelve su contenido en texto.
// Claude primero, Gemini de suplente (ver api/_ia.js). Las claves viven solo en
// Vercel, nunca en la web. Solo responde a quien tenga sesión de autor.
const { ORIGENES, MODELO_CLAUDE, json, preflight, comprobarAutor, pedirJson, hayIA } = require("./_ia");

const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const INSTRUCCIONES = `Eres un lector atento. Esta imagen es un resumen visual ("takeaways") de un libro.
Extrae su contenido en español, respetando el texto original de la imagen: no lo reescribas ni lo resumas más, solo corrige erratas evidentes y la puntuación.
- takeaways: cada punto numerado de la imagen, en su orden. "titulo" es el encabezado corto; "texto", su explicación.
- idea: el bloque destacado tipo "la gran idea del libro", si existe; si no, "".
- frase: la frase de cierre destacada, si existe; si no, "".
Si la imagen no contiene takeaways de un libro, devuelve las tres cosas vacías.`;

const ESQUEMA = {
  type: "object",
  properties: {
    takeaways: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          texto: { type: "string" }
        },
        required: ["titulo", "texto"],
        additionalProperties: false
      }
    },
    idea: { type: "string" },
    frase: { type: "string" }
  },
  required: ["takeaways", "idea", "frase"],
  additionalProperties: false
};

module.exports = async (req, res) => {
  const origen = ORIGENES.includes(req.headers.origin) ? req.headers.origin : "";
  if (preflight(req, res, origen)) return;

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  // Diagnóstico: con qué cuenta la función. Solo para el autor.
  if (req.method === "GET") {
    const malo = await comprobarAutor(token);
    if (malo) return json(res, malo.code, { error: malo.error }, origen);
    return json(res, 200, {
      principal: MODELO_CLAUDE,
      claude: !!process.env.ANTHROPIC_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY
    }, origen);
  }
  if (req.method !== "POST") return json(res, 405, { error: "Método no permitido" }, origen);
  if (!hayIA()) return json(res, 500, { error: "No hay ninguna IA configurada. Añade ANTHROPIC_API_KEY en Vercel." }, origen);

  const { imagen } = req.body || {};
  if (!/^https:\/\/[\w.-]+\.supabase\.co\/storage\/v1\/object\/public\//.test(String(imagen || "")))
    return json(res, 400, { error: "Imagen no válida." }, origen);
  const malo = await comprobarAutor(token);
  if (malo) return json(res, malo.code, { error: malo.error }, origen);

  try {
    // La imagen (pública, del propio Supabase) se envía a la IA
    const img = await fetch(imagen);
    if (!img.ok) return json(res, 400, { error: "No se pudo leer la imagen." }, origen);
    const bytes = Buffer.from(await img.arrayBuffer());
    if (bytes.length > 4_500_000) return json(res, 413, { error: "La imagen es demasiado grande." }, origen);
    const mime = String(img.headers.get("content-type") || "image/jpeg").split(";")[0].trim().toLowerCase();
    if (!TIPOS_IMAGEN.includes(mime)) return json(res, 415, { error: `No se admiten imágenes ${mime}.` }, origen);

    const { salida, modelo, proveedor, fallo } = await pedirJson({
      esquema: ESQUEMA,
      texto: INSTRUCCIONES,
      imagen: { mime, base64: bytes.toString("base64") }
    });
    if (fallo) return json(res, fallo.code, { error: fallo.error }, origen);

    const lista = Array.isArray(salida.takeaways) ? salida.takeaways : [];
    return json(res, 200, {
      modelo, proveedor,
      takeaways: lista.map(t => ({ titulo: String(t.titulo || "").trim(), texto: String(t.texto || "").trim() }))
        .filter(t => t.titulo || t.texto).slice(0, 20),
      idea: String(salida.idea || "").trim(),
      frase: String(salida.frase || "").trim()
    }, origen);
  } catch (err) {
    return json(res, 500, { error: "Error inesperado al leer la imagen." }, origen);
  }
};
