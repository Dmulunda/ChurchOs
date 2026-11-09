// Member Exit Tracking (Feature 3 of 3): the exportable table of
// individual exits below the reasons chart. Export itself reuses
// tableExport.js (same Excel/CSV helpers as the Member Directory) --
// no new export code needed here.
import { t } from '../i18n.js';

export function buildExitExportRows(rows) {
  return rows.map((row) => ({
    [t('memberExit.colName')]: row.members?.full_name || '',
    [t('memberExit.colDateLeft')]: row.date_left,
    [t('memberExit.colMainReason')]: t(`exitReasons.${row.main_reason}`),
    [t('memberExit.colReasonTitle')]: row.reason_title || '',
    [t('memberExit.colHowWeKnow')]: row.how_we_know ? t(`memberExit.howWeKnow.${row.how_we_know}`) : '',
    [t('memberExit.colJoinedOtherChurch')]: row.joined_other_church ? t(`memberExit.joinedOtherChurch.${row.joined_other_church}`) : '',
    [t('memberExit.colOpenToFollowUp')]: row.open_to_follow_up ? t('common.yes') : t('common.no'),
    [t('memberExit.colNotes')]: row.notes || '',
  }));
}

export function renderMemberExitTable(container, rows) {
  if (rows.length === 0) {
    container.innerHTML = `<p class="text-sm text-slate-500">${t('memberExit.noExits')}</p>`;
    return;
  }

  const table = document.createElement('table');
  table.className = 'w-full text-sm';
  table.innerHTML = `
    <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
      <tr>
        <th class="text-left px-4 py-2">${t('memberExit.colName')}</th>
        <th class="text-left px-4 py-2">${t('memberExit.colDateLeft')}</th>
        <th class="text-left px-4 py-2">${t('memberExit.colMainReason')}</th>
        <th class="text-left px-4 py-2">${t('memberExit.colReasonTitle')}</th>
        <th class="text-left px-4 py-2">${t('memberExit.colOpenToFollowUp')}</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-100"></tbody>
  `;
  const tbody = table.querySelector('tbody');

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 font-medium whitespace-nowrap">${escapeHtml(row.members?.full_name || '—')}</td>
      <td class="px-4 py-2 text-slate-600 whitespace-nowrap">${escapeHtml(row.date_left || '—')}</td>
      <td class="px-4 py-2 text-slate-600">${escapeHtml(t(`exitReasons.${row.main_reason}`))}</td>
      <td class="px-4 py-2 text-slate-600">${escapeHtml(row.reason_title || '—')}</td>
      <td class="px-4 py-2 text-slate-600">${row.open_to_follow_up ? t('common.yes') : t('common.no')}</td>
    `;
    tbody.appendChild(tr);
  });

  container.innerHTML = '';
  container.appendChild(table);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
