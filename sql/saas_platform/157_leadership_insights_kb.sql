-- Knowledge-base row for leadership insights (sql/saas_platform/156).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Leadership insights', 'Leadership Insights (sidebar, pastoral team only) shows church health on one page: Sunday headcount from Ushers, children from Sunday School, people checked in, new guests, volunteers who served and, for people who can see all offerings, giving — week by week for 8, 12, 26 or 52 weeks. Arrows compare the last 4 weeks with the 4 before. Below are totals for the period: new members, people who left, guests waiting for a call, prayer requests not yet handled and small-group attendance. A dash means nothing was recorded that week.', 'Indicateurs de l''église (barre latérale, équipe pastorale seulement) montre la santé de l''église sur une page : présence du dimanche (Protocole), enfants (École du dimanche), personnes pointées, nouveaux invités, bénévoles ayant servi et, pour ceux qui voient toutes les offrandes, les dons — semaine par semaine sur 8, 12, 26 ou 52 semaines. Les flèches comparent les 4 dernières semaines aux 4 précédentes. En dessous : nouveaux membres, départs, invités en attente d''un appel, demandes de prière non traitées et présence aux petits groupes. Un tiret signifie que rien n''a été enregistré cette semaine-là.', 'pastoral')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
