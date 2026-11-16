-- Knowledge-base rows for the sermon library (sql/saas_platform/158).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Sermon library', 'Sermons (sidebar) lists every sermon with its preacher, date, series and Bible passage. Search by any word, filter by series or language, watch the video link, listen to the audio or open the notes (PDF).', 'Prédications (barre latérale) liste toutes les prédications avec le prédicateur, la date, la série et le passage biblique. Cherchez par n''importe quel mot, filtrez par série ou par langue, regardez la vidéo, écoutez l''audio ou ouvrez les notes (PDF).', 'everyone'),
('Adding a sermon', 'The pastoral team and the Media and Preaching departments use Sermons → Add a sermon: title, preacher, date, series, passage, language, summary, a video link (YouTube or Facebook, starting with https://), and optionally an audio file (MP3/M4A, up to 200 MB) and notes (PDF).', 'L''équipe pastorale et les départements Média et Prédication utilisent Prédications → Ajouter une prédication : titre, prédicateur, date, série, passage, langue, résumé, un lien vidéo (YouTube ou Facebook, commençant par https://) et, si voulu, un fichier audio (MP3/M4A, jusqu''à 200 Mo) et des notes (PDF).', 'department_admin')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
