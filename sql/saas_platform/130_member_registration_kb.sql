-- Matching knowledge-base row for Member Database self-registration
-- (sql/saas_platform/128-129), same discipline as
-- sql/saas_platform/105_ai_assistant_seed.sql's own comment asks for.

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values

('Member Registration Link', 'Tools → Member Registration Link shows a QR code and shareable link (register.html) that anyone can open with no account to register their own info (name, gender, marital status, address, age group, career, phone, email, skills). A logged-in member can fill the same form inside the app from Tools/their account menu, pre-filled with what''s already on file. Submissions are automatically matched against existing members by email, phone and name similarity -- a strong match updates that person''s record, a weak match is flagged for an admin to review as a possible duplicate, and no match creates a new Newcomer.', 'Outils → Lien d''inscription des membres affiche un code QR et un lien partageable (register.html) que n''importe qui peut ouvrir sans compte pour inscrire ses propres informations (nom, sexe, état civil, adresse, tranche d''âge, carrière, téléphone, courriel, compétences). Un membre connecté peut remplir le même formulaire dans l''application depuis Outils/son menu de compte, pré-rempli avec ce qui est déjà au dossier. Les soumissions sont automatiquement comparées aux membres existants par courriel, téléphone et similarité de nom -- une forte correspondance met à jour le dossier de cette personne, une correspondance faible est signalée pour qu''un administrateur la révise comme doublon possible, et l''absence de correspondance crée un nouveau Nouveau venu.', 'pastoral')

) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
