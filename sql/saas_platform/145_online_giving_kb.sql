-- Knowledge-base rows for online giving (sql/saas_platform/144).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience, tenant_id)
select v.topic, v.content_en, v.content_fr, v.audience, t.id
from (values
('Giving online', 'Members can give from the app (Tax / Impôts → Give online) and anyone can give from the church''s public giving link or QR code. Choose an amount, a type (tithe, offering, sacrifice, construction, other) and pay by card. If the church shows Interac e-Transfer or mobile money instructions, follow them instead. When you give while signed in, the gift counts toward your year-end tax receipt automatically.', 'Les membres peuvent donner depuis l''application (Tax / Impôts → Donner en ligne) et tout le monde peut donner depuis le lien public ou le code QR de l''église. Choisissez un montant, un type (dîme, offrande, sacrifice, construction, autre) et payez par carte. Si l''église affiche des instructions Interac ou mobile money, suivez-les. Quand vous donnez en étant connecté, le don compte automatiquement dans votre reçu fiscal de fin d''année.', 'everyone'),
('Setting up online giving', 'Offerings → Online giving: a Super Admin or Finance admin connects the church''s own Stripe account once (the money goes directly to the church), then switches giving on. Optional: add the Interac e-Transfer email and mobile money instructions to show on the giving page, and a thank-you message. Share the giving link or QR code. Every paid card gift appears in Offerings automatically with the payment method Online.', 'Offrandes → Dons en ligne : un Super Admin ou un administrateur des Finances connecte une fois le compte Stripe de l''église (l''argent va directement à l''église), puis active les dons. Facultatif : ajoutez le courriel Interac et les instructions mobile money à afficher sur la page de dons, et un message de remerciement. Partagez le lien ou le code QR de dons. Chaque don par carte payé apparaît automatiquement dans Offrandes avec le mode de paiement En ligne.', 'finance')
) as v(topic, content_en, content_fr, audience)
cross join public.tenants t;

commit;
