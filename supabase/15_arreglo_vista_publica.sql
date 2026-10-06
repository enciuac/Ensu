-- ════════════════════════════════════════════════════════════
-- EnSu · ARREGLO URGENTE de la vista pública
-- Pegar en Supabase → SQL Editor → Run. No borra ni cambia ningún dato.
--
-- QUÉ PASÓ
-- La vista de 14_fechas_privadas.sql se creó con `security_invoker = on`, que
-- hace que se ejecute con los permisos de QUIEN PREGUNTA. Como en ese mismo
-- fichero le quitamos a `anon` el permiso de leer la tabla, leer la vista
-- también le da «permission denied»: el visitante se queda sin nada.
-- El autor no lo nota, porque él sigue leyendo la tabla directamente.
--
-- EL ARREGLO
-- La vista pasa a ejecutarse con los permisos de su dueño, que sí puede leer la
-- tabla, y se le mete dentro el MISMO filtro que tenía la política de seguridad
-- (`tipo <> 'privado'`). Así el visitante ve exactamente lo que veía antes, con
-- el año en vez de la fecha, y lo privado sigue sin salir.
-- ════════════════════════════════════════════════════════════

drop view if exists public.entradas_publicas;

create view public.entradas_publicas as
select
  id, tipo, estado, libro, autor, titulo_ref,
  reflexion, cita, vida, tension,
  finalidad, categoria, dificultad, tags,
  progreso, puntuacion, paginas_total, pagina_actual, orden,
  portada, portada_id, entrada_padre,
  takeaways, takeaway_idea, takeaway_frase, takeaway_img,
  ebook_ruta, ebook_nombre, ebook_tipo, ebook_publico,
  -- Solo el año. El día y el mes se quedan dentro.
  extract(year from fecha)::int        as anio,
  extract(year from terminado_en)::int as anio_fin,
  -- Posición en la línea de tiempo: ordena igual que la fecha, sin decirla.
  rank() over (order by fecha nulls first) as orden_fecha
from public.entradas
-- El mismo filtro que la política "entradas: lectura publica" (01_esquema.sql:85):
-- lo privado no aparece aquí, igual que no aparecía antes.
where tipo <> 'privado';

-- Sin `security_invoker`: la vista corre con los permisos de su dueño, así que
-- el visitante puede leerla aunque no pueda leer la tabla. Es justo lo que
-- queremos: que pase por este filtro y por ningún otro sitio.
grant select on public.entradas_publicas to anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- COMPROBACIÓN
-- 1) Esto debe devolver filas, con año y sin fecha:
select id, libro, anio, orden_fecha from public.entradas_publicas order by orden_fecha desc limit 5;

-- 2) Y aquí no debe salir ninguna entrada privada:
select count(*) as privadas_coladas from public.entradas_publicas where tipo = 'privado';

-- 3) La tabla sigue cerrada al visitante (anon no debe tener SELECT):
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'entradas' and grantee = 'anon'
order by privilege_type;

-- ════════════════════════════════════════════════════════════
-- PARA DESHACERLO TODO, si hiciera falta:
--   grant select on public.entradas to anon;
-- Con eso la web vuelve al comportamiento de antes de 14_fechas_privadas.sql.
-- ════════════════════════════════════════════════════════════
