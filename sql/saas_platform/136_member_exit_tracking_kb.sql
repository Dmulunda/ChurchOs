-- Matching knowledge-base row for Member Exit Tracking
-- (sql/saas_platform/134-135), same discipline as
-- sql/saas_platform/105_ai_assistant_seed.sql's own comment asks for.
begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values

('Member Exit Tracking', 'Tools → Exit Tracking (pastoral team only) shows why people have left: a chart of reasons ranked by percentage, a quarterly trend, and an exportable list, with a warning when fewer than 5 exits match the current filters. A member is marked as left either from the Member Directory''s "Mark as left" row action, or when they use "Leave this church" themselves (Account menu) -- both open the same reason form (main reason, optional other reasons, a short summary, notes, how the church found out, whether they joined another church, and whether they''re open to a follow-up). Someone leaving on their own can skip the form entirely; an admin marking someone as left cannot. Reinstating someone (User Manager) puts their member record back to "Member" without deleting their exit history.', 'Outils → Suivi des départs (équipe pastorale uniquement) montre pourquoi les gens sont partis : un graphique des raisons classées par pourcentage, une tendance trimestrielle et une liste exportable, avec un avertissement lorsque moins de 5 départs correspondent aux filtres actuels. Un membre est marqué comme parti soit depuis l''action « Marquer comme parti » de l''Annuaire des membres, soit lorsqu''il utilise lui-même « Quitter cette église » (menu Compte) -- les deux ouvrent le même formulaire de raison (raison principale, autres raisons facultatives, un court résumé, des notes, comment l''église l''a appris, si la personne a rejoint une autre église, et si elle est ouverte à un suivi). Une personne qui part de son propre chef peut ignorer entièrement le formulaire ; un administrateur qui marque quelqu''un comme parti ne le peut pas. Réintégrer quelqu''un (Gestion des utilisateurs) remet son dossier de membre à « Membre » sans supprimer son historique de départ.', 'pastoral')

) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
