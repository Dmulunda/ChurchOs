// Member Directory PDF export -- same html2canvas + jsPDF pattern as
// every other PDF in this app (js/utils/taxReceiptPdf.js), rendering
// an off-screen styled table then screenshotting it into a single
// custom-sized page (same "one page sized to fit everything" approach
// taxReceiptPdf.js already uses, rather than paginating).
import { t } from '../i18n.js';
import { getTenant } from '../tenant.js';
import { shareOrDownloadPdf } from '../utils/taxReceiptPdf.js';

const PAGE_WIDTH = 1400;
const ROW_HEIGHT = 34;
const HEADER_HEIGHT = 140;

export async function exportMemberDirectoryPdf({ rows, columns, filtersSummary }) {
  if (!window.html2canvas || !window.jspdf) {
    window.alert(t('memberDirectory.exportUnavailable'));
    return;
  }
  if (!rows || rows.length === 0) return;

  const churchName = getTenant()?.name || '';
  const pageHeight = HEADER_HEIGHT + (rows.length + 1) * ROW_HEIGHT + 40;

  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;left:-9999px;top:0;width:${PAGE_WIDTH}px;background:#ffffff;padding:32px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1e293b;`;
  wrap.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-size:18px;font-weight:700;">${escapeHtml(churchName)}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">${escapeHtml(t('memberDirectory.title'))} — ${escapeHtml(new Date().toLocaleDateString())}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${escapeHtml(filtersSummary || '')}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;">${escapeHtml(t('memberDirectory.colName'))}</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;">${escapeHtml(t('memberDirectory.colStatus'))}</th>
          ${columns.map((c) => `<th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;">${escapeHtml(t(c.label))}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr style="background:${r.status === 'Newcomer' ? '#fff7ed' : '#ffffff'};">
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.full_name)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(t(`memberDirectory.status${r.status}`))}</td>
            ${columns.map((c) => `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(cellText(r, c.key))}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  document.body.appendChild(wrap);

  try {
    const { jsPDF } = window.jspdf;
    const canvas = await window.html2canvas(wrap, { backgroundColor: '#ffffff', scale: 2 });
    const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [PAGE_WIDTH, pageHeight] });
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, PAGE_WIDTH, pageHeight);
    const blob = doc.output('blob');
    await shareOrDownloadPdf(new File([blob], 'members.pdf', { type: 'application/pdf' }));
  } finally {
    wrap.remove();
  }
}

function cellText(r, key) {
  switch (key) {
    case 'gender': return r.gender ? t(r.gender === 'M' ? 'memberCard.male' : 'memberCard.female') : '';
    case 'marital_status': return r.marital_status ? t(`memberRegistration.maritalStatus.${r.marital_status}`) : '';
    case 'age_group': return r.age_group ? t(`attendance.ageRange.${r.age_group}`) : '';
    case 'phone': return r.phone || '';
    case 'email': return r.email || '';
    case 'career': return r.career || '';
    case 'skills': return [...(r.skills || []).map((s) => t(`memberRegistration.skill.${s}`)), r.skills_other].filter(Boolean).join(', ');
    case 'address': return [r.address_street, r.address_city, r.address_province, r.address_postal].filter(Boolean).join(', ');
    default: return '';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
