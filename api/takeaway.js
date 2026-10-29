// Lee una imagen de takeaways con Claude y devuelve su contenido en texto.
// La clave (ANTHROPIC_API_KEY) vive solo en Vercel, nunca en la web.
// Solo responde a quien tenga sesión de autor en Supabase.
const { ORIGENES, MODELO, json, preflight, comprobarAutor, pedirJson } = require("./_claude");

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

  // Diagnóstico: qué modelo usa la función. Solo para el autor.
  if (req.method === "GET") {
    const malo = await comprobarAutor(token);
    if (malo) return json(res, malo.code, { error: malo.error }, origen);
    return json(res, 200, { usara: MODELO, clave: !!process.env.ANTHROPIC_API_KEY }, origen);
  }
  if (req.method !== "POST") return json(res, 405, { error: "Método no permitido" }, origen);
  if (!process.env.ANTHROPIC_API_KEY) return json(res, 500, { error: "Falta la clave ANTHROPIC_API_KEY en Vercel." }, origen);

  const { imagen } = req.body || {};
  if (!/^https:\/\/[\w.-]+\.supabase\.co\/storage\/v1\/object\/public\//.test(String(imagen || "")))
    return json(res, 400, { error: "Imagen no válida." }, origen);
  const malo = await comprobarAutor(token);
  if (malo) return json(res, malo.code, { error: malo.error }, origen);

  try {
    // La imagen (pública, del propio Supabase) se envía a Claude
    const img = await fetch(imagen);
    if (!img.ok) return json(res, 400, { error: "No se pudo leer la imagen." }, origen);
    const bytes = Buffer.from(await img.arrayBuffer());
    if (bytes.length > 4_500_000) return json(res, 413, { error: "La imagen es demasiado grande." }, origen);
    const mime = String(img.headers.get("content-type") || "image/jpeg").split(";")[0].trim().toLowerCase();
    if (!TIPOS_IMAGEN.includes(mime)) return json(res, 415, { error: `Claude no admite imágenes ${mime}.` }, origen);

    const { salida, modelo, fallo } = await pedirJson({
      esquema: ESQUEMA,
      contenido: [
        { type: "image", source: { type: "base64", media_type: mime, data: bytes.toString("base64") } },
        { type: "text", text: INSTRUCCIONES }
      ]
    });
    if (fallo) return json(res, fallo.code, { error: fallo.error }, origen);

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
