-- Knowledge-base row for automatic reminders (sql/saas_platform/142),
-- same discipline as sql/saas_platform/105_ai_assistant_seed.sql asks for.

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Automatic reminders', 'The app reminds people automatically every morning: two days before they serve in a department or sing with the choir, the day before a confirmed pastor meeting (both the member and the pastor), and the day before an event they registered for. Reminders show in the app, are emailed, and arrive as a phone notification if notifications are turned on for that device. Each person can turn reminder emails or in-app reminders off in their notification settings (bell icon → settings).', 'L''application envoie des rappels automatiquement chaque matin : deux jours avant de servir dans un département ou de chanter avec la chorale, la veille d''une rencontre pastorale confirmée (au membre et au pasteur), et la veille d''un événement auquel la personne est inscrite. Les rappels apparaissent dans l''application, sont envoyés par courriel et arrivent comme notification sur le téléphone si les notifications sont activées sur cet appareil. Chacun peut désactiver les rappels par courriel ou dans l''application dans ses paramètres de notification (icône cloche → paramètres).', 'everyone')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
