-- Storage setup for trade screenshots.
-- Run this once in the Supabase SQL editor. Safe to re-run.
--
-- ── This used to be a public bucket. It should not have been. ──────────────
-- The original setup made the bucket public and allowed `select` on its
-- objects with no role restriction, on the reasoning that chart screenshots
-- are "non-sensitive images".
--
-- They aren't. A chart screenshot usually has the MT5 terminal in frame, which
-- means the account balance, the equity, and the open positions. And the
-- unrestricted policy applied to `anon` as well as `authenticated`, so anyone
-- holding the anon key — which is published in the app's JavaScript bundle by
-- design — could LIST the bucket and download every user's screenshots. No
-- guessing of filenames required.
--
-- For a single-user journal that was harmless. With more than one account in
-- the database it is a data breach, so the bucket is now private and readable
-- only by the user who uploaded it.

insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do update set public = false;

-- Files are stored at <user-id>/<name>, so the first path segment is the
-- owner and every policy keys off it.

drop policy if exists "screenshots public read" on storage.objects;
drop policy if exists "screenshots owner read" on storage.objects;
drop policy if exists "screenshots user upload" on storage.objects;
drop policy if exists "screenshots user delete" on storage.objects;

-- Read your own, and only signed in. The app requests a short-lived signed URL
-- when it needs to display one.
create policy "screenshots owner read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "screenshots user upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "screenshots user delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Note on existing screenshots ───────────────────────────────────────────
-- Any `screenshot_url` already saved as a public URL stops resolving the
-- moment the bucket goes private. The app handles both: a stored value that
-- looks like a path is signed on demand, and a legacy full URL is used as-is
-- (and will now 404, which is the correct outcome — that link was readable by
-- anyone). Re-upload those few images if you want them back.
