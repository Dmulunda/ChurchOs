-- Matching knowledge-base row for the Member Directory
-- (sql/saas_platform/128-132), same discipline as
-- sql/saas_platform/105_ai_assistant_seed.sql's own comment asks for.

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values

('The Member Directory', 'Tools → Member Directory shows every member in one searchable, filterable table (name, gender, marital status, address, age group, career, phone, email, skills). Newcomer rows are highlighted orange, people who have left are greyed out. Click a name to see the full record and its change history. Filters and visible columns apply to the Excel, CSV and PDF export buttons. When a self-registration is a possible match for an existing member (not a strong enough match to update automatically), it shows a "Possible duplicate" badge -- Merge combines it into the original (filling in blanks, never overwriting what''s already there) or Keep as new keeps it as its own separate record. Editing a member''s name, phone or gender here also updates their linked login profile automatically, and vice versa.', 'Outils → Annuaire des membres affiche tous les membres dans un tableau consultable et filtrable (nom, sexe, état civil, adresse, tranche d''âge, carrière, téléphone, courriel, compétences). Les nouveaux venus sont en surbrillance orange, les personnes parties sont grisées. Cliquez sur un nom pour voir le dossier complet et son historique de modifications. Les filtres et les colonnes visibles s''appliquent aux boutons d''export Excel, CSV et PDF. Lorsqu''une auto-inscription correspond possiblement à un membre existant (sans correspondance assez forte pour une mise à jour automatique), un badge « Doublon possible » apparaît -- Fusionner la combine avec l''original (en complétant les champs vides, sans jamais écraser ce qui est déjà présent) ou Garder comme nouveau la conserve comme dossier distinct. Modifier le nom, le téléphone ou le sexe d''un membre ici met aussi à jour automatiquement son profil de connexion lié, et inversement.', 'pastoral')

) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
