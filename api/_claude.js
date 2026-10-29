// Claude, el proveedor principal de IA. Lo usa api/_ia.js.
// La clave (ANTHROPIC_API_KEY) vive en las variables de Vercel, nunca en la web.
const Mod = require("@anthropic-ai/sdk");
const Anthropic = Mod.default || Mod;

// Sonnet: la visión y el español que hacen falta aquí, sin pagar lo que cuesta
// Opus. Se puede cambiar desde Vercel con CLAUDE_MODEL sin tocar el código.
const MODELO = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/gif"];

let clienteCache = null;
const cliente = () => (clienteCache = clienteCache || new Anthropic());

const disponible = () => !!process.env.ANTHROPIC_API_KEY;

// Traduce los fallos de la API a algo que se pueda leer en pantalla.
function traducir(err) {
  if (err instanceof Anthropic.AuthenticationError)
    return { code: 500, error: "La clave de Claude no es válida. Revísala en Vercel (ANTHROPIC_API_KEY)." };
  if (err instanceof Anthropic.PermissionDeniedError)
    return { code: 500, error: "La clave de Claude no tiene permiso para este modelo." };
  if (err instanceof Anthropic.RateLimitError)
    return { code: 429, error: "Claude está al límite ahora mismo." };
  if (err instanceof Anthropic.BadRequestError)
    return { code: 400, error: `Claude ha rechazado la petición: ${err.message}` };
  if (err instanceof Anthropic.APIConnectionError)
    return { code: 502, error: "No se pudo contactar con Claude." };
  if (err instanceof Anthropic.APIError)
    return { code: 502, error: `Claude ha fallado (${err.status}).` };
  return { code: 500, error: "Error inesperado al hablar con Claude." };
}

/* La forma de la respuesta la impone la API (output_config.format), así que no
   hay que pedirle por favor que devuelva JSON ni rescatar texto entre comillas.
   Devuelve {salida, modelo} o {fallo:{code,error}}. */
async function pedir({ texto, imagen, esquema, sistema, maxTokens = 16000, esfuerzo = "medium" }) {
  if (imagen && !TIPOS_IMAGEN.includes(imagen.mime))
    return { fallo: { code: 415, error: `Claude no admite imágenes ${imagen.mime}.` } };
  const contenido = [];
  if (imagen) contenido.push({ type: "image", source: { type: "base64", media_type: imagen.mime, data: imagen.base64 } });
  contenido.push({ type: "text", text: texto });

  try {
    const r = await cliente().messages.create({
      model: MODELO,
      max_tokens: maxTokens,
      output_config: { effort: esfuerzo, format: { type: "json_schema", schema: esquema } },
      ...(sistema ? { system: sistema } : {}),
      messages: [{ role: "user", content: contenido }]
    });

    // Una negativa o un corte no son una respuesta: hay que mirarlo antes del contenido
    if (r.stop_reason === "refusal") return { fallo: { code: 422, error: "Claude ha declinado esta petición." } };
    if (r.stop_reason === "max_tokens") return { fallo: { code: 502, error: "La respuesta se ha cortado por ser demasiado larga." } };

    const txt = r.content.filter(b => b.type === "text").map(b => b.text).join("");
    try { return { salida: JSON.parse(txt), modelo: r.model }; }
    catch (_) { return { fallo: { code: 502, error: "Claude no ha devuelto un JSON interpretable." } }; }
  } catch (err) {
    return { fallo: traducir(err) };
  }
}

module.exports = { MODELO, disponible, pedir };
