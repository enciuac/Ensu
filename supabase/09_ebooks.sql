-- ════════════════════════════════════════════════════════════
-- EnSu · Leer los libros dentro de la web (EPUB y PDF)
-- Pegar en Supabase → SQL Editor → Run. Solo añade; no toca tus datos.
--
-- IMPORTANTE: este almacén es PRIVADO. Los archivos solo se pueden abrir
-- con tu sesión; no quedan accesibles desde internet.
-- ════════════════════════════════════════════════════════════
begin;

alter table public.entradas
  add column if not exists ebook_ruta   text not null default '',   -- archivo en el almacén privado
  add column if not exists ebook_nombre text not null default '',   -- nombre original
  add column if not exists ebook_tipo   text not null default '',   -- epub o pdf
  add column if not exists ebook_cfi    text not null default '';   -- por dónde ibas

commit;

-- Almacén privado de libros (60 MB por archivo)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ebooks', 'ebooks', false, 62914560, array['application/epub+zip','application/pdf','application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = 62914560,
  allowed_mime_types = array['application/epub+zip','application/pdf','application/octet-stream'];

-- Solo el autor: ni leer, ni subir, ni borrar para nadie más
do $$
declare p text;
begin
  foreach p in array array['leer','subir','cambiar','borrar'] loop
    begin execute format('drop policy if exists "ebooks: %s autor" on storage.objects', p); exception when others then null; end;
  end loop;
  execute $p$create policy "ebooks: leer autor" on storage.objects for select
    using (bucket_id = 'ebooks' and public.es_autor())$p$;
  execute $p$create policy "ebooks: subir autor" on storage.objects for insert
    with check (bucket_id = 'ebooks' and public.es_autor())$p$;
  execute $p$create policy "ebooks: cambiar autor" on storage.objects for update
    using (bucket_id = 'ebooks' and public.es_autor())$p$;
  execute $p$create policy "ebooks: borrar autor" on storage.objects for delete
    using (bucket_id = 'ebooks' and public.es_autor())$p$;
end $$;

-- Comprobación: el bucket debe salir con public = false y cuatro permisos
select id, public, file_size_limit from storage.buckets where id = 'ebooks';
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'ebooks:%'
order by policyname;
