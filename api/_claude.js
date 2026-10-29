// Lo que comparten las funciones que hablan con Claude.
// Los ficheros de api/ que empiezan por "_" no son rutas: solo se importan.
// Aquí no hay secretos; la clave (ANTHROPIC_API_KEY) vive en las variables de Vercel.
const Mod = require("@anthropic-ai/sdk");
const Anthropic = Mod.default || Mod;

const SUPABASE_URL = "https://wgtolhgtdpxasliaaxaa.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ze4N3Wl2SyqnBmEtRlcO-A_M1drZqmX";
const ORIGENES = ["https://ensu-eight.vercel.app", "http://localhost:8080", "http://127.0.0.1:8080"];

// Un solo modelo, escrito a las claras. Ya no hace falta descubrir cuál existe
// como con Gemini: aquí el identificador es estable.
const MODELO = process.env.CLAUDE_MODEL || "claude-opus-5-5";

let clienteCache = null;
const cliente = () => (clienteCache = clienteCache || new Anthropic());

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
// Devuelve null si todo va bien, o el motivo del rechazo.
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

// Traduce los fallos de la API a algo que se pueda leer en pantalla.
function traducir(err) {
  if (err instanceof Anthropic.AuthenticationError)
    return { code: 500, error: "La clave de Claude no es válida. Revísala en Vercel (ANTHROPIC_API_KEY)." };
  if (err instanceof Anthropic.PermissionDeniedError)
    return { code: 500, error: "La clave de Claude no tiene permiso para este modelo." };
  if (err instanceof Anthropic.RateLimitError)
    return { code: 429, error: "Claude está al límite ahora mismo. Inténtalo en unos minutos." };
  if (err instanceof Anthropic.BadRequestError)
    return { code: 400, error: `Claude ha rechazado la petición: ${err.message}` };
  if (err instanceof Anthropic.APIConnectionError)
    return { code: 502, error: "No se pudo contactar con Claude." };
  if (err instanceof Anthropic.APIError)
    return { code: 502, error: `Claude ha fallado (${err.status}).` };
  return { code: 500, error: "Error inesperado al hablar con Claude." };
}

/* Pide a Claude una respuesta que encaje en un esquema. El propio modelo se
   encarga de que el JSON sea válido (output_config.format), así que no hay que
   andar rescatando texto entre comillas como con el modelo anterior.
   Devuelve {salida, modelo} o {fallo:{code,error}}. */
async function pedirJson({ contenido, sistema, esquema, maxTokens = 16000, esfuerzo = "medium" }) {
  try {
    const respuesta = await cliente().messages.create({
      model: MODELO,
      max_tokens: maxTokens,
      output_config: {
        effort: esfuerzo,                                  // en Opus 5.5 el valor por defecto es medium: se deja escrito
        format: { type: "json_schema", schema: esquema }
      },
      ...(sistema ? { system: sistema } : {}),
      messages: [{ role: "user", content: contenido }]
    });

    // Los clasificadores de seguridad pueden declinar: hay que mirarlo antes del contenido
    if (respuesta.stop_reason === "refusal")
      return { fallo: { code: 422, error: "Claude ha declinado esta petición." } };
    if (respuesta.stop_reason === "max_tokens")
      return { fallo: { code: 502, error: "La respuesta se ha cortado por ser demasiado larga." } };

    const texto = respuesta.content.filter(b => b.type === "text").map(b => b.text).join("");
    try {
      return { salida: JSON.parse(texto), modelo: respuesta.model };
    } catch (_) {
      return { fallo: { code: 502, error: "Claude no ha devuelto un JSON interpretable." } };
    }
  } catch (err) {
    return { fallo: traducir(err) };
  }
}

module.exports = { SUPABASE_URL, SUPABASE_KEY, ORIGENES, MODELO, json, preflight, comprobarAutor, pedirJson };
