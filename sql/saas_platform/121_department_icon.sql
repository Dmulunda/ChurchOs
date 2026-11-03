-- Lets an admin set a custom emoji icon on a department they create via
-- createDepartmentModal.js, instead of every custom department falling
-- back to the generic building emoji in js/i18n.js's departmentIcon().
-- Free text (not an enum) since it's just whatever single emoji the
-- admin types/pastes in -- no validation beyond what the client form does.
alter table public.departments add column if not exists icon text;
