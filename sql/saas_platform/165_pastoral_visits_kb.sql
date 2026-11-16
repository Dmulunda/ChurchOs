-- Knowledge-base rows for pastoral visits (sql/saas_platform/164).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Pastoral visits', 'Pastoral Visits (sidebar) lets the pastoral team plan home, hospital, phone and church visits: choose the person (from the member database or any name), the reason, date, time, place and the visitor. The visitor gets a notification when assigned and the day before. After the visit, "Mark done" records the date, confidential notes and an optional follow-up date; follow-ups due appear in their own list with "Plan follow-up". "Not visited in 6 months" lists members with no recent visit, each with a "Plan" button.', 'Visites pastorales (barre latérale) permet à l''équipe pastorale de planifier des visites à domicile, à l''hôpital, par téléphone ou à l''église : choisissez la personne (dans la base des membres ou n''importe quel nom), le motif, la date, l''heure, le lieu et le visiteur. Le visiteur reçoit une notification lorsqu''on la lui confie et la veille. Après la visite, « Marquer comme faite » enregistre la date, des notes confidentielles et une date de suivi facultative ; les suivis à faire apparaissent dans leur propre liste avec « Planifier le suivi ». « Pas visités depuis 6 mois » liste les membres sans visite récente, chacun avec un bouton « Planifier ».', 'pastoral'),
('Visits assigned to me', 'If a pastor assigns you a visit, Pastoral Visits appears in your sidebar with only your visits. After the visit, tap "Mark done", enter the date and a short confidential note for the pastors, and a follow-up date if needed.', 'Si un pasteur vous confie une visite, Visites pastorales apparaît dans votre barre latérale avec uniquement vos visites. Après la visite, touchez « Marquer comme faite », indiquez la date, une courte note confidentielle pour les pasteurs et, si besoin, une date de suivi.', 'everyone')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
