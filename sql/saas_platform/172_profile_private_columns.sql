-- 172 (Main 158): Lock the private profile columns (apply AFTER the app code that
-- uses get_profiles_private() is live -- older app code selects these
-- columns directly and would get "permission denied").
-- address, birth_country, birth_city, legal_name and signature_data are
-- no longer readable through the API; see 157 for who can read them.
-- NOTE: SELECT on profiles is now granted per column. A column added to
-- profiles later must be granted to anon/authenticated explicitly, or
-- the app cannot read it.

do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name not in ('address', 'birth_country', 'birth_city', 'legal_name', 'signature_data');
  execute 'revoke select on public.profiles from anon, authenticated';
  execute format('grant select (%s) on public.profiles to anon, authenticated', cols);
end $$;
