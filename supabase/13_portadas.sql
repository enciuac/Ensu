-- ════════════════════════════════════════════════════════════
-- EnSu · Portadas en tu propio almacén
-- Pegar en Supabase → SQL Editor → Run. Solo añade; no toca tus datos.
--
-- El almacén "portadas" ya existía (lo usa el botón «Subir foto» de la ficha).
-- Esto solo se asegura de que siga siendo público y de que los permisos de
-- autor estén puestos, porque ahora también escribe ahí la función del
-- servidor que se trae las portadas de fuera.
--
-- Por qué: algunas portadas apuntaban a Amazon, a Google Imágenes o a webs de
-- terceros. Si esas direcciones cambian, la portada desaparece — ya pasó con
-- «La sociedad del cansancio». Con esto las imágenes viven contigo.
-- Se admiten los formatos de imagen habituales (antes solo entraban JPEG desde
-- la web); el límite de tamaño que tuvieras puesto no se toca.
-- ════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, allowed_mime_types)
values ('portadas', 'portadas', true,
        array['image/jpeg','image/png','image/webp','image/gif','image/avif'])
on conflict (id) do update set public = true,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/avif'];

do $$
begin
  begin execute $p$create policy "portadas: subir autor" on storage.objects for insert
    with check (bucket_id = 'portadas' and public.es_autor())$p$; exception when duplicate_object then null; end;
  begin execute $p$create policy "portadas: cambiar autor" on storage.objects for update
    using (bucket_id = 'portadas' and public.es_autor())$p$; exception when duplicate_object then null; end;
  begin execute $p$create policy "portadas: borrar autor" on storage.objects for delete
    using (bucket_id = 'portadas' and public.es_autor())$p$; exception when duplicate_object then null; end;
end $$;

-- Comprobación: debe decir public = true
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'portadas';
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'portadas:%'
order by policyname;
