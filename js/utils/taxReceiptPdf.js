// Builds a tax receipt PDF as a Blob -- extracted from
// taxReceiptsMemberBoard.js's original downloadReceiptPdf() (which
// always triggered a browser download) so taxReceiptsAdminBoard.js
// can build the exact same PDF for a Guest Donor (sql/065, someone
// with no app account) and email it instead, via the offering-reports
// Edge Function's send_tax_receipt_email action.
//
// Same html2canvas + jsPDF pattern as every other PDF export in this
// app (memberIdCard.js, etc.): render the receipt as a styled
// off-screen template, screenshot it, embed the PNG into a jsPDF doc.
import { t, appLocale, formatMoney } from '../i18n.js';

const RECEIPT_WIDTH = 850;
const RECEIPT_HEIGHT = 1100;

export function receiptPdfAvailable() {
  return !!(window.html2canvas && window.jspdf);
}

export async function buildReceiptPdfBlob(receipt) {
  const settings = receipt.tenant_info_snapshot || {};
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;left:-9999px;top:0;width:${RECEIPT_WIDTH}px;height:${RECEIPT_HEIGHT}px;background:#ffffff;padding:48px;box-sizing:border-box;font-family:Georgia,serif;color:#1e293b;`;
  wrap.innerHTML = `
    <div style="text-align:center;border-bottom:2px solid #1e293b;padding-bottom:16px;margin-bottom:24px;">
      <div style="font-size:20px;font-weight:700;">${escapeHtml(settings.legal_name || '')}</div>
      ${settings.address ? `<div style="font-size:12px;color:#475569;margin-top:4px;">${escapeHtml(settings.address)}</div>` : ''}
      ${settings.charity_registration_number ? `<div style="font-size:12px;color:#475569;margin-top:2px;">${escapeHtml(t('taxReceiptDoc.charityNumberLabel'))}: ${escapeHtml(settings.charity_registration_number)}</div>` : ''}
    </div>
    <div style="text-align:center;font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:24px;">
      ${escapeHtml(t('taxReceiptDoc.title'))}
    </div>
    <table style="width:100%;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#64748b;">${escapeHtml(t('taxReceiptDoc.receiptNumberLabel'))}</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(receipt.receipt_number)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">${escapeHtml(t('taxReceiptDoc.issuedOnLabel'))}</td><td style="padding:6px 0;text-align:right;">${escapeHtml(new Date(receipt.issued_at).toLocaleDateString(appLocale()))}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">${escapeHtml(t('taxReceiptDoc.fiscalYearLabel'))}</td><td style="padding:6px 0;text-align:right;">${receipt.fiscal_year}</td></tr>
      <tr><td style="padding:14px 0 6px;color:#64748b;border-top:1px solid #e2e8f0;">${escapeHtml(t('taxReceiptDoc.donorNameLabel'))}</td><td style="padding:14px 0 6px;text-align:right;font-weight:600;border-top:1px solid #e2e8f0;">${escapeHtml(receipt.legal_name_snapshot)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">${escapeHtml(t('taxReceiptDoc.totalAmountLabel'))}</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:18px;">${formatAmount(receipt.total_amount, receipt.currency)}</td></tr>
    </table>
    <p style="font-size:11px;color:#64748b;margin-top:32px;line-height:1.5;">${escapeHtml(t('taxReceiptDoc.disclaimer'))}</p>
    <div style="margin-top:56px;display:flex;justify-content:space-between;align-items:flex-end;">
      <div>
        ${settings.signature_data ? `<img src="${settings.signature_data}" style="height:60px;display:block;margin-bottom:4px;" />` : '<div style="height:60px;"></div>'}
        <div style="border-top:1px solid #1e293b;padding-top:4px;font-size:12px;">
          ${escapeHtml(settings.signing_authority_name || '')}${settings.signing_authority_title ? ` — ${escapeHtml(settings.signing_authority_title)}` : ''}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: [RECEIPT_WIDTH, RECEIPT_HEIGHT] });
    const canvas = await window.html2canvas(wrap, { backgroundColor: '#ffffff', scale: 2 });
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, RECEIPT_WIDTH, RECEIPT_HEIGHT);
    return doc.output('blob');
  } finally {
    wrap.remove();
  }
}

export async function shareOrDownloadPdf(file, statusEl) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      if (statusEl) statusEl.textContent = '';
      return;
    } catch (err) {
      if (err?.name === 'AbortError') { if (statusEl) statusEl.textContent = ''; return; }
    }
  }
  const link = document.createElement('a');
  link.download = file.name;
  link.href = URL.createObjectURL(file);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  if (statusEl) statusEl.textContent = '';
}

// FileReader's readAsDataURL gives "data:application/pdf;base64,AAAA..."
// -- Resend's attachments.content wants just the base64 payload.
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function formatAmount(amount, currency) {
  const base = formatMoney(amount);
  return currency ? `${base} ${currency}` : base;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
