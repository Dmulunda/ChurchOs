-- Updates every tenant's existing "Booking a meeting with the pastor"
-- KB row (not new rows) to mention sql/saas_platform/137's additions:
-- the office address, the booking confirmation note, and the
-- bilingual pause message.
begin;

update public.assistant_knowledge_base
set
  content_en = 'From the sidebar, choose "Pastor Meeting" (or open it from the Pastoral Dashboard''s "Pastor Meetings" tab if you already have access there). Pick an available time slot, in-person or online, and confirm -- you''ll see it listed under "My Requests". In-person bookings show the church''s address, and any note the church has set is shown right after you book. If a pastor has paused their availability, their message shows in your own language.',
  content_fr = 'Dans la barre latérale, choisissez "Rendez-vous pastoral" (ou ouvrez-le depuis l''onglet "Rendez-vous pastoraux" du Tableau de bord pastoral si vous y avez déjà accès). Choisissez un créneau disponible, en personne ou en ligne, et confirmez -- vous le verrez apparaître sous "Mes demandes". Les rendez-vous en personne affichent l''adresse de l''église, et toute note que l''église a définie s''affiche juste après la réservation. Si un pasteur a mis ses disponibilités en pause, son message s''affiche dans votre propre langue.'
where topic = 'Booking a meeting with the pastor';

commit;
