-- ════════════════════════════════════════════════════════════
-- EnSu · Que el día y el mes no salgan de casa
-- Pegar en Supabase → SQL Editor → Run. No borra ni cambia ningún dato.
--
-- EL PROBLEMA
-- Ocultar la fecha al visitante era solo de cara a la pantalla: la web pedía
-- `entradas?select=*` y en esa respuesta viajaban `fecha` y `terminado_en`
-- completas. Cualquiera que mirase la pestaña de red del navegador —o hiciera
-- un curl con la clave pública, que está en el código— las veía enteras.
--
-- LA SOLUCIÓN
-- Una vista para quien no ha iniciado sesión, que enseña solo el AÑO. Para no
-- perder el orden de la cronología, se añade la POSICIÓN de cada entrada en la
-- línea de tiempo (un número de orden), que ordena igual pero no dice ninguna
-- fecha. Tú, como autor, sigues leyendo la tabla completa como siempre.
--
-- SE PUEDE EJECUTAR EN CUALQUIER MOMENTO: la web funciona igual antes y después.
-- Si la vista no existe todavía, se sigue usando la tabla como hasta ahora.
-- ════════════════════════════════════════════════════════════

-- 1) La vista. security_invoker = on hace que respete la RLS de quien pregunta,
--    así que un visitante sigue viendo solo lo que ya podía ver.
drop view if exists public.entradas_publicas;
create view public.entradas_publicas
with (security_invoker = on) as
select
  id, tipo, estado, libro, autor, titulo_ref,
  reflexion, cita, vida, tension,
  finalidad, categoria, dificultad, tags,
  progreso, puntuacion, paginas_total, pagina_actual, orden,
  portada, portada_id, entrada_padre,
  takeaways, takeaway_idea, takeaway_frase, takeaway_img,
  ebook_ruta, ebook_nombre, ebook_tipo, ebook_publico,
  -- Solo el año. El día y el mes se quedan dentro.
  extract(year from fecha)::int       as anio,
  extract(year from terminado_en)::int as anio_fin,
  -- Posición en la línea de tiempo: ordena igual que la fecha, sin decirla.
  rank() over (order by fecha nulls first) as orden_fecha
from public.entradas;
-- Nota: ebook_cfi queda fuera a propósito. Es por dónde vas leyendo,
-- y eso tampoco tiene por qué saberlo nadie más.

grant select on public.entradas_publicas to anon, authenticated;

-- 2) Y se le cierra al visitante la puerta de la tabla, que es la que filtraba.
--    El autor (authenticated) la conserva entera.
revoke select on public.entradas from anon;

commit;

-- ════════════════════════════════════════════════════════════
-- COMPROBACIÓN
-- Lo de abajo debe devolver el año pero NUNCA el día ni el mes.
select id, libro, anio, orden_fecha from public.entradas_publicas order by orden_fecha desc limit 5;

-- Y esto debe decir que anon ya no puede leer la tabla directamente:
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'entradas' and grantee in ('anon','authenticated')
order by grantee;

-- ════════════════════════════════════════════════════════════
-- PARA DESHACERLO, si algo no cuadra:
--   grant select on public.entradas to anon;
-- Con eso la web vuelve sola al comportamiento de antes.
-- ════════════════════════════════════════════════════════════
