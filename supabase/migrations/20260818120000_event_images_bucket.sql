-- Obrázky podujatí. Doteraz sa dal zadať len odkaz na cudzí web, takže obrázok
-- zmizol, keď ho zdroj zmazal — a organizátor musel mať kam súbor najprv nahrať.
--
-- Bucket je verejný na čítanie: obrázok podujatia visí na verejnom katalógu,
-- v e-mailoch aj v PDF, kde sa podpísaná URL nedá udržať platná.
-- Zapisuje výhradne server cez service-role kľúč (`uploadEventImage`), preto
-- storage.objects nedostáva žiadnu policy na insert/update/delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-images',
  'event-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Verejné čítanie. Bez tejto policy vracia storage 400 aj pri public bucket-e,
-- keď je požiadavka anonymná.
drop policy if exists "event_images_public_read" on storage.objects;
create policy "event_images_public_read"
  on storage.objects for select
  using (bucket_id = 'event-images');
