-- ════════════════════════════════════════════════════════════
-- EnSu · Reflexiones agrupadas bajo un libro
-- Pegar en Supabase → SQL Editor → Run. Solo añade; no toca tus datos.
-- ════════════════════════════════════════════════════════════
begin;

-- Una entrada puede pertenecer a otra (una reflexión, a su libro).
-- Si el libro se borra, la reflexión se queda, pero sin vínculo.
alter table public.entradas
  add column if not exists entrada_padre bigint references public.entradas(id) on delete set null;

create index if not exists entradas_padre on public.entradas (entrada_padre);

commit;

-- ── Tu nueva reflexión sobre "La sociedad del cansancio" ──
-- Se añade solo si no existe ya. El texto es exactamente el tuyo.
insert into public.entradas (tipo, estado, libro, fecha, titulo_ref, reflexion, finalidad, categoria, dificultad, tags, progreso, entrada_padre)
select 'reflexion', 'terminado', 'La sociedad del cansancio', current_date,
  'Tan ocupados construyendo la vida que perdemos la capacidad de habitarla',
  $refl$Vivimos en una sociedad de rendimiento continuo: siempre debemos mejorar, avanzar y convertirnos en una versión superior de nosotros mismos. Las redes sociales intensifican esta dinámica al exponernos constantemente a vidas idealizadas y nuevas posibilidades. El resultado puede ser una sensación permanente de insuficiencia: nunca somos, tenemos o hacemos bastante.

Esta lógica también puede trasladarse a las relaciones. Cuando creemos que siempre puede aparecer alguien mejor, nos cuesta invertir profundamente en personas imperfectas y construir vínculos estables.

Al mismo tiempo, llenamos el silencio con trabajo, entretenimiento, redes, consumo y estímulos constantes. Podemos vivir en piloto automático, pasando de un objetivo al siguiente, sin detenernos a preguntarnos si aquello que perseguimos realmente tiene sentido para nosotros.

El peligro no es únicamente estar cansados, sino acabar tan ocupados construyendo y optimizando nuestra vida que perdamos la capacidad de habitarla.$refl$,
  'Autoconocimiento', 'Filosofía', 'Accesible',
  array['Rendimiento','Insuficiencia','Redes sociales','Vínculos','Presencia','Sentido']::text[],
  100, 55
where not exists (
  select 1 from public.entradas
  where tipo = 'reflexion' and entrada_padre = 55
    and titulo_ref = 'Tan ocupados construyendo la vida que perdemos la capacidad de habitarla'
);

-- Comprobación: debe aparecer tu reflexión colgando del libro 55
select e.id, e.tipo, e.titulo_ref, p.libro as pertenece_a
from public.entradas e left join public.entradas p on p.id = e.entrada_padre
where e.entrada_padre is not null;
