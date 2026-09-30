-- ════════════════════════════════════════════════════════════
-- EnSu · Aceptar todas las variantes de EPUB
-- Solo hace falta si al subir un libro Supabase se queja del tipo de archivo.
-- Pegar en Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════
update storage.buckets
set allowed_mime_types = array[
      'application/epub+zip',   -- el tipo correcto
      'application/epub',       -- el que declara Windows
      'application/x-epub',
      'application/zip',
      'application/pdf',
      'application/octet-stream'
    ]
where id = 'ebooks';

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'ebooks';
