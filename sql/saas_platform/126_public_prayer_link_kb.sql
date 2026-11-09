-- Matching knowledge-base row for the public Prayer Request link
-- (sql/saas_platform/125), same discipline as
-- sql/saas_platform/105_ai_assistant_seed.sql's own comment asks for.

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values

('Public Prayer Request Link', 'Tools → Prayer Request Link shows a QR code and shareable link (prayer.html) that anyone can open with no account to send a prayer request -- the page shows the church''s own logo and name, and visitors can choose to stay fully anonymous (nothing is saved about who they are) or give their name and contact info and ask to be contacted. Public submissions show up in the same Prayer Requests queue as member-submitted ones, with filters for anonymous/named and an assign-to-pastor option.', 'Outils → Lien de demande de prière affiche un code QR et un lien partageable (prayer.html) que n''importe qui peut ouvrir sans compte pour envoyer une demande de prière -- la page affiche le logo et le nom de l''église, et la personne peut rester entièrement anonyme (rien n''est enregistré sur son identité) ou donner son nom et ses coordonnées et demander à être contactée. Les demandes publiques apparaissent dans la même file d''attente que celles des membres, avec des filtres anonyme/nommé et une option d''assignation à un pasteur.', 'pastoral')

) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
