-- Matching knowledge-base rows for the Silent Directory + shared
-- User Status pipeline (sql/saas_platform/112), same discipline as
-- sql/saas_platform/105_ai_assistant_seed.sql's own comment asks for.

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values

('The Silent Directory', 'The Silent Directory (Tools → Silent Directory) lists every Silent user -- a real profile with no login, created via "Add User → No login yet", bulk import, or automatically from a guest check-in. Each one has a User Status (New Guest, Visitor for Other Church, Out of City, Member, Lost Member); set it to Member to unlock "Promote to Active", which turns them into a full logged-in account while keeping all their history.', 'L''Annuaire silencieux (Outils → Annuaire silencieux) liste chaque utilisateur silencieux -- un vrai profil sans connexion, créé via « Ajouter un utilisateur → Pas encore de connexion », par importation en lot, ou automatiquement lors d''un enregistrement de présence d''un visiteur. Chacun a un statut (Nouveau visiteur, Visiteur d''une autre église, Hors de la ville, Membre, Membre perdu) ; réglez-le sur Membre pour débloquer « Promouvoir en compte actif », qui en fait un compte complet avec connexion, tout en conservant son historique.', 'everyone'),

('Guest Notes and User Status in the Guest Hub', 'Each guest case in the Guest Onboarding Hub now has a User Status column (same options as the Silent Directory) separate from its Routing Stage -- setting User Status to Member marks the case as handled and moves it out of the active list (still viewable under Recently Graduated). You can also add timestamped Guest Notes directly on a case, in addition to the general/follow-up note fields.', 'Chaque dossier du Centre d''accueil des invités a maintenant une colonne Statut de l''utilisateur (mêmes options que l''Annuaire silencieux), distincte de son Étape de suivi -- régler le statut sur Membre marque le dossier comme traité et le retire de la liste active (toujours visible sous Récemment devenus membres). Vous pouvez aussi ajouter des notes datées directement sur un dossier, en plus des champs de note générale et de suivi.', 'pastoral')

) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
