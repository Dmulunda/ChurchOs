-- Knowledge-base rows for paid events and check-in (sql/saas_platform/168).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Event check-in', 'At the door, open Events → the event → "📷 Check-in". Tap "Scan tickets with the camera" and point the phone at the QR code from the person''s confirmation email: a green box means checked in, orange means already checked in, waitlisted or payment pending, red means it is not a ticket for this event. No ticket? Search the name in the list and tap "Check in"; "Undo" reverses a mistake. Members of the organizing department and the pastoral team can check people in.', 'À l''entrée, ouvrez Événements → l''événement → « 📷 Accueil ». Touchez « Scanner les billets avec la caméra » et visez le code QR du courriel de confirmation : un encadré vert signifie accueilli, orange signifie déjà accueilli, sur liste d''attente ou paiement en attente, rouge signifie que ce n''est pas un billet pour cet événement. Pas de billet ? Cherchez le nom dans la liste et touchez « Accueillir » ; « Annuler » corrige une erreur. Les membres du département organisateur et l''équipe pastorale peuvent accueillir les participants.', 'everyone'),
('Paid events', 'For a priced event, people can pay by card right after registering, or later with the "Pay online" link in their confirmation email, when the church has set up online payments (the same Stripe account as online giving). Organizers see "x of y paid"; for cash at the door, change the person''s payment to Paid, or to Waived for a free place. Online payments show 💳 and are marked paid automatically.', 'Pour un événement payant, les participants peuvent payer par carte juste après l''inscription, ou plus tard avec le lien « Payer en ligne » de leur courriel de confirmation, si l''église a configuré les paiements en ligne (le même compte Stripe que les dons en ligne). Les organisateurs voient « x sur y payés » ; pour un paiement en espèces à l''entrée, passez le paiement de la personne à Payé, ou à Exempté pour une place gratuite. Les paiements en ligne affichent 💳 et sont marqués payés automatiquement.', 'department_admin')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
