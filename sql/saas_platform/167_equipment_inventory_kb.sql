-- Knowledge-base rows for equipment & inventory (sql/saas_platform/166).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Department equipment', 'Every department has an Equipment tab listing its items, where they are stored and their condition. Department admins add and edit items (quantity, serial number, value, purchase date, warranty, next maintenance), lend them (to themselves or to any name, with a return date), check them back in, and keep a maintenance log (check, repair, cleaning…). Overdue loans show in red; maintenance due in the next two weeks shows in orange.', 'Chaque département a un onglet Équipement qui liste ses articles, leur lieu de rangement et leur état. Les administrateurs du département ajoutent et modifient les articles (quantité, numéro de série, valeur, date d''achat, garantie, prochain entretien), les prêtent (à eux-mêmes ou à n''importe quel nom, avec une date de retour), les reprennent et tiennent un journal d''entretien (vérification, réparation, nettoyage…). Les prêts en retard s''affichent en rouge ; l''entretien prévu dans les deux semaines en orange.', 'department_admin'),
('Church inventory', 'Inventory (sidebar, pastoral team) shows every department''s equipment in one list with totals: number of items, total value, overdue loans, items to repair or missing, and maintenance due. Filter by department, category or "Needs attention", search by name or serial number, and download the list as CSV (for insurance, for example).', 'Inventaire (barre latérale, équipe pastorale) montre l''équipement de tous les départements dans une seule liste avec des totaux : nombre d''articles, valeur totale, prêts en retard, articles à réparer ou manquants, et entretien à faire. Filtrez par département, catégorie ou « À surveiller », cherchez par nom ou numéro de série, et téléchargez la liste en CSV (pour l''assurance, par exemple).', 'pastoral')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
