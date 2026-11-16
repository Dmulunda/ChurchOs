-- Knowledge-base rows for shared documents & minutes (sql/saas_platform/160).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Documents and meeting minutes', 'Documents (sidebar) holds the church''s files, useful links and meeting minutes. Search any word, or filter by department or type. Tap an item to read the minutes (who was there, notes, decisions, action items), open the link or download the file. You only see what is shared with everyone, with your departments, or with leaders if you are one.', 'Documents (barre latérale) regroupe les fichiers de l''église, les liens utiles et les procès-verbaux de réunion. Cherchez n''importe quel mot ou filtrez par département ou par type. Touchez un élément pour lire le procès-verbal (présents, notes, décisions, actions à faire), ouvrir le lien ou télécharger le fichier. Vous ne voyez que ce qui est partagé avec tout le monde, avec vos départements, ou avec les responsables si vous en êtes un.', 'everyone'),
('Adding documents and minutes', 'Department admins add items for their department, leaders can add church-wide items, and the pastoral team manages everything: Documents → Add, then choose Meeting minutes, File (up to 50 MB) or Link, where it belongs, who can see it (everyone, department only, leaders only) and an optional folder such as "2026 Board".', 'Les administrateurs de département ajoutent des éléments pour leur département, les responsables peuvent en ajouter pour toute l''église, et l''équipe pastorale gère tout : Documents → Ajouter, puis choisissez Procès-verbal, Fichier (jusqu''à 50 Mo) ou Lien, à qui il appartient, qui peut le voir (tout le monde, département seulement, responsables seulement) et un dossier facultatif comme « Conseil 2026 ».', 'department_admin')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
