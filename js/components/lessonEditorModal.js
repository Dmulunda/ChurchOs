// Lesson editor: title, video (uploaded file or an external YouTube/
// Vimeo link — either is supported), an optional PDF, and an optional
// fixed 10-question quiz (7 multiple-choice with 4 options each, then
// 3 true/false, in that order — matching the spec exactly, not an
// admin-configurable count). A lesson must already exist (real id)
// before video/PDF can be uploaded, since the storage path is keyed by
// lesson id — see courseBuilder.js, which creates the lesson row first.
import { t } from '../i18n.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabaseClient.js';
import { safeFileName } from '../utils/safeFileName.js';

const MC_COUNT = 7;
const TF_COUNT = 3;

export function createLessonEditorModal({ supabase, onSaved }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('courses.editLesson')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  let lesson = null;
  let quiz = null;
  let questions = [];

  async function open(lessonRow) {
    lesson = lessonRow;
    root.classList.remove('hidden');
    root.classList.add('flex');
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: quizRow } = await supabase.from('quizzes').select('id, passing_score').eq('lesson_id', lesson.id).maybeSingle();
    quiz = quizRow;
    if (quiz) {
      const { data: qs } = await supabase.from('quiz_questions').select('id, question_text, type, options, correct_answer, position').eq('quiz_id', quiz.id).order('position');
      questions = qs || [];
    } else {
      questions = [];
    }

    render();
  }

  function render() {
    const hasVideo = !!lesson.video_source;
    const hasQuiz = !!quiz;

    bodyEl.innerHTML = `
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('courses.lessonTitle')}</label>
      <input type="text" data-el="title" value="${escapeAttr(lesson.title)}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-4" />

      <div class="border border-slate-200 rounded-lg p-3 mb-4">
        <p class="text-sm font-semibold text-slate-700 mb-2">${t('courses.video')}</p>
        ${hasVideo ? `
          <p class="text-sm text-slate-600 mb-2">
            ${lesson.video_source === 'external' ? escapeHtml(lesson.video_url) : t('courses.videoUploaded')}
            <button type="button" data-action="remove-video" class="ml-2 text-rose-600 hover:text-rose-800 text-xs font-medium">${t('courses.remove')}</button>
          </p>
        ` : `
          <div class="flex gap-2 mb-2">
            <input type="url" data-el="video-url" placeholder="${t('courses.videoUrlPlaceholder')}" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button type="button" data-action="save-video-url" class="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">${t('courses.save')}</button>
          </div>
          <div class="flex items-center gap-2">
            <input type="file" data-el="video-file" accept="video/*" class="text-sm flex-1" />
            <button type="button" data-action="upload-video" class="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">${t('courses.upload')}</button>
          </div>
        `}
        <p data-el="video-status" class="text-xs text-slate-500 mt-1"></p>
      </div>

      <div class="border border-slate-200 rounded-lg p-3 mb-4">
        <p class="text-sm font-semibold text-slate-700 mb-2">${t('courses.pdf')}</p>
        ${lesson.pdf_storage_path ? `
          <p class="text-sm text-slate-600 mb-2">
            ${escapeHtml(lesson.pdf_file_name || '')}
            <button type="button" data-action="remove-pdf" class="ml-2 text-rose-600 hover:text-rose-800 text-xs font-medium">${t('courses.remove')}</button>
          </p>
        ` : `
          <div class="flex items-center gap-2">
            <input type="file" data-el="pdf-file" accept="application/pdf" class="text-sm flex-1" />
            <button type="button" data-action="upload-pdf" class="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">${t('courses.upload')}</button>
          </div>
        `}
        <p data-el="pdf-status" class="text-xs text-slate-500 mt-1"></p>
      </div>

      <div class="border border-slate-200 rounded-lg p-3 mb-4">
        <label class="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
          <input type="checkbox" data-el="has-quiz" ${hasQuiz ? 'checked' : ''} /> ${t('courses.hasQuiz')}
        </label>
        <div data-el="quiz-body" class="${hasQuiz ? '' : 'hidden'} space-y-3"></div>
      </div>

      <div class="flex items-center gap-3">
        <button type="button" data-action="save" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('courses.save')}</button>
        <span data-el="save-status" class="text-sm text-slate-500"></span>
      </div>
    `;

    wireVideoAndPdf();
    const hasQuizEl = bodyEl.querySelector('[data-el="has-quiz"]');
    const quizBodyEl = bodyEl.querySelector('[data-el="quiz-body"]');
    hasQuizEl.addEventListener('change', () => {
      quizBodyEl.classList.toggle('hidden', !hasQuizEl.checked);
      if (hasQuizEl.checked && quizBodyEl.innerHTML === '') renderQuizForm(quizBodyEl);
    });
    if (hasQuiz) renderQuizForm(quizBodyEl);

    bodyEl.querySelector('[data-action="save"]').addEventListener('click', saveAll);
  }

  function wireVideoAndPdf() {
    const videoStatusEl = bodyEl.querySelector('[data-el="video-status"]');
    const pdfStatusEl = bodyEl.querySelector('[data-el="pdf-status"]');

    bodyEl.querySelector('[data-action="remove-video"]')?.addEventListener('click', async () => {
      if (lesson.video_storage_path) {
        if (lesson.video_provider === 'r2') {
          await supabase.functions.invoke('course-video-r2', { body: { action: 'delete', object_key: lesson.video_storage_path } });
        } else {
          await supabase.storage.from('course-videos').remove([lesson.video_storage_path]);
        }
      }
      const { error } = await supabase.from('lessons').update({ video_source: null, video_url: null, video_storage_path: null, video_provider: 'supabase' }).eq('id', lesson.id);
      if (!error) { lesson.video_source = null; lesson.video_url = null; lesson.video_storage_path = null; lesson.video_provider = 'supabase'; render(); }
    });

    bodyEl.querySelector('[data-action="save-video-url"]')?.addEventListener('click', async () => {
      const url = bodyEl.querySelector('[data-el="video-url"]').value.trim();
      if (!url) return;
      videoStatusEl.textContent = t('common.saving');
      const { error } = await supabase.from('lessons').update({ video_source: 'external', video_url: url, video_storage_path: null }).eq('id', lesson.id);
      if (error) { videoStatusEl.textContent = t('courses.saveFailed', { message: error.message }); return; }
      lesson.video_source = 'external'; lesson.video_url = url; lesson.video_storage_path = null;
      render();
    });

    bodyEl.querySelector('[data-action="upload-video"]')?.addEventListener('click', async () => {
      const fileInput = bodyEl.querySelector('[data-el="video-file"]');
      const file = fileInput.files?.[0];
      if (!file) return;
      videoStatusEl.textContent = t('courses.uploading');

      // Lesson videos go to Cloudflare R2, not Supabase Storage —
      // R2 charges no egress fee, which matters once a video is
      // streamed by every enrolled student, possibly rewatched (see
      // sql/079). The edge function hands back a presigned URL; the
      // actual file bytes go straight from this browser to R2, never
      // through Supabase at all.
      const { data: urlData, error: urlError } = await supabase.functions.invoke('course-video-r2', {
        body: { action: 'upload_url', lesson_id: lesson.id, file_name: file.name, content_type: file.type },
      });
      if (urlError || urlData?.error) { videoStatusEl.textContent = t('courses.saveFailed', { message: urlData?.error || urlError.message }); return; }

      // fetch() has no upload-progress event, so a multi-GB file would
      // sit at a static "Uploading…" with no feedback for a long time —
      // XMLHttpRequest still supports the progress event fetch lacks.
      try {
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', urlData.upload_url);
          xhr.setRequestHeader('Content-Type', urlData.content_type);
          xhr.upload.addEventListener('progress', (e) => {
            // Use file.size rather than e.total: e.lengthComputable can
            // be false in some browser/proxy combinations even though
            // the size is already known client-side.
            videoStatusEl.textContent = `${t('courses.uploading')} ${Math.round((e.loaded / file.size) * 100)}%`;
          });
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
          });
          xhr.addEventListener('error', () => reject(new Error('Upload failed (network error)')));
          xhr.send(file);
        });
      } catch (uploadErr) {
        videoStatusEl.textContent = t('courses.saveFailed', { message: uploadErr.message });
        return;
      }

      const { error } = await supabase.from('lessons').update({ video_source: 'upload', video_storage_path: urlData.object_key, video_provider: 'r2', video_url: null }).eq('id', lesson.id);
      if (error) { videoStatusEl.textContent = t('courses.saveFailed', { message: error.message }); return; }
      lesson.video_source = 'upload'; lesson.video_storage_path = urlData.object_key; lesson.video_provider = 'r2'; lesson.video_url = null;
      render();
    });

    bodyEl.querySelector('[data-action="remove-pdf"]')?.addEventListener('click', async () => {
      if (lesson.pdf_storage_path) await supabase.storage.from('course-pdfs').remove([lesson.pdf_storage_path]);
      const { error } = await supabase.from('lessons').update({ pdf_storage_path: null, pdf_file_name: null }).eq('id', lesson.id);
      if (!error) { lesson.pdf_storage_path = null; lesson.pdf_file_name = null; render(); }
    });

    bodyEl.querySelector('[data-action="upload-pdf"]')?.addEventListener('click', async () => {
      const fileInput = bodyEl.querySelector('[data-el="pdf-file"]');
      const file = fileInput.files?.[0];
      if (!file) return;
      pdfStatusEl.textContent = t('courses.uploading');
      const path = `${lesson.id}/${Date.now()}-${safeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from('course-pdfs').upload(path, file);
      if (uploadError) { pdfStatusEl.textContent = t('courses.saveFailed', { message: uploadError.message }); return; }
      const { error } = await supabase.from('lessons').update({ pdf_storage_path: path, pdf_file_name: file.name }).eq('id', lesson.id);
      if (error) { pdfStatusEl.textContent = t('courses.saveFailed', { message: error.message }); return; }
      lesson.pdf_storage_path = path; lesson.pdf_file_name = file.name;
      render();
    });
  }

  function renderQuizForm(container) {
    const slots = [];
    for (let i = 0; i < MC_COUNT; i++) slots.push({ type: 'multiple_choice', existing: questions[i] });
    for (let i = 0; i < TF_COUNT; i++) slots.push({ type: 'true_false', existing: questions[MC_COUNT + i] });

    container.innerHTML = `
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('courses.passingScore')}</label>
        <input type="number" data-el="passing-score" min="0" max="10" value="${quiz?.passing_score ?? 8}" class="w-24 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div class="border border-dashed border-slate-300 rounded-lg p-3">
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('courses.generateFromText')}</label>
        <textarea data-el="generate-source" rows="4" placeholder="${t('courses.generateFromTextPlaceholder')}"
                  class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2"></textarea>
        <div class="flex items-center gap-3">
          <button type="button" data-action="generate-quiz"
                  class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('courses.generate')}
          </button>
          <span data-el="generate-status" class="text-sm text-slate-500"></span>
        </div>
      </div>
      ${slots.map((slot, i) => renderQuestionSlot(slot, i)).join('')}
    `;

    container.querySelector('[data-action="generate-quiz"]').addEventListener('click', () => generateQuiz(container));
  }

  async function generateQuiz(container) {
    const sourceText = container.querySelector('[data-el="generate-source"]').value.trim();
    const genBtn = container.querySelector('[data-action="generate-quiz"]');
    const genStatusEl = container.querySelector('[data-el="generate-status"]');

    if (!sourceText) {
      genStatusEl.className = 'text-sm text-rose-600';
      genStatusEl.textContent = t('courses.generateMissingText');
      return;
    }

    genBtn.disabled = true;
    genStatusEl.className = 'text-sm text-slate-500';
    genStatusEl.textContent = `${t('courses.generating')} 0%`;

    function fail(message) {
      genBtn.disabled = false;
      genStatusEl.className = 'text-sm text-rose-600';
      genStatusEl.textContent = t('courses.generateFailed', { message });
    }

    // A plain request/response has no way to show real progress for
    // something that takes many seconds — so this reads the AI's
    // response as it streams in (supabase.functions.invoke() can't
    // expose a streaming body, hence the raw fetch), counting how many
    // of the 10 questions have appeared so far to show real progress
    // rather than a fake animated bar.
    let response;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      response = await fetch(`${SUPABASE_URL}/functions/v1/generate-quiz`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ source_text: sourceText }),
      });
    } catch (err) {
      fail(err.message);
      return;
    }

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try { message = (await response.json())?.error || message; } catch { /* body wasn't JSON */ }
      fail(message);
      return;
    }

    let rawText = '';
    let streamError = null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // last line may be incomplete — carried into the next chunk
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          rawText += event.delta.text;
          const questionCount = (rawText.match(/"question_text"/g) || []).length;
          const percent = Math.min(100, Math.round((questionCount / (MC_COUNT + TF_COUNT)) * 100));
          genStatusEl.textContent = `${t('courses.generating')} ${percent}%`;
        } else if (event.type === 'error') {
          streamError = event.error?.message || 'Unknown streaming error';
        }
      }
    }

    genBtn.disabled = false;
    if (streamError) { fail(streamError); return; }

    let parsed;
    try {
      // Strip an accidental ```json fence, and any preamble/trailing
      // text outside the { }, in case the model adds either despite
      // the "no markdown, no commentary" instruction.
      let cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      parsed = JSON.parse(cleaned);
    } catch {
      fail('Could not parse the generated quiz. Try again.');
      return;
    }

    if (!Array.isArray(parsed.questions) || parsed.questions.length !== MC_COUNT + TF_COUNT) {
      fail('Generated quiz did not match the expected shape. Try again.');
      return;
    }

    fillGeneratedQuestions(container, parsed.questions);
    genStatusEl.className = 'text-sm text-emerald-600';
    genStatusEl.textContent = t('courses.generateDone');
  }

  // Writes straight into the already-rendered 10 slots (review/edit
  // still happens through the normal fields — Save is a separate,
  // deliberate step, same as filling the form in by hand).
  function fillGeneratedQuestions(container, generated) {
    const slotEls = Array.from(container.querySelectorAll('[data-question-slot]'));
    generated.forEach((q, i) => {
      const slotEl = slotEls[i];
      if (!slotEl) return;

      const textEl = slotEl.querySelector('[data-el="q-text"]');
      if (textEl) textEl.value = q.question_text || '';

      if (slotEl.dataset.questionType === 'multiple_choice') {
        const options = q.options || ['', '', '', ''];
        [0, 1, 2, 3].forEach((o) => {
          const optEl = slotEl.querySelector(`[data-el="q-option-${o}"]`);
          if (optEl) optEl.value = options[o] || '';
        });
        const correctIndex = options.findIndex((opt) => opt === q.correct_answer);
        const radio = correctIndex >= 0 ? slotEl.querySelector(`[data-el="q-correct"][value="${correctIndex}"]`) : null;
        if (radio) radio.checked = true;
      } else {
        const radio = slotEl.querySelector(q.correct_answer === 'true' ? '[data-el="q-true"]' : '[data-el="q-false"]');
        if (radio) radio.checked = true;
      }
    });
  }

  function renderQuestionSlot(slot, index) {
    const num = index + 1;
    const existing = slot.existing;
    if (slot.type === 'multiple_choice') {
      const options = existing?.options || ['', '', '', ''];
      return `
        <div class="border-t border-slate-200 pt-3" data-question-slot="${index}" data-question-type="multiple_choice">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('courses.questionN', { n: num })} (${t('courses.multipleChoice')})</label>
          <input type="text" data-el="q-text" value="${escapeAttr(existing?.question_text || '')}" placeholder="${t('courses.questionTextPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" />
          ${[0, 1, 2, 3].map((o) => `
            <div class="flex items-center gap-2 mb-1">
              <input type="radio" name="correct-${index}" data-el="q-correct" value="${o}" ${existing?.correct_answer === options[o] && options[o] ? 'checked' : ''} />
              <input type="text" data-el="q-option-${o}" value="${escapeAttr(options[o] || '')}" placeholder="${t('courses.optionN', { n: o + 1 })}" class="flex-1 border border-slate-300 rounded-lg px-2 py-1 text-sm" />
            </div>
          `).join('')}
        </div>
      `;
    }
    return `
      <div class="border-t border-slate-200 pt-3" data-question-slot="${index}" data-question-type="true_false">
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('courses.questionN', { n: num })} (${t('courses.trueFalse')})</label>
        <input type="text" data-el="q-text" value="${escapeAttr(existing?.question_text || '')}" placeholder="${t('courses.questionTextPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" />
        <div class="flex items-center gap-4 text-sm">
          <label class="flex items-center gap-1.5"><input type="radio" name="tf-${index}" data-el="q-true" value="true" ${existing?.correct_answer === 'true' ? 'checked' : ''} /> ${t('courses.true')}</label>
          <label class="flex items-center gap-1.5"><input type="radio" name="tf-${index}" data-el="q-false" value="false" ${existing?.correct_answer === 'false' ? 'checked' : ''} /> ${t('courses.false')}</label>
        </div>
      </div>
    `;
  }

  async function saveAll() {
    const statusEl = bodyEl.querySelector('[data-el="save-status"]');
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const title = bodyEl.querySelector('[data-el="title"]').value.trim();
    if (title && title !== lesson.title) {
      await supabase.from('lessons').update({ title }).eq('id', lesson.id);
      lesson.title = title;
    }

    const wantsQuiz = bodyEl.querySelector('[data-el="has-quiz"]').checked;

    if (!wantsQuiz) {
      if (quiz) await supabase.from('quizzes').delete().eq('id', quiz.id);
      quiz = null;
      statusEl.className = 'text-sm text-emerald-600';
      statusEl.textContent = t('courses.saved');
      onSaved?.();
      return;
    }

    const passingScore = Number(bodyEl.querySelector('[data-el="passing-score"]').value) || 8;
    const slotEls = Array.from(bodyEl.querySelectorAll('[data-question-slot]'));
    const built = slotEls.map((slotEl) => {
      const type = slotEl.dataset.questionType;
      const questionText = slotEl.querySelector('[data-el="q-text"]').value.trim();
      if (type === 'multiple_choice') {
        const options = [0, 1, 2, 3].map((o) => slotEl.querySelector(`[data-el="q-option-${o}"]`).value.trim());
        const correctIndex = slotEl.querySelector('[data-el="q-correct"]:checked')?.value;
        return { type, question_text: questionText, options, correct_answer: correctIndex !== undefined ? options[correctIndex] : '' };
      }
      const isTrue = slotEl.querySelector('[data-el="q-true"]')?.checked;
      const isFalse = slotEl.querySelector('[data-el="q-false"]')?.checked;
      return { type, question_text: questionText, options: null, correct_answer: isTrue ? 'true' : (isFalse ? 'false' : '') };
    });

    const incomplete = built.some((q) => !q.question_text || !q.correct_answer || (q.type === 'multiple_choice' && q.options.some((o) => !o)));
    if (incomplete) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('courses.quizIncomplete');
      return;
    }

    if (!quiz) {
      const { data, error } = await supabase.from('quizzes').insert({ lesson_id: lesson.id, passing_score: passingScore }).select('id, passing_score').single();
      if (error) { statusEl.className = 'text-sm text-rose-600'; statusEl.textContent = t('courses.saveFailed', { message: error.message }); return; }
      quiz = data;
    } else if (passingScore !== quiz.passing_score) {
      await supabase.from('quizzes').update({ passing_score: passingScore }).eq('id', quiz.id);
      quiz.passing_score = passingScore;
    }

    // Full replace is simplest/most reliable for a fixed 10-slot form.
    await supabase.from('quiz_questions').delete().eq('quiz_id', quiz.id);
    const { error: insertError } = await supabase.from('quiz_questions').insert(
      built.map((q, i) => ({ quiz_id: quiz.id, question_text: q.question_text, type: q.type, options: q.type === 'multiple_choice' ? q.options : null, correct_answer: q.correct_answer, position: i }))
    );

    if (insertError) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('courses.saveFailed', { message: insertError.message });
      return;
    }

    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('courses.saved');
    onSaved?.();
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

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
