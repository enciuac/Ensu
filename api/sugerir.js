// Rellena la ficha de un libro nuevo: páginas, finalidad, categoría, dificultad,
// etiquetas y el resumen/teoría. Lo hace con los criterios del propio lector, así
// que se le pasa a Gemini cómo ha clasificado él los libros que ya tiene.
//
// Solo viaja lo que ya es público en la web (título, autor, categoría, finalidad,
// dificultad, páginas y etiquetas). Nunca las notas privadas, ni las reflexiones,
// ni las citas, ni lo de "cómo lo aplico".
const { ORIGENES, json, preflight, comprobarAutor, pedirJson } = require("./_gemini");

const limpiar = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
const lista = (a, n) => (Array.isArray(a) ? a : []).map(x => limpiar(x, 60)).filter(Boolean).slice(0, n);

const instrucciones = (d) => {
  const p = d.perfil || {};
  const ejemplos = (p.ejemplos || []).slice(0, 30).map(e =>
    `- «${limpiar(e.libro, 90)}»${e.autor ? ` de ${limpiar(e.autor, 60)}` : ""} · ${e.categoria || "—"} · ${e.finalidad || "—"} · ${e.dificultad || "—"} · ${e.paginas || "?"} pág. · ${(e.tags || []).join(", ") || "sin etiquetas"}`
  ).join("\n");
  return `Eres un bibliotecario que conoce bien a este lector. Va a registrar un libro en su diario de lectura y hay que rellenarle la ficha CON SUS CRITERIOS, no con los tuyos.

LIBRO: «${limpiar(d.libro, 140)}»
AUTOR: ${limpiar(d.autor, 90) || "sin indicar"}
PÁGINAS SEGÚN OPEN LIBRARY: ${d.paginas > 0 ? d.paginas : "no las sabe"}

LISTAS CERRADAS (copia el valor exactamente como está escrito; si dudas, deja ""):
finalidad: ${(p.finalidades || []).join(" | ")}
categoria: ${(p.categorias || []).join(" | ")}
dificultad: ${(p.dificultades || []).join(" | ")}

ASÍ CLASIFICA ÉL SUS LIBROS:
${ejemplos || "(todavía no tiene suficientes)"}

ETIQUETAS QUE YA USA (entre paréntesis, cuántas veces):
${(p.etiquetas || []).join(", ") || "(ninguna todavía)"}

Devuelve ÚNICAMENTE este JSON, sin texto alrededor:
{"paginasTotal":0,"finalidad":"","categoria":"","dificultad":"","tags":[],"resumen":"","nota":""}

Reglas:
- paginasTotal: si Open Library da un número, úsalo tal cual. Si no, el de una edición en español al uso. Si no estás razonablemente seguro, pon 0.
- dificultad: calíbrala con sus ejemplos, no en abstracto. Fíjate en qué llama él "Accesible" y qué llama "Densa".
- tags: entre 3 y 6, en español, prefiriendo las que ya usa y escritas exactamente igual. Solo inventa una si de verdad hace falta.
- resumen: de qué trata el libro y qué sostiene, en 3 o 4 párrafos separados por UNA LÍNEA EN BLANCO. Un párrafo puede empezar con una línea corta de tres o cuatro palabras sin punto final, que hará de subtítulo. Escribe en español de España, en tercera persona y sobre el libro. NADA de primera persona, de opiniones personales ni de "me hizo pensar": esa parte la escribe él. Nada de fórmulas de contraportada tipo "el autor nos invita a". Sin markdown, sin asteriscos, sin viñetas.
- nota: una frase corta explicando por qué esa categoría y esa dificultad.
- Si NO conoces este libro con seguridad, devuelve todo vacío o a 0 y explícalo en "nota". Dejarlo en blanco es mucho mejor que inventárselo.`;
};

module.exports = async (req, res) => {
  const origen = ORIGENES.includes(req.headers.origin) ? req.headers.origin : "";
  if (preflight(req, res, origen)) return;
  if (req.method !== "POST") return json(res, 405, { error: "Método no permitido" }, origen);
  if (!process.env.GEMINI_API_KEY) return json(res, 500, { error: "Falta la clave GEMINI_API_KEY en Vercel." }, origen);

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const fallo = await comprobarAutor(token);
  if (fallo) return json(res, fallo.code, { error: fallo.error }, origen);

  const d = req.body || {};
  if (!limpiar(d.libro, 140)) return json(res, 400, { error: "Escribe el título del libro." }, origen);
  d.paginas = Number(d.paginas) || 0;

  try {
    const { salida, modelo, fallo: malo } = await pedirJson({
      contents: [{ parts: [{ text: instrucciones(d) }] }],
      generationConfig: { temperature: 0.3, responseMimeType: "application/json" }
    });
    if (malo) return json(res, malo.code, { error: malo.error }, origen);

    // Nos quedamos solo con lo que encaja en sus listas: nada de categorías inventadas
    const p = d.perfil || {};
    const dentro = (v, opciones) => {
      const n = limpiar(v, 60);
      return (opciones || []).find(o => o.toLowerCase() === n.toLowerCase()) || "";
    };
    const paginas = Math.max(0, Math.min(9999, Math.round(Number(salida.paginasTotal) || 0)));
    return json(res, 200, {
      modelo,
      paginasTotal: d.paginas > 0 ? d.paginas : paginas,
      origenPaginas: d.paginas > 0 ? "openlibrary" : (paginas ? "ia" : ""),
      finalidad: dentro(salida.finalidad, p.finalidades),
      categoria: dentro(salida.categoria, p.categorias),
      dificultad: dentro(salida.dificultad, p.dificultades),
      tags: lista(salida.tags, 6),
      resumen: String(salida.resumen || "").replace(/\r\n/g, "\n").replace(/[*_`#]/g, "").trim().slice(0, 4000),
      nota: limpiar(salida.nota, 240)
    }, origen);
  } catch (err) {
    return json(res, 500, { error: "Error inesperado al completar la ficha." }, origen);
  }
};
