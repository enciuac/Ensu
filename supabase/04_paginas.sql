-- EnSu · Total de páginas de cada libro
-- Pegar en Supabase → SQL Editor → Run. Solo rellena libros SIN páginas (no pisa las que ya pusiste).
-- Fuente: Open Library (edición en español) y tiendas/editoriales para los dudosos. Puedes corregir cualquiera desde Editar.
begin;
update public.entradas set paginas_total = 280 where id = 1 and paginas_total is null; -- Encontrar un hogar
update public.entradas set paginas_total = 160 where id = 6 and paginas_total is null; -- El hombre en busca del sentido
update public.entradas set paginas_total = 416 where id = 7 and paginas_total is null; -- La bailarina de Auschwitz
update public.entradas set paginas_total = 526 where id = 8 and paginas_total is null; -- Las 48 leyes del poder
update public.entradas set paginas_total = 328 where id = 9 and paginas_total is null; -- Hábitos atómicos
update public.entradas set paginas_total = 240 where id = 10 and paginas_total is null; -- Si lo crees, lo creas
update public.entradas set paginas_total = 272 where id = 11 and paginas_total is null; -- Burlar al diablo
update public.entradas set paginas_total = 352 where id = 12 and paginas_total is null; -- Rompe la barrera del no
update public.entradas set paginas_total = 364 where id = 13 and paginas_total is null; -- No me puedes lastimar
update public.entradas set paginas_total = 191 where id = 14 and paginas_total is null; -- Fahrenheit 451
update public.entradas set paginas_total = 260 where id = 15 and paginas_total is null; -- 1984
update public.entradas set paginas_total = 128 where id = 16 and paginas_total is null; -- El extranjero
update public.entradas set paginas_total = 234 where id = 17 and paginas_total is null; -- Invicto
update public.entradas set paginas_total = 216 where id = 18 and paginas_total is null; -- El monje que vendió su Ferrari
update public.entradas set paginas_total = 64 where id = 19 and paginas_total is null; -- El arte de la guerra
update public.entradas set paginas_total = 186 where id = 20 and paginas_total is null; -- La vaca púrpura
update public.entradas set paginas_total = 156 where id = 21 and paginas_total is null; -- Psicología oscura
update public.entradas set paginas_total = 164 where id = 22 and paginas_total is null; -- Técnicas secretas de manipulación
update public.entradas set paginas_total = 512 where id = 23 and paginas_total is null; -- El arte de la seducción
update public.entradas set paginas_total = 512 where id = 24 and paginas_total is null; -- 12 Reglas para vivir
update public.entradas set paginas_total = 135 where id = 25 and paginas_total is null; -- Siddhartha
update public.entradas set paginas_total = 149 where id = 26 and paginas_total is null; -- El túnel
update public.entradas set paginas_total = 68 where id = 27 and paginas_total is null; -- La muerte de Iván Ilich
update public.entradas set paginas_total = 408 where id = 28 and paginas_total is null; -- El marciano
update public.entradas set paginas_total = 240 where id = 50 and paginas_total is null; -- El sutil arte de que todo te importe una mierda
update public.entradas set paginas_total = 208 where id = 51 and paginas_total is null; -- Ikigai
update public.entradas set paginas_total = 288 where id = 52 and paginas_total is null; -- El arte de pensar
update public.entradas set paginas_total = 192 where id = 54 and paginas_total is null; -- Manual de vida
update public.entradas set paginas_total = 120 where id = 55 and paginas_total is null; -- La sociedad del cansancio
-- La sociedad del cansancio: 71 % de 120 páginas = página 85
update public.entradas set pagina_actual = round(progreso / 100.0 * paginas_total) where id = 55 and pagina_actual is null and paginas_total is not null;
commit;

select count(*) filter (where paginas_total is not null) as libros_con_paginas, count(*) as libros, sum(paginas_total) filter (where estado = 'terminado') as paginas_leidas from public.entradas where tipo = 'libro';
