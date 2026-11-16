// Messages only -- things a person actually wrote: direct messages
// (with a compose flow restricted to department-mates, unless the
// sender holds a church-wide role) and department announcements
// (read-only broadcasts, same RLS-scoped read pattern
// js/components/homeWidgets.js's own Announcements widget already
// uses). Automatic system alerts live in the separate bell icon's own
// feed now (js/components/notificationsModal.js) -- this modal no
// longer shows or mixes them in, per the Notifications-vs-Messages
// split (a human wrote everything here; nothing here is auto-
// generated, and nothing here is un-repliable the way a notification
// is -- announcements just don't have a 1:1 "reply" concept since
// they're a broadcast, not a conversation).
import { getGlobalRole } from '../departments.js';
import { confirmDialog } from './confirmDialog.js';
import { t, departmentLabel, formatDate } from '../i18n.js';

const GLOBAL_MESSAGE_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];

// One department produces two selectable recipient-search targets — a
// broadcast to everyone in it, and one to just its admins/secretaries —
// alongside the individual people built by buildPersonTarget() below.
function buildDepartmentTargets(departments) {
  return departments.flatMap((d) => {
    const name = departmentLabel(d.key);
    return [
      { type: 'department-all', departmentId: d.id, label: `${t('inbox.allOf')} ${name}`, searchText: name.toLowerCase() },
      { type: 'department-admins', departmentId: d.id, label: `${name} ${t('inbox.admins')}`, searchText: `${name.toLowerCase()} ${t('inbox.admins').toLowerCase()}` },
    ];
  });
}

// searchText includes the person's department names too, so typing a
// department also surfaces its individual members, not just the
// whole-department targets above.
function buildPersonTarget(person, deptKeys) {
  const deptNames = Array.from(deptKeys || []).map(departmentLabel).join(' ');
  return {
    type: 'person',
    id: person.id,
    label: person.full_name,
    searchText: `${person.full_name} ${deptNames}`.toLowerCase(),
  };
}

export function createInboxModal({ supabase, currentUserId, onRead }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
      <div class="flex items-center justify-between p-6 pb-2">
        <h2 class="text-xl font-bold">${t('inbox.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div class="flex gap-2 px-6 mb-3">
        <button type="button" data-el="tab-messages" class="px-3 py-1.5 rounded-lg text-sm font-medium">${t('inbox.messagesTab')}</button>
        <button type="button" data-el="tab-announcements" class="px-3 py-1.5 rounded-lg text-sm font-medium">${t('inbox.announcementsTab')}</button>
      </div>

      <div data-el="messages-panel" class="flex-1 overflow-y-auto px-6 pb-6">
        <button type="button" data-action="compose" class="mb-3 px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800">
          ${t('inbox.newMessage')}
        </button>
        <div data-el="compose" class="hidden border border-slate-200 rounded-lg p-3 mb-3 space-y-2"></div>
        <div data-el="messages-list" class="space-y-2"></div>
      </div>

      <div data-el="announcements-panel" class="hidden flex-1 overflow-y-auto px-6 pb-6 space-y-2"></div>
    </div>
  `;
  document.body.appendChild(root);

  const tabMessagesBtn = root.querySelector('[data-el="tab-messages"]');
  const tabAnnouncementsBtn = root.querySelector('[data-el="tab-announcements"]');
  const messagesPanelEl = root.querySelector('[data-el="messages-panel"]');
  const announcementsPanelEl = root.querySelector('[data-el="announcements-panel"]');
  const messagesListEl = root.querySelector('[data-el="messages-list"]');
  const composeEl = root.querySelector('[data-el="compose"]');
  const composeBtn = root.querySelector('[data-action="compose"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function setTabStyle(btn, active) {
    btn.classList.toggle('bg-indigo-600', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('text-slate-600', !active);
    btn.classList.toggle('hover:bg-slate-100', !active);
  }

  function activateTab(tab) {
    const isMessages = tab === 'messages';
    messagesPanelEl.classList.toggle('hidden', !isMessages);
    announcementsPanelEl.classList.toggle('hidden', isMessages);
    setTabStyle(tabMessagesBtn, isMessages);
    setTabStyle(tabAnnouncementsBtn, !isMessages);
  }

  tabMessagesBtn.addEventListener('click', () => { activateTab('messages'); loadMessages(); });
  tabAnnouncementsBtn.addEventListener('click', () => { activateTab('announcements'); loadAnnouncements(); });

  composeBtn.addEventListener('click', () => {
    const willShow = composeEl.classList.contains('hidden');
    composeEl.classList.toggle('hidden');
    if (willShow) renderCompose();
  });

  // Used by each received message's "Reply" button — opens compose
  // already targeting that sender, skipping the search step entirely.
  function replyTo(senderId, senderName) {
    composeEl.classList.remove('hidden');
    renderCompose({ presetTarget: { type: 'person', id: senderId, label: senderName } });
    composeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function renderCompose({ presetTarget } = {}) {
    composeEl.innerHTML = `
      <label class="block text-sm font-medium text-slate-600">${t('inbox.composeTo')}</label>
      <input type="search" data-el="recipient-search" placeholder="${t('inbox.composeSearchPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
      <div data-el="recipient-results" class="max-h-32 overflow-y-auto border border-slate-100 rounded-lg divide-y"></div>
      <p data-el="recipient-selected" class="text-sm text-slate-500"></p>
      <label class="block text-sm font-medium text-slate-600">${t('inbox.composeBody')}</label>
      <textarea data-el="compose-body" rows="2" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></textarea>
      <div class="flex items-center gap-3">
        <button type="button" data-action="send" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('inbox.send')}</button>
        <span data-el="compose-status" class="text-sm text-slate-500"></span>
      </div>
    `;

    const searchEl = composeEl.querySelector('[data-el="recipient-search"]');
    const resultsEl = composeEl.querySelector('[data-el="recipient-results"]');
    const recipientSelectedEl = composeEl.querySelector('[data-el="recipient-selected"]');
    const bodyEl = composeEl.querySelector('[data-el="compose-body"]');
    const statusEl = composeEl.querySelector('[data-el="compose-status"]');
    const sendBtn = composeEl.querySelector('[data-action="send"]');

    if (presetTarget) {
      recipientSelectedEl.textContent = `${t('inbox.composeTo')}: ${presetTarget.label}`;
      bodyEl.focus();
    }

    // Every entry is either a single person or a whole-department target
    // ("All of X" / "X Admins") — a regular member only gets these for
    // departments they belong to (mirroring who they're allowed to
    // message at all, per shares_department() in sql/026); a church-wide
    // role gets every department and every person, matching their
    // "message anyone" access. searchText lets one search box match by
    // either a person's name or a department's name.
    const isGlobalSender = GLOBAL_MESSAGE_ROLES.includes(getGlobalRole());
    let candidates = [];
    let selectedTarget = presetTarget || null;
    let filteredResults = [];

    if (isGlobalSender) {
      const [{ data: departments }, { data: profiles }, { data: memberships }] = await Promise.all([
        supabase.from('departments').select('id, key, name').order('name'),
        supabase.from('profiles').select('id, full_name').neq('id', currentUserId).order('full_name'),
        supabase.from('department_memberships').select('user_id, departments ( key )').eq('status', 'approved'),
      ]);

      const deptKeysByUser = new Map();
      (memberships || []).forEach((m) => {
        if (!m.departments) return;
        if (!deptKeysByUser.has(m.user_id)) deptKeysByUser.set(m.user_id, new Set());
        deptKeysByUser.get(m.user_id).add(m.departments.key);
      });

      candidates = buildDepartmentTargets(departments || []).concat(
        (profiles || []).map((p) => buildPersonTarget(p, deptKeysByUser.get(p.id)))
      );
    } else {
      const { data: myMemberships } = await supabase
        .from('department_memberships')
        .select('department_id, departments ( id, key, name )')
        .eq('user_id', currentUserId)
        .eq('status', 'approved');
      const myDepartments = (myMemberships || []).filter((m) => m.departments).map((m) => m.departments);
      const deptIds = myDepartments.map((d) => d.id);

      let people = [];
      if (deptIds.length > 0) {
        const { data } = await supabase
          .from('department_memberships')
          .select('user_id, member:profiles!user_id ( id, full_name ), departments ( key )')
          .in('department_id', deptIds)
          .eq('status', 'approved');

        const peopleById = new Map();
        (data || []).forEach((row) => {
          if (!row.member || row.member.id === currentUserId) return;
          if (!peopleById.has(row.member.id)) peopleById.set(row.member.id, { full_name: row.member.full_name, deptKeys: new Set() });
          if (row.departments?.key) peopleById.get(row.member.id).deptKeys.add(row.departments.key);
        });

        people = Array.from(peopleById.entries())
          .map(([id, p]) => buildPersonTarget({ id, full_name: p.full_name }, p.deptKeys))
          .sort((a, b) => a.label.localeCompare(b.label));
      }

      candidates = buildDepartmentTargets(myDepartments).concat(people);
    }

    function renderResults(query) {
      const q = query.toLowerCase();
      filteredResults = q ? candidates.filter((c) => c.searchText.includes(q)) : candidates;
      resultsEl.innerHTML = filteredResults.slice(0, 20).map((c, i) => `
        <button type="button" data-index="${i}"
                class="w-full text-left px-2 py-1.5 text-sm hover:bg-slate-100 ${c.type !== 'person' ? 'font-medium text-indigo-700' : ''}">
          ${escapeHtml(c.label)}
        </button>
      `).join('');
      resultsEl.querySelectorAll('[data-index]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedTarget = filteredResults[Number(btn.dataset.index)];
          recipientSelectedEl.textContent = `${t('inbox.composeTo')}: ${selectedTarget.label}`;
          resultsEl.innerHTML = '';
          searchEl.value = '';
        });
      });
    }

    searchEl.addEventListener('input', () => renderResults(searchEl.value.trim()));

    sendBtn.addEventListener('click', async () => {
      const body = bodyEl.value.trim();
      if (!selectedTarget) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('inbox.noRecipient');
        return;
      }
      if (!body) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('inbox.emptyBody');
        return;
      }

      // Only broadcasts (whole-department or admins-only targets) get a
      // confirmation — an individual message is already a deliberate,
      // multi-step action (search, select, type, click) with a much
      // smaller blast radius if clicked by accident.
      if (selectedTarget.type !== 'person') {
        if (!(await confirmDialog({ message: t('inbox.confirmBroadcast', { target: selectedTarget.label }), confirmLabel: t('inbox.send'), danger: false }))) return;
      }

      sendBtn.disabled = true;
      statusEl.className = 'text-sm text-slate-500';
      statusEl.textContent = t('common.saving');

      let recipientIds;
      if (selectedTarget.type === 'person') {
        recipientIds = [selectedTarget.id];
      } else {
        let membershipQuery = supabase
          .from('department_memberships')
          .select('user_id')
          .eq('department_id', selectedTarget.departmentId)
          .eq('status', 'approved');
        if (selectedTarget.type === 'department-admins') membershipQuery = membershipQuery.in('role', ['admin', 'secretary']);

        const { data, error: fetchError } = await membershipQuery;
        if (fetchError) {
          sendBtn.disabled = false;
          statusEl.className = 'text-sm text-rose-600';
          statusEl.textContent = t('inbox.sendFailed', { message: fetchError.message });
          return;
        }
        recipientIds = (data || []).map((r) => r.user_id).filter((id) => id !== currentUserId);
      }

      if (recipientIds.length === 0) {
        sendBtn.disabled = false;
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('inbox.noRecipient');
        return;
      }

      const rows = recipientIds.map((id) => ({ sender_id: currentUserId, recipient_id: id, body }));
      const { error } = await supabase.from('direct_messages').insert(rows);

      sendBtn.disabled = false;
      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('inbox.sendFailed', { message: error.message });
        return;
      }

      composeEl.classList.add('hidden');
      loadMessages();
    });
  }

  async function loadMessages() {
    messagesListEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('direct_messages')
      .select('id, body, created_at, read_at, sender_id, recipient_id, sender:profiles!sender_id ( full_name ), recipient:profiles!recipient_id ( full_name )')
      .or(`sender_id.eq.${currentUserId},recipient_id.eq.${currentUserId}`)
      .order('created_at', { ascending: false });

    if (error) {
      messagesListEl.innerHTML = `<p class="text-sm text-rose-600">${t('inbox.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      messagesListEl.innerHTML = `<p class="text-sm text-slate-500">${t('inbox.noMessages')}</p>`;
      return;
    }

    messagesListEl.innerHTML = data.map((m) => {
      const isReceived = m.recipient_id === currentUserId;
      const unread = isReceived && !m.read_at;
      const who = isReceived
        ? `${t('inbox.from')}: ${m.sender?.full_name || ''}`
        : `${t('inbox.to')}: ${m.recipient?.full_name || ''}`;
      return `
        <div class="border rounded-lg p-3 ${unread ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'}">
          <div class="text-xs font-semibold text-slate-500">${escapeHtml(who)}</div>
          <p class="text-sm text-slate-700 mt-1 whitespace-pre-wrap">${escapeHtml(m.body)}</p>
          <div class="flex items-center justify-between mt-2">
            <div class="text-xs text-slate-400">${escapeHtml(formatDate(m.created_at))}</div>
            ${isReceived ? `
              <button type="button" data-action="reply" data-sender-id="${m.sender_id}" data-sender-name="${escapeHtml(m.sender?.full_name || '')}"
                      class="text-xs font-medium text-indigo-600 hover:text-indigo-800">
                ${t('inbox.reply')}
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    messagesListEl.querySelectorAll('[data-action="reply"]').forEach((btn) => {
      btn.addEventListener('click', () => replyTo(btn.dataset.senderId, btn.dataset.senderName));
    });

    const unreadIds = data.filter((m) => m.recipient_id === currentUserId && !m.read_at).map((m) => m.id);
    if (unreadIds.length > 0) {
      await supabase.from('direct_messages').update({ read_at: new Date().toISOString() }).in('id', unreadIds);
      onRead?.();
    }
  }

  // Read-only broadcasts -- RLS (can_read_department()) already scopes
  // this to departments the signed-in person can actually see, same as
  // js/components/homeWidgets.js's own Announcements widget, so no
  // extra department filtering is needed client-side. No read/unread
  // tracking exists for these (department_announcements has no
  // read_at column) -- they just always list, same as that widget.
  async function loadAnnouncements() {
    announcementsPanelEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('department_announcements')
      .select('id, title, body, created_at, department:departments!department_id ( name ), author:profiles!created_by ( full_name )')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      announcementsPanelEl.innerHTML = `<p class="text-sm text-rose-600">${t('inbox.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      announcementsPanelEl.innerHTML = `<p class="text-sm text-slate-500">${t('inbox.noAnnouncements')}</p>`;
      return;
    }

    announcementsPanelEl.innerHTML = data.map((a) => `
      <div class="border border-slate-200 rounded-lg p-3">
        <div class="text-xs font-semibold text-slate-500">${escapeHtml(a.department?.name || '')} · ${escapeHtml(a.author?.full_name || '')}</div>
        <div class="font-medium text-slate-800 mt-1">${escapeHtml(a.title)}</div>
        ${a.body ? `<p class="text-sm text-slate-600 mt-1 whitespace-pre-wrap">${escapeHtml(a.body)}</p>` : ''}
        <div class="text-xs text-slate-400 mt-2">${escapeHtml(formatDate(a.created_at))}</div>
      </div>
    `).join('');
  }

  function open() {
    composeEl.classList.add('hidden');
    activateTab('messages');
    root.classList.remove('hidden');
    root.classList.add('flex');
    loadMessages();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
