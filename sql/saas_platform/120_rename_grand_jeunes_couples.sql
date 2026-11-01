-- Renames the grand_jeunes_couples department's display name from
-- "Grand Jeune and Couple" / "Grands Jeunes et Couples" to
-- "Youth and Couple" / "Jeune et couple" -- the key itself is unchanged,
-- this is a label-only change (js/i18n.js carries the EN/FR split; this
-- migration just brings the DB's own fallback `name` column, which a
-- handful of components read directly instead of through departmentLabel()
-- -- see 12_all_default_departments.sql's header comment -- in line with
-- it for every tenant that already has this department seeded).
begin;

update public.departments
  set name = 'Youth and Couple'
  where key = 'grand_jeunes_couples' and name = 'Grand Jeune and Couple';

commit;
