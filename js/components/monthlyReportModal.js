// Monthly Departmental Report — attendance/absence summary and a
// month-over-month trend are auto-computed from data that already
// exists (department_memberships, absence_reports); only the
// notes/needs section is actually stored (department_monthly_reports,
// one row per department per month), editable by that department's
// admins. A per-service "who served" scheduling recap isn't included
// here — Choir/Preaching/Media & Tech/Ecodem each shape their
// scheduling data differently, so it's deferred rather than guessed at.
import { t, appLocale } from '../i18n.js';

function monthBounds(monthValue) {
  // monthValue: "YYYY-MM" from <input type="month">
  const [year, month] = monthValue.split('-').map(Number);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { start, end: nextMonth };
}

function previousMonthValue(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function createMonthlyReportModal({ supabase, departmentId, departmentKey, canEdit, currentUserId, title }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${title}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <input type="month" data-el="month-picker" class="mb-4 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const monthPickerEl = root.querySelector('[data-el="month-picker"]');
  const bodyEl = root.querySelector('[data-el="body"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  monthPickerEl.addEventListener('change', () => load());

  async function absenceCountForMonth(memberIds, monthValue) {
    if (memberIds.length === 0) return 0;
    const { start, end } = monthBounds(monthValue);
    const { data } = await supabase
      .from('absence_reports')
      .select('user_id')
      .in('user_id', memberIds)
      .gte('absence_date', start)
      .lt('absence_date', end);
    return new Set((data || []).map((r) => r.user_id)).size;
  }

  async function load() {
    const monthValue = monthPickerEl.value;
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: members, error: membersError } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name )')
      .eq('department_id', departmentId)
      .eq('status', 'approved');

    if (membersError) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('monthlyReport.failedToLoad', { message: membersError.message })}</p>`;
      return;
    }

    const memberIds = (members || []).map((m) => m.user_id);
    const { start, end } = monthBounds(monthValue);

    const [{ data: absenceRows }, previousMonthCount, { data: reportRow }] = await Promise.all([
      memberIds.length > 0
        ? supabase.from('absence_reports').select('user_id, absence_date, reason, created_at, member:profiles!user_id ( full_name )').in('user_id', memberIds).gte('absence_date', start).lt('absence_date', end).order('absence_date')
        : Promise.resolve({ data: [] }),
      absenceCountForMonth(memberIds, previousMonthValue(monthValue)),
      supabase.from('department_monthly_reports').select('notes, needs').eq('department_id', departmentId).eq('report_month', start).maybeSingle(),
    ]);

    const distinctAbsentThisMonth = new Set((absenceRows || []).map((r) => r.user_id)).size;
    const approvedCount = memberIds.length;
    const trend = distinctAbsentThisMonth === previousMonthCount
      ? t('monthlyReport.trendSame')
      : distinctAbsentThisMonth > previousMonthCount
        ? t('monthlyReport.trendUp', { count: distinctAbsentThisMonth - previousMonthCount })
        : t('monthlyReport.trendDown', { count: previousMonthCount - distinctAbsentThisMonth });

    renderBody({
      approvedCount,
      distinctAbsentThisMonth,
      absenceRows: absenceRows || [],
      trend,
      notes: reportRow?.notes || '',
      needs: reportRow?.needs || '',
      monthValue,
    });
  }

  function renderBody({ approvedCount, distinctAbsentThisMonth, absenceRows, trend, notes, needs, monthValue }) {
    const attendanceRate = approvedCount > 0 ? Math.round(((approvedCount - distinctAbsentThisMonth) / approvedCount) * 100) : null;

    bodyEl.innerHTML = `
      <div class="bg-slate-50 rounded-lg p-4 mb-4 space-y-1">
        <p class="text-sm"><span class="font-medium">${t('monthlyReport.approvedMembers')}:</span> ${approvedCount}</p>
        <p class="text-sm"><span class="font-medium">${t('monthlyReport.absencesThisMonth')}:</span> ${distinctAbsentThisMonth}</p>
        ${attendanceRate !== null ? `<p class="text-sm"><span class="font-medium">${t('monthlyReport.attendanceEstimate')}:</span> ~${attendanceRate}%</p>` : ''}
        <p class="text-sm"><span class="font-medium">${t('monthlyReport.trend')}:</span> ${escapeHtml(trend)}</p>
      </div>

      ${absenceRows.length > 0 ? `
        <div class="mb-4">
          <p class="text-sm font-medium text-slate-600 mb-1">${t('monthlyReport.absenceDetail')}</p>
          <ul class="text-sm text-slate-600 space-y-1">
            ${absenceRows.map((r) => `<li>${escapeHtml(r.member?.full_name || '—')} — ${escapeHtml(r.absence_date)}${r.reason ? ` (${escapeHtml(r.reason)})` : ''} <span class="text-slate-400">· ${t('monthlyReport.reportedAt', { when: escapeHtml(formatReportedAt(r.created_at)) })}</span></li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <div class="border-t border-slate-200 pt-4">
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('monthlyReport.notesLabel')}</label>
        ${canEdit
          ? `<textarea data-el="notes-input" rows="3" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3">${escapeHtml(notes)}</textarea>`
          : `<p class="text-sm text-slate-600 mb-3 whitespace-pre-wrap">${notes ? escapeHtml(notes) : t('monthlyReport.none')}</p>`}

        <label class="block text-sm font-medium text-slate-600 mb-1">${t('monthlyReport.needsLabel')}</label>
        ${canEdit
          ? `<textarea data-el="needs-input" rows="3" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3">${escapeHtml(needs)}</textarea>`
          : `<p class="text-sm text-slate-600 mb-3 whitespace-pre-wrap">${needs ? escapeHtml(needs) : t('monthlyReport.none')}</p>`}

        ${canEdit ? `
          <div class="flex items-center gap-3">
            <button type="button" data-action="save" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('monthlyReport.save')}</button>
            <span data-el="save-status" class="text-sm text-slate-500"></span>
          </div>
        ` : ''}
      </div>
    `;

    if (canEdit) {
      const saveBtn = bodyEl.querySelector('[data-action="save"]');
      const statusEl = bodyEl.querySelector('[data-el="save-status"]');
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        statusEl.className = 'text-sm text-slate-500';
        statusEl.textContent = t('common.saving');

        const { start } = monthBounds(monthValue);
        const { error } = await supabase.from('department_monthly_reports').upsert({
          department_id: departmentId,
          report_month: start,
          notes: bodyEl.querySelector('[data-el="notes-input"]').value.trim() || null,
          needs: bodyEl.querySelector('[data-el="needs-input"]').value.trim() || null,
          updated_by: currentUserId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'department_id,report_month' });

        saveBtn.disabled = false;
        if (error) {
          statusEl.className = 'text-sm text-rose-600';
          statusEl.textContent = t('monthlyReport.saveFailed', { message: error.message });
          return;
        }
        statusEl.className = 'text-sm text-emerald-600';
        statusEl.textContent = t('monthlyReport.saved');
      });
    }
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    monthPickerEl.value = currentMonthValue();
    load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function formatReportedAt(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString(appLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
