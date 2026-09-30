-- ════════════════════════════════════════════════════════════
-- EnSu · Takeaways (lo que te llevas de cada libro)
-- Pegar en Supabase → SQL Editor → Run. Solo añade; no toca tus datos.
-- ════════════════════════════════════════════════════════════
begin;

alter table public.entradas
  add column if not exists takeaways       jsonb not null default '[]'::jsonb,  -- [{titulo, texto}]
  add column if not exists takeaway_idea   text  not null default '',           -- la gran idea del libro
  add column if not exists takeaway_frase  text  not null default '',           -- frase de cierre
  add column if not exists takeaway_img    text  not null default '';           -- imagen original

commit;

-- Imágenes de takeaways: cualquiera las ve, solo el autor las sube
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('takeaways', 'takeaways', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "takeaways: subir autor" on storage.objects;
create policy "takeaways: subir autor" on storage.objects for insert
  with check (bucket_id = 'takeaways' and public.es_autor());
drop policy if exists "takeaways: cambiar autor" on storage.objects;
create policy "takeaways: cambiar autor" on storage.objects for update
  using (bucket_id = 'takeaways' and public.es_autor());
drop policy if exists "takeaways: borrar autor" on storage.objects;
create policy "takeaways: borrar autor" on storage.objects for delete
  using (bucket_id = 'takeaways' and public.es_autor());

-- Comprobación
select count(*) filter (where column_name like 'takeaway%') as columnas_nuevas
from information_schema.columns where table_name = 'entradas';
