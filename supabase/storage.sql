-- Storage setup for trade screenshots.
-- Run this once in the Supabase SQL editor.

-- Public bucket so screenshot URLs render directly in the app.
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict (id) do update set public = true;

-- Anyone can read screenshots (they are non-sensitive chart images).
drop policy if exists "screenshots public read" on storage.objects;
create policy "screenshots public read" on storage.objects
  for select using (bucket_id = 'screenshots');

-- Signed-in users can upload only into their own folder (userId/...).
drop policy if exists "screenshots user upload" on storage.objects;
create policy "screenshots user upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Signed-in users can delete their own screenshots.
drop policy if exists "screenshots user delete" on storage.objects;
create policy "screenshots user delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
