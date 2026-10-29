// Lo que comparten las funciones que usan IA.
// Los ficheros de api/ que empiezan por "_" no son rutas: solo se importan.
// Aquí no hay secretos; las claves viven en las variables de Vercel.
//
// Primero se le pregunta a Claude. Si no puede —clave ausente, caído, al
// límite, o una respuesta que no se entiende— se le pregunta a Gemini, para que
// un fallo de un proveedor no deje la función inservible. La respuesta dice
// siempre quién contestó.
const claude = require("./_claude");
const gemini = require("./_gemini");

const SUPABASE_URL = "https://wgtolhgtdpxasliaaxaa.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ze4N3Wl2SyqnBmEtRlcO-A_M1drZqmX";
const ORIGENES = ["https://ensu-eight.vercel.app", "http://localhost:8080", "http://127.0.0.1:8080"];

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

const hayIA = () => claude.disponible() || gemini.disponible();

/* Pide una respuesta con la forma del esquema. Claude primero, Gemini de
   suplente. Devuelve {salida, proveedor, modelo} o {fallo:{code,error}}.
   La petición se describe igual para los dos: texto, imagen opcional y esquema. */
async function pedirJson(peticion) {
  const intentos = [];

  if (claude.disponible()) {
    const r = await claude.pedir(peticion);
    if (r.salida) return { ...r, proveedor: "claude" };
    intentos.push({ quien: "Claude", ...r.fallo });
    // Un 400 es culpa nuestra (la petición está mal armada): con Gemini fallaría
    // igual, así que no se gasta una segunda llamada en vano.
    if (r.fallo.code === 400) return { fallo: r.fallo };
    console.warn(`EnSu IA · Claude falló (${r.fallo.code}): ${r.fallo.error} — se prueba con Gemini`);
  } else {
    intentos.push({ quien: "Claude", code: 500, error: "sin clave" });
  }

  if (gemini.disponible()) {
    const r = await gemini.pedir(peticion);
    if (r.salida) return { ...r, proveedor: "gemini" };
    intentos.push({ quien: "Gemini", ...r.fallo });
  } else {
    intentos.push({ quien: "Gemini", code: 500, error: "sin clave" });
  }

  // Han fallado los dos: se cuenta el porqué de cada uno, que para eso están
  const sinClaves = intentos.every(i => i.error === "sin clave");
  if (sinClaves) return { fallo: { code: 500, error: "No hay ninguna IA configurada. Añade ANTHROPIC_API_KEY en Vercel." } };
  const principal = intentos.find(i => i.quien === "Claude" && i.error !== "sin clave");
  return {
    fallo: {
      code: (principal && principal.code) || 502,
      error: intentos.filter(i => i.error !== "sin clave").map(i => `${i.quien}: ${i.error}`).join(" · ")
    }
  };
}

module.exports = {
  SUPABASE_URL, SUPABASE_KEY, ORIGENES,
  json, preflight, comprobarAutor,
  pedirJson, hayIA,
  MODELO_CLAUDE: claude.MODELO
};
