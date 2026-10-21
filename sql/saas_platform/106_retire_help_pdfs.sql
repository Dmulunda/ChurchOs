-- In-App AI Assistant, Part 3: retire the old PDF-upload Help system
-- (sql/..._help_documents.sql originally, js/components/helpModal.js),
-- fully superseded by the chat assistant from Part 1/2. All uploaded
-- PDFs were downloaded and confirmed backed up locally before this
-- ran (both this tenant's and the platform-wide shared defaults).

-- The help-docs storage bucket itself is emptied/removed separately
-- via the Storage API (`supabase storage rm`) -- direct SQL deletes
-- against storage.objects/storage.buckets are rejected by Supabase.
begin;

drop table if exists public.help_documents;

commit;

select pg_notify('pgrst', 'reload schema');
