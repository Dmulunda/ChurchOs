-- Knowledge-base row for the communication hub (sql/saas_platform/146).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Communication hub', 'Tools → Communication hub sends one message to the whole church or to chosen departments. Pick the channels: in the app (bell icon), phone notification, email, and -- once your church has them set up -- SMS and WhatsApp. Church-wide messages are for the pastoral team; a department admin or secretary can message their own department. The History tab shows past messages and how many people each channel reached.', 'Outils → Centre de communication envoie un message à toute l''église ou aux départements choisis. Choisissez les canaux : dans l''application (icône cloche), notification sur téléphone, courriel et -- une fois activés pour votre église -- SMS et WhatsApp. Les messages à toute l''église sont réservés à l''équipe pastorale ; un administrateur ou secrétaire de département peut écrire à son propre département. L''onglet Historique montre les messages envoyés et combien de personnes chaque canal a atteintes.', 'department_admin')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
