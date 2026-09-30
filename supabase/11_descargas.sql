-- ════════════════════════════════════════════════════════════
-- EnSu · Estantería pública y descargas voluntarias
-- Pegar en Supabase → SQL Editor → Run. Solo añade; no toca tus datos.
--
-- Los archivos siguen en el almacén PRIVADO. Solo cuando tú marcas un libro
-- como descargable se copia al almacén público "descargas". Al desmarcarlo,
-- la copia se borra.
-- ════════════════════════════════════════════════════════════
begin;

alter table public.entradas
  add column if not exists ebook_publico boolean not null default false;

commit;

-- Almacén público: cualquiera puede descargar lo que haya aquí; solo el autor pone y quita
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('descargas', 'descargas', true, 62914560, array['application/epub+zip','application/epub','application/zip','application/pdf','application/octet-stream'])
on conflict (id) do update set public = true, file_size_limit = 62914560,
  allowed_mime_types = array['application/epub+zip','application/epub','application/zip','application/pdf','application/octet-stream'];

do $$
begin
  begin execute $p$create policy "descargas: subir autor" on storage.objects for insert
    with check (bucket_id = 'descargas' and public.es_autor())$p$; exception when duplicate_object then null; end;
  begin execute $p$create policy "descargas: cambiar autor" on storage.objects for update
    using (bucket_id = 'descargas' and public.es_autor())$p$; exception when duplicate_object then null; end;
  begin execute $p$create policy "descargas: borrar autor" on storage.objects for delete
    using (bucket_id = 'descargas' and public.es_autor())$p$; exception when duplicate_object then null; end;
end $$;

-- Comprobación
select id, public from storage.buckets where id in ('ebooks','descargas');
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'descargas:%'
order by policyname;
