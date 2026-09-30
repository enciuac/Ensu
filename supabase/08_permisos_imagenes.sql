-- ════════════════════════════════════════════════════════════
-- EnSu · Permisos para subir imágenes (portadas y takeaways)
-- Pegar en Supabase → SQL Editor → Run.
-- Primero muestra qué permisos hay; luego los crea si faltan.
-- ════════════════════════════════════════════════════════════

-- 1) ¿Qué hay ahora? (antes)
select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- 2) Crear los que falten
do $$
begin
  -- portadas
  begin
    execute $p$create policy "portadas: subir autor" on storage.objects for insert
      with check (bucket_id = 'portadas' and public.es_autor())$p$;
  exception when duplicate_object then null; end;
  begin
    execute $p$create policy "portadas: cambiar autor" on storage.objects for update
      using (bucket_id = 'portadas' and public.es_autor())$p$;
  exception when duplicate_object then null; end;
  begin
    execute $p$create policy "portadas: borrar autor" on storage.objects for delete
      using (bucket_id = 'portadas' and public.es_autor())$p$;
  exception when duplicate_object then null; end;
  -- takeaways
  begin
    execute $p$create policy "takeaways: subir autor" on storage.objects for insert
      with check (bucket_id = 'takeaways' and public.es_autor())$p$;
  exception when duplicate_object then null; end;
  begin
    execute $p$create policy "takeaways: cambiar autor" on storage.objects for update
      using (bucket_id = 'takeaways' and public.es_autor())$p$;
  exception when duplicate_object then null; end;
  begin
    execute $p$create policy "takeaways: borrar autor" on storage.objects for delete
      using (bucket_id = 'takeaways' and public.es_autor())$p$;
  exception when duplicate_object then null; end;
end $$;

-- 3) Comprobación (después): deben aparecer las seis
select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (policyname like 'portadas:%' or policyname like 'takeaways:%')
order by policyname;

-- 4) Y que los dos buckets existan y sean públicos
select id, public from storage.buckets where id in ('portadas','takeaways');
