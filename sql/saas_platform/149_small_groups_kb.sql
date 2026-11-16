-- Knowledge-base rows for small groups (sql/saas_platform/148).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Small groups', 'Small Groups (sidebar) lists the church''s home/cell groups with their leader, meeting day, time and place. Members see their own group, its members and past meetings. A group leader adds or removes members and, after each meeting, uses "Log a meeting" to tick who came, add the number of guests and write a short report for the pastors.', 'Petits groupes (barre latérale) liste les groupes de maison/cellules de l''église avec leur responsable, jour, heure et lieu de rencontre. Les membres voient leur groupe, ses membres et les rencontres passées. Le responsable ajoute ou retire des membres et, après chaque rencontre, utilise « Noter une rencontre » pour cocher les présents, indiquer le nombre d''invités et écrire un court rapport pour les pasteurs.', 'everyone'),
('Managing small groups', 'The pastoral team creates groups (Small Groups → New group), chooses the leader and co-leader, and can archive a group. Each group card shows how many people attended its last meeting; open a group to read every meeting report.', 'L''équipe pastorale crée les groupes (Petits groupes → Nouveau groupe), choisit le responsable et le co-responsable, et peut archiver un groupe. Chaque carte de groupe montre combien de personnes étaient présentes à la dernière rencontre ; ouvrez un groupe pour lire tous les rapports.', 'pastoral')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
