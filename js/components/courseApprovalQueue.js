// Leader (School Admin) verification queue. Four sections: pending +
// rejected course_enrollments (sql/070/073 — gate on starting a
// course at all, decided via review_course_enrollment(); a rejected
// one can be approved directly here without the student re-requesting
// first), unanswered course_questions
// (sql/071, answered via answer_course_question()), pending
// course_approvals (completion sign-off, expandable to that student's
// per-lesson quiz scores, decided via review_course_approval()), and a
// short history of already-decided completions. Every review_*/
// answer_* RPC is security definer, is_school_admin()-gated again
// server-side.
import { confirmDialog } from './confirmDialog.js';
import { t, formatDate } from '../i18n.js';

export function renderCourseApprovalQueue(container, { supabase }) {
  load();

  async function load() {
    container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const [{ data: pending, error: pendingError }, { data: decided }, { data: enrollments, error: enrollError }, { data: questions, error: questionsError }] = await Promise.all([
      supabase.from('course_approvals').select('id, user_id, course_id, created_at, student:profiles!user_id ( full_name ), course:courses!course_id ( title )').eq('status', 'pending').order('created_at'),
      supabase.from('course_approvals').select('id, user_id, course_id, status, approved_at, student:profiles!user_id ( full_name ), course:courses!course_id ( title )').neq('status', 'pending').order('approved_at', { ascending: false }).limit(20),
      supabase.from('course_enrollments').select('id, user_id, course_id, status, requested_at, student:profiles!user_id ( full_name ), course:courses!course_id ( title )').in('status', ['pending', 'rejected']).order('requested_at'),
      supabase.from('course_questions').select('id, question_text, created_at, student:profiles!user_id ( full_name ), course:courses!course_id ( title )').is('answer_text', null).order('created_at'),
    ]);

    if (pendingError || enrollError || questionsError) {
      container.innerHTML = `<p class="text-sm text-rose-600">${t('courses.loadFailed', { message: (pendingError || enrollError || questionsError).message })}</p>`;
      return;
    }

    container.innerHTML = `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('courses.enrollmentRequests')}</h2>
        <div data-el="enrollments"></div>
      </div>
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('courses.courseQuestions')}</h2>
        <div data-el="questions"></div>
      </div>
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('courses.pendingApprovals')}</h2>
        <div data-el="pending"></div>
      </div>
      <div class="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 class="text-lg font-semibold mb-4">${t('courses.recentDecisions')}</h2>
        <div data-el="decided"></div>
      </div>
    `;

    renderEnrollments(container.querySelector('[data-el="enrollments"]'), enrollments || []);
    renderQuestions(container.querySelector('[data-el="questions"]'), questions || []);
    renderPending(container.querySelector('[data-el="pending"]'), pending || []);
    renderDecided(container.querySelector('[data-el="decided"]'), decided || []);
  }

  function renderEnrollments(el, rows) {
    if (rows.length === 0) {
      el.innerHTML = `<p class="text-sm text-slate-500">${t('courses.noEnrollmentRequests')}</p>`;
      return;
    }

    el.innerHTML = '';
    rows.forEach((row) => {
      const isRejected = row.status === 'rejected';
      const card = document.createElement('div');
      card.className = 'flex items-center justify-between gap-3 border border-slate-200 rounded-lg p-3 mb-2';
      card.innerHTML = `
        <span>
          <span class="font-medium text-slate-800">${escapeHtml(row.student?.full_name || '—')}</span>
          <span class="text-sm text-slate-500"> — ${escapeHtml(row.course?.title || '—')}</span>
          ${isRejected ? `<span class="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">${t('courses.statusRejected')}</span>` : ''}
        </span>
        <div class="flex items-center gap-2 shrink-0">
          <button type="button" data-action="approve" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">${t('courses.approveEnrollment')}</button>
          ${!isRejected ? `<button type="button" data-action="reject" class="px-3 py-1.5 rounded-lg text-rose-600 text-xs font-medium hover:bg-rose-50">${t('courses.rejectEnrollment')}</button>` : ''}
        </div>
      `;
      card.querySelector('[data-action="approve"]').addEventListener('click', () => decideEnrollment(row, 'approved', card));
      card.querySelector('[data-action="reject"]')?.addEventListener('click', () => decideEnrollment(row, 'rejected', card));
      el.appendChild(card);
    });
  }

  async function decideEnrollment(row, status, card) {
    const confirmed = await confirmDialog({
      message: t(status === 'approved' ? 'courses.confirmApprove' : 'courses.confirmReject', { name: row.student?.full_name || '', course: row.course?.title || '' }),
      confirmLabel: t(status === 'approved' ? 'courses.approveEnrollment' : 'courses.rejectEnrollment'),
      danger: status === 'rejected',
    });
    if (!confirmed) return;

    const { error } = await supabase.rpc('review_course_enrollment', { p_enrollment_id: row.id, p_status: status });
    if (error) {
      window.alert(t('courses.saveFailed', { message: error.message }));
      return;
    }
    card.remove();
  }

  function renderQuestions(el, rows) {
    if (rows.length === 0) {
      el.innerHTML = `<p class="text-sm text-slate-500">${t('courses.noUnansweredQuestions')}</p>`;
      return;
    }

    el.innerHTML = '';
    rows.forEach((row) => {
      const card = document.createElement('div');
      card.className = 'border border-slate-200 rounded-lg p-3 mb-2';
      card.innerHTML = `
        <div class="text-sm">
          <span class="font-medium text-slate-800">${escapeHtml(row.student?.full_name || '—')}</span>
          <span class="text-slate-500"> — ${escapeHtml(row.course?.title || '—')}</span>
        </div>
        <p class="text-sm text-slate-700 mt-1">${escapeHtml(row.question_text)}</p>
        <div class="flex gap-2 mt-2">
          <input type="text" data-el="answer-input" placeholder="${t('courses.answerPlaceholder')}" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          <button type="button" data-action="reply" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 whitespace-nowrap">${t('courses.reply')}</button>
        </div>
        <p data-el="reply-status" class="text-xs text-rose-600 mt-1"></p>
      `;

      card.querySelector('[data-action="reply"]').addEventListener('click', async () => {
        const input = card.querySelector('[data-el="answer-input"]');
        const answerText = input.value.trim();
        if (!answerText) return;

        const { error } = await supabase.rpc('answer_course_question', { p_question_id: row.id, p_answer_text: answerText });
        if (error) {
          card.querySelector('[data-el="reply-status"]').textContent = t('courses.replyFailed', { message: error.message });
          return;
        }
        card.remove();
      });

      el.appendChild(card);
    });
  }

  function renderPending(el, rows) {
    if (rows.length === 0) {
      el.innerHTML = `<p class="text-sm text-slate-500">${t('courses.noPendingApprovals')}</p>`;
      return;
    }

    el.innerHTML = '';
    rows.forEach((row) => {
      const card = document.createElement('div');
      card.className = 'border border-slate-200 rounded-lg p-3 mb-2';
      card.innerHTML = `
        <button type="button" data-action="toggle" class="w-full flex items-center justify-between text-left">
          <span>
            <span class="font-medium text-slate-800">${escapeHtml(row.student?.full_name || '—')}</span>
            <span class="text-sm text-slate-500"> — ${escapeHtml(row.course?.title || '—')}</span>
          </span>
          <span class="text-xs text-slate-400">${escapeHtml(formatDate(row.created_at))}</span>
        </button>
        <div data-el="detail" class="hidden mt-3 pt-3 border-t border-slate-100">
          <p class="text-sm text-slate-500">${t('common.loading')}</p>
        </div>
      `;

      const detailEl = card.querySelector('[data-el="detail"]');
      let loaded = false;
      card.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
        detailEl.classList.toggle('hidden');
        if (!loaded && !detailEl.classList.contains('hidden')) {
          loaded = true;
          await renderScores(detailEl, row);
        }
      });

      el.appendChild(card);
    });
  }

  async function renderScores(el, row) {
    const { data: modules } = await supabase.from('course_modules').select('id, title, position').eq('course_id', row.course_id).order('position');
    const moduleIds = (modules || []).map((m) => m.id);
    const { data: lessons } = moduleIds.length > 0
      ? await supabase.from('lessons').select('id, title, position, module_id').in('module_id', moduleIds).order('position')
      : { data: [] };
    const lessonIds = (lessons || []).map((l) => l.id);
    const { data: progress } = lessonIds.length > 0
      ? await supabase.from('lesson_progress').select('lesson_id, quiz_score, quiz_attempts, completed').eq('user_id', row.user_id).in('lesson_id', lessonIds)
      : { data: [] };
    const progressByLesson = new Map((progress || []).map((p) => [p.lesson_id, p]));
    // lessons.position resets to 0 within each module, so ordering by
    // it alone (as the query above does) interleaves modules for any
    // course with more than one — rank by each lesson's module's
    // position first, then its own position within that module.
    const modulePositionById = new Map((modules || []).map((m, idx) => [m.id, idx]));
    const orderedLessons = [...(lessons || [])].sort((a, b) => {
      const moduleDiff = (modulePositionById.get(a.module_id) ?? 0) - (modulePositionById.get(b.module_id) ?? 0);
      return moduleDiff !== 0 ? moduleDiff : a.position - b.position;
    });

    el.innerHTML = `
      <div data-el="lesson-scores" class="mb-3"></div>
      <div class="flex items-center gap-3">
        <button type="button" data-action="approve" class="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">${t('courses.approve')}</button>
        <button type="button" data-action="reject" class="px-4 py-2 rounded-lg text-rose-600 text-sm font-medium hover:bg-rose-50">${t('courses.reject')}</button>
        <span data-el="status" class="text-sm text-slate-500"></span>
      </div>
    `;

    const scoresEl = el.querySelector('[data-el="lesson-scores"]');
    orderedLessons.forEach((l) => {
      const p = progressByLesson.get(l.id);
      const scoreText = p?.quiz_score != null ? t('courses.scoreOutOf10', { score: p.quiz_score }) : t('courses.noQuiz');
      const lessonRow = document.createElement('div');
      lessonRow.className = 'flex items-center justify-between text-sm py-1';
      lessonRow.innerHTML = `
        <span class="text-slate-600">${escapeHtml(l.title)}</span>
        <span class="flex items-center gap-2">
          <span class="${p?.completed ? 'text-emerald-600' : 'text-slate-400'}">${p?.completed ? '✓ ' : ''}${escapeHtml(scoreText)}</span>
          ${p ? `<button type="button" class="text-xs font-medium text-rose-600 hover:text-rose-800">${t('moderation.resetProgress')}</button>` : ''}
        </span>
      `;
      if (p) {
        lessonRow.querySelector('button').addEventListener('click', async () => {
          const confirmed = await confirmDialog({ message: t('moderation.confirmResetProgress', { name: row.student?.full_name || '', title: l.title }) });
          if (!confirmed) return;
          const { error } = await supabase.from('lesson_progress').delete().eq('user_id', row.user_id).eq('lesson_id', l.id);
          if (error) {
            window.alert(t('moderation.deleteFailed', { message: error.message }));
            return;
          }
          renderScores(el, row);
        });
      }
      scoresEl.appendChild(lessonRow);
    });

    el.querySelector('[data-action="approve"]').addEventListener('click', () => decide(row, 'approved', el));
    el.querySelector('[data-action="reject"]').addEventListener('click', () => decide(row, 'rejected', el));
  }

  async function decide(row, status, el) {
    const confirmed = await confirmDialog({
      message: t(status === 'approved' ? 'courses.confirmApprove' : 'courses.confirmReject', { name: row.student?.full_name || '', course: row.course?.title || '' }),
      confirmLabel: t(status === 'approved' ? 'courses.approve' : 'courses.reject'),
      danger: status === 'rejected',
    });
    if (!confirmed) return;

    const { error } = await supabase.rpc('review_course_approval', { p_approval_id: row.id, p_status: status });
    const statusEl = el.querySelector('[data-el="status"]');
    if (error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('courses.saveFailed', { message: error.message });
      return;
    }
    load();
  }

  function renderDecided(el, rows) {
    if (rows.length === 0) {
      el.innerHTML = `<p class="text-sm text-slate-500">${t('courses.noDecisions')}</p>`;
      return;
    }
    el.innerHTML = rows.map((row) => `
      <div class="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
        <span>
          <span class="font-medium text-slate-700">${escapeHtml(row.student?.full_name || '—')}</span>
          <span class="text-slate-500"> — ${escapeHtml(row.course?.title || '—')}</span>
        </span>
        <span class="text-xs px-2 py-0.5 rounded-full ${row.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">
          ${row.status === 'approved' ? t('courses.statusApproved') : t('courses.statusRejected')}
        </span>
      </div>
    `).join('');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
