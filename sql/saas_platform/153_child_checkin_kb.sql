begin;
insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Children''s check-in', 'Sunday School → Check-in: at drop-off, tap the child''s name to check them in. The app shows a 4-character pick-up code (for example K7P4) -- give it to the parent, along with any allergy alert shown in red. At pick-up, tap "Check out", type the code the parent gives and who is picking the child up. A wrong code is refused, so a child only leaves with the person holding the code. The list shows who is still in the room.', 'École du dimanche → Accueil : à l''arrivée, touchez le nom de l''enfant pour l''enregistrer. L''application affiche un code de récupération de 4 caractères (par exemple K7P4) -- donnez-le au parent, ainsi que toute alerte d''allergie affichée en rouge. Au départ, touchez « Départ », entrez le code donné par le parent et qui vient chercher l''enfant. Un mauvais code est refusé : l''enfant ne part qu''avec la personne qui a le code. La liste montre qui est encore dans la salle.', 'everyone')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;
commit;
