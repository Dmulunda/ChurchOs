-- Knowledge-base row for the AI writing helper (sql/saas_platform/162).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('AI writing help', 'Leaders (pastoral team, department admins and secretaries) see "✨ AI help" under some text boxes: in the Communication hub (Translate FR ⇄ EN, Improve wording), in meeting minutes (Turn notes into minutes, Translate) and in sermons (Summarise, Translate). The suggestion appears in a purple box; nothing changes until you click "Use this", and "Undo" restores your text. AI can make mistakes, so read it before saving. Each person can use it 40 times a day.', 'Les responsables (équipe pastorale, administrateurs et secrétaires de département) voient « ✨ Aide IA » sous certaines zones de texte : dans le Centre de communication (Traduire FR ⇄ EN, Améliorer le texte), dans les procès-verbaux (Notes → procès-verbal, Traduire) et dans les prédications (Résumer, Traduire). La suggestion apparaît dans un encadré violet ; rien ne change tant que vous ne cliquez pas sur « Utiliser », et « Annuler » remet votre texte. L''IA peut se tromper : relisez avant d''enregistrer. Chaque personne peut l''utiliser 40 fois par jour.', 'department_admin')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
