// Printable "Certificate of Completion" — opened in a fresh browser
// window/tab with entirely self-contained HTML (its own <style>, no
// dependency on the app's stylesheet or any external font/asset besides
// the logo mark) so printing it doesn't drag in the sidebar/nav or
// fight the app's own print behavior. Only shown once
// course_approvals.status is 'approved' — see courseCatalog.js.
//
// The two signature lines are fixed named signatories, not dynamic
// per-course data (unlike the Member ID Card's pastor signature, which
// is pulled from whoever holds member_title = 'pastor_principal') —
// there's no "who signs completion certificates" concept in the schema,
// and none was asked for, so these are simple constants a future code
// change would update if the actual people ever change.
import { t } from '../i18n.js';
import { publicPageUrl } from '../utils/publicUrl.js';
import { getTenant } from '../tenant.js';

const LEAD_INSTRUCTOR_NAME = 'Prophète Francis Ngawala';
const LEAD_INSTRUCTOR_TITLE = 'LEAD INSTRUCTOR';
const ACADEMY_DIRECTOR_NAME = 'Dr Nana Esperance Ngawala';
const ACADEMY_DIRECTOR_TITLE = 'PASTEUR PRINCIPAL';

export function openCertificate({ studentName, courseTitle, approvedAt, approvalId }) {
  const dateLabel = new Date(approvedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  // Falls back to the platform default only if this tenant hasn't
  // uploaded their own yet -- see js/components/tenantLogoModal.js,
  // same pattern as memberIdCard.js's header.
  const logoUrl = getTenant()?.logo_url || publicPageUrl('img/church-on-point-icon.png');
  const certificateId = formatCertificateId(approvalId, approvedAt);

  const html = `
    <!DOCTYPE html>
    <html lang="${document.documentElement.lang || 'en'}">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(t('courses.certificateTitle'))} — ${escapeHtml(studentName)}</title>
      <style>
        @page { size: landscape; margin: 0; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: Georgia, 'Times New Roman', serif;
          background: #eef1f6;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 24px;
        }
        .certificate {
          position: relative;
          background:
            radial-gradient(ellipse at 50% 30%, rgba(212,175,55,0.09), rgba(212,175,55,0) 60%),
            #fffdf7;
          width: 980px;
          max-width: 100%;
          padding: 56px 64px 44px;
          border: 10px solid #0B1F3A;
          outline: 2px solid #D4AF37;
          outline-offset: -18px;
          text-align: center;
        }
        .corner {
          position: absolute;
          width: 14px;
          height: 14px;
          background: #D4AF37;
          transform: rotate(45deg);
        }
        .corner.tl { top: 26px; left: 26px; }
        .corner.tr { top: 26px; right: 26px; }
        .corner.bl { bottom: 26px; left: 26px; }
        .corner.br { bottom: 26px; right: 26px; }
        .badge { margin: 0 auto 14px; }
        .badge img { height: 78px; width: auto; display: block; margin: 0 auto; }
        .eyebrow {
          font-size: 13px;
          letter-spacing: 6px;
          text-transform: uppercase;
          color: #9c7a12;
          margin: 4px 0 10px;
        }
        h1.title {
          font-size: 36px;
          color: #0B1F3A;
          margin: 0 0 22px;
        }
        h1.title .diamond { color: #D4AF37; font-size: 20px; margin: 0 12px; vertical-align: middle; }
        .presented-to { font-size: 14px; color: #64748b; margin-bottom: 10px; }
        .student-name {
          font-size: 40px;
          font-style: italic;
          font-weight: 700;
          color: #0B1F3A;
          margin: 0 auto 22px;
          display: inline-block;
          padding-bottom: 10px;
          border-bottom: 1px solid #cbd5e1;
        }
        .course-line { font-size: 16px; color: #334155; margin-bottom: 6px; }
        .course-title { font-weight: bold; color: #0B1F3A; display: block; font-size: 20px; margin-top: 6px; }
        .date { font-size: 13px; font-style: italic; color: #64748b; margin: 14px 0 40px; }
        .signatures {
          display: flex;
          justify-content: center;
          gap: 110px;
          margin-bottom: 26px;
        }
        .signature { min-width: 220px; }
        .signature .name {
          font-size: 19px;
          font-style: italic;
          color: #0B1F3A;
          margin: 0 0 4px;
          border-bottom: 1px solid #94a3b8;
          padding-bottom: 8px;
        }
        .signature .role {
          font-size: 11px;
          letter-spacing: 2px;
          color: #64748b;
        }
        .cert-id {
          font-size: 10px;
          letter-spacing: 3px;
          color: #9ca3af;
        }
        .no-print { text-align: center; margin-top: 20px; }
        .no-print button {
          font-family: -apple-system, sans-serif;
          font-size: 14px;
          padding: 10px 20px;
          border-radius: 8px;
          border: none;
          background: #0B1F3A;
          color: white;
          cursor: pointer;
        }
        @media print { .no-print { display: none; } body { background: white; padding: 0; } }
      </style>
    </head>
    <body>
      <div>
        <div class="certificate">
          <span class="corner tl"></span><span class="corner tr"></span>
          <span class="corner bl"></span><span class="corner br"></span>

          <div class="badge"><img src="${logoUrl}" alt="" /></div>
          <div class="eyebrow">${escapeHtml(t('courses.certificateEyebrow'))}</div>
          <h1 class="title"><span class="diamond">&#9670;</span>${escapeHtml(t('courses.certificateTitle'))}<span class="diamond">&#9670;</span></h1>

          <p class="presented-to">${escapeHtml(t('courses.certificatePresentedTo'))}</p>
          <p class="student-name">${escapeHtml(studentName)}</p>
          <p class="course-line">
            ${escapeHtml(t('courses.certificateFor'))}
            <span class="course-title">${escapeHtml(courseTitle)}</span>
          </p>
          <p class="date">${escapeHtml(t('courses.certificateAwardedOn', { date: dateLabel }))}</p>

          <div class="signatures">
            <div class="signature">
              <p class="name">${escapeHtml(LEAD_INSTRUCTOR_NAME)}</p>
              <p class="role">${escapeHtml(LEAD_INSTRUCTOR_TITLE)}</p>
            </div>
            <div class="signature">
              <p class="name">${escapeHtml(ACADEMY_DIRECTOR_NAME)}</p>
              <p class="role">${escapeHtml(ACADEMY_DIRECTOR_TITLE)}</p>
            </div>
          </div>

          <p class="cert-id">${escapeHtml(t('courses.certificateId', { id: certificateId }))}</p>
        </div>
        <div class="no-print">
          <button onclick="window.print()">${escapeHtml(t('courses.print'))}</button>
        </div>
      </div>
    </body>
    </html>
  `;

  const win = window.open('', '_blank');
  if (!win) {
    window.alert(t('courses.certificatePopupBlocked'));
    return;
  }
  win.document.write(html);
  win.document.close();
}

// A stable, human-readable ID derived from the underlying
// course_approvals row rather than generated fresh on every print —
// printing the same certificate twice must show the same ID. There's
// no dedicated certificate/sequence table, so this isn't a guaranteed-
// unique sequential number like a real registrar's certificate ID,
// just a short, stable fingerprint of the approval it represents.
function formatCertificateId(approvalId, approvedAt) {
  const year = new Date(approvedAt).getFullYear();
  const shortId = (approvalId || '').replace(/-/g, '').slice(0, 6).toUpperCase() || '000000';
  return `VPD-${year}-${shortId}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
