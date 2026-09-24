-- ════════════════════════════════════════════════════════════
-- EnSu · La sociedad del cansancio: tus anotaciones pasan a "Mi análisis"
-- y "Resumen" pasa a tener un resumen del libro.
-- Pegar en Supabase → SQL Editor → Run.
-- Solo actúa si "Mi análisis" (tension) está vacío: no pisa nada tuyo.
-- ════════════════════════════════════════════════════════════
begin;

update public.entradas
set tension   = reflexion,
    reflexion = $resumen$Han sostiene que hemos pasado de la sociedad disciplinaria que describió Foucault, la de las prohibiciones y el «no debes», a una sociedad del rendimiento gobernada por el «puedes». Ya no nos oprime un amo externo: el sujeto de rendimiento se explota a sí mismo creyendo que es libre, y es a la vez verdugo y víctima. La libertad se convierte en una nueva forma de coacción.

Por eso las enfermedades de nuestra época ya no son infecciosas, provocadas por algo ajeno que atacar, sino neuronales: depresión, síndrome de desgaste profesional, trastornos de atención. No nacen de un exceso de negatividad, sino de un exceso de positividad: demasiados estímulos, demasiadas posibilidades, demasiado rendimiento. El deprimido es quien ya no puede poder más.

El libro critica también la hiperactividad y la multitarea, que nos devuelven a una atención dispersa y nos roban el aburrimiento profundo, la contemplación y la capacidad de no hacer. Frente al cansancio que aísla y agota, Han rescata, con Peter Handke, otro cansancio: uno que se detiene, deja de producir y vuelve a abrirse al mundo y a los demás.$resumen$
where id = 55
  and coalesce(trim(tension), '') = ''
  and reflexion <> '';

commit;

-- Comprobación: "mi_analisis" debe tener tus anotaciones y "resumen" el nuevo texto
select libro, left(reflexion, 70) as resumen, left(tension, 70) as mi_analisis, left(vida, 70) as como_lo_aplico
from public.entradas where id = 55;
