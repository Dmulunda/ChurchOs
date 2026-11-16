-- Knowledge-base rows for the discipleship path (sql/saas_platform/154).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Discipleship path', 'Discipleship (sidebar) shows "My journey": the church''s growth steps (for example first visit, baptism, membership class, small group, serving) and the ones you have completed, with the date. The pastoral team records the steps; ask a pastor if one is missing.', 'Discipulat (barre latérale) affiche « Mon parcours » : les étapes de croissance de l''église (par exemple première visite, baptême, classe des nouveaux membres, petit groupe, service) et celles que vous avez franchies, avec la date. L''équipe pastorale enregistre les étapes ; demandez à un pasteur s''il en manque une.', 'everyone'),
('Managing the discipleship path', 'The pastoral team opens Discipleship to see how many people have reached each step, and who has stalled (completed a step more than 90 days ago without reaching the next one). Choose a person from the member database to tick the steps they completed and set the date. "Edit steps" renames, reorders, adds or archives steps (English and French titles).', 'L''équipe pastorale ouvre Discipulat pour voir combien de personnes ont atteint chaque étape, et qui stagne (a franchi une étape il y a plus de 90 jours sans atteindre la suivante). Choisissez une personne de la base des membres pour cocher les étapes franchies et en fixer la date. « Modifier les étapes » permet de renommer, réordonner, ajouter ou archiver des étapes (titres en anglais et en français).', 'pastoral')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
