-- Priestor na export hál zo starého ticketingu. Súbory sem nahráva Patrik ručne
-- cez Supabase Studio, import z nich potom robí server.
--
-- Na rozdiel od `event-images` je bucket SÚKROMNÝ: sú to prevádzkové dáta
-- organizátorov (rozloženia sál, prípadne aj ich zákazníci), nie nič, čo má
-- visieť na verejnej URL. Žiadnu policy na storage.objects preto nedostáva —
-- číta a zapisuje výhradne service-role kľúč (Studio a server funkcie).
--
-- Bez `allowed_mime_types` zámerne: netušíme, čo starý systém vyexportuje
-- (JSON, XML, CSV, XLSX, ZIP, dump…) a zoznam typov by nahratie len zablokoval.
insert into storage.buckets (id, name, public, file_size_limit)
values ('hall-imports', 'hall-imports', false, 52428800)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;
