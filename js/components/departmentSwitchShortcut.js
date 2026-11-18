// Super-Admin-only convenience on the Scheduling tab: instead of going
// back to the main department switcher (top of the sidebar) to create
// a schedule in a different department, jump straight there from
// wherever you already are. Doesn't grant any new access — it drives
// the exact same handleDepartmentSwitch() the sidebar's own department
// list uses, so it only ever offers departments this account can
// already reach.
import { getMyDepartments, getGlobalRole } from '../departments.js';
import { handleDepartmentSwitch } from '../app.js';
import { t, departmentLabel } from '../i18n.js';

export function renderDepartmentSwitchShortcut(container, { activeKey }) {
  if (getGlobalRole() !== 'super_admin') {
    container.innerHTML = '';
    return;
  }

  const departments = getMyDepartments();
  if (departments.length <= 1) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="flex items-center gap-2 mb-4 text-sm">
      <label class="text-slate-500 font-medium whitespace-nowrap">${t('deptScheduling.switchDepartment')}</label>
      <select data-el="switch-select" class="min-w-0 flex-1 sm:flex-none max-w-xs border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        ${departments.map((d) => `<option value="${d.key}" ${d.key === activeKey ? 'selected' : ''}>${escapeHtml(departmentLabel(d.key))}</option>`).join('')}
      </select>
    </div>
  `;

  container.querySelector('[data-el="switch-select"]').addEventListener('change', (e) => {
    handleDepartmentSwitch(e.target.value);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
