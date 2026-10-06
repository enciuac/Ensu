// Tarea diaria de Vercel (ver vercel.json): hace una lectura mínima en Supabase
// para que el proyecto gratuito no se pause por inactividad.
// Usa la misma URL y clave pública que la web (no hay secretos aquí).
const SUPABASE_URL = "https://wgtolhgtdpxasliaaxaa.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ze4N3Wl2SyqnBmEtRlcO-A_M1drZqmX";

module.exports = async (req, res) => {
  try {
    // Por la vista pública, que es lo que puede leer esta clave. Si todavía no
    // existe, se pregunta por la tabla como antes.
    const pedir = recurso => fetch(`${SUPABASE_URL}/rest/v1/${recurso}?select=id&limit=1`, {
      headers: { apikey: SUPABASE_KEY }
    });
    let r = await pedir("entradas_publicas");
    if (!r.ok) r = await pedir("entradas");
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
};
