begin;
insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Church calendar', 'Calendar (sidebar) shows everything happening at church in one place: events, department schedules, choir services, small group meetings and other meetings or room bookings. Use the arrows to change month. Leaders (pastoral team, department admins and secretaries) can add an item with "+ Add" and book a room -- the app refuses a room that is already booked at that time. The pastoral team can manage rooms and copy a private link to subscribe in Google Calendar, Outlook or Apple Calendar.', 'Calendrier (barre latérale) montre tout ce qui se passe à l''église au même endroit : événements, horaires des départements, services de la chorale, rencontres des petits groupes et autres réunions ou réservations de salle. Utilisez les flèches pour changer de mois. Les responsables (équipe pastorale, administrateurs et secrétaires de département) peuvent ajouter un élément avec « + Ajouter » et réserver une salle -- l''application refuse une salle déjà réservée à ce moment. L''équipe pastorale peut gérer les salles et copier un lien privé pour s''abonner dans Google Agenda, Outlook ou Apple Calendrier.', 'everyone')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;
commit;
