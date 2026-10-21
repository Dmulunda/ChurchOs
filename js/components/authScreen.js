// Login / sign-up card. On success, supabase.auth's session change fires
// and app.js's onAuthStateChange listener swaps the auth screen for the app.
import { t, departmentLabel } from '../i18n.js';
import { DEPARTMENT_KEYS, requestDepartmentMemberships } from '../departments.js';
import { createPlanPickerModal } from './planPickerModal.js';
import { markInteractiveSignIn } from '../utils/authIntent.js';
import { extractFunctionErrorMessage } from '../utils/edgeFunctionError.js';

export function renderAuthScreen(container, { supabase }) {
  let mode = 'login';
  // Resolved (async, below) from a ?join=<slug> URL param via the
  // anon-callable get_tenant_by_slug() RPC — the one place a pre-auth
  // visitor can read anything about a tenant at all, and deliberately
  // returns only { id, name, slug, allow_self_signup }, nothing sensitive.
  // The plain "Sign Up" tab stays hidden unless this resolves to a real,
  // self-signup-enabled church: without a link, there is no way for this
  // form to know which tenant a new account should join, and guessing
  // wrong isn't an option (see js/components/userCreatorModal.js's fix
  // for why a missing tenant_id fails outright, not silently).
  let inviteTenant = null;

  container.innerHTML = `
    <div class="w-full max-w-md">
      <div class="flex justify-center mb-6">
        <img src="img/church-on-point-logo.png" alt="${t('app.brand')}" class="h-24 w-auto drop-shadow-md rounded-xl" />
      </div>

      <div class="bg-white rounded-xl shadow-xl overflow-hidden">
        <div class="h-1.5 bg-gradient-to-r from-[#0B1F3A] via-[#D4AF37] to-[#0B1F3A]"></div>

        <div class="p-6 sm:p-8">
          <h1 class="text-2xl font-bold text-center mb-1 text-[#0B1F3A]">${t('app.brand')}</h1>
          <p class="text-center text-slate-500 text-sm mb-6">${t('auth.subtitle')}</p>

          <div data-el="main-panel">
            <div class="flex mb-6 rounded-lg bg-slate-100 p-1">
              <button type="button" data-mode="login"
                      class="flex-1 py-1.5 rounded-md text-sm font-medium transition-colors">${t('auth.signIn')}</button>
              <button type="button" data-mode="signup" data-el="signup-tab"
                      class="hidden flex-1 py-1.5 rounded-md text-sm font-medium transition-colors">
                <span data-el="signup-tab-label">${t('auth.signUp')}</span>
              </button>
              <button type="button" data-mode="new-church"
                      class="flex-1 py-1.5 rounded-md text-sm font-medium transition-colors">${t('auth.newChurch')}</button>
            </div>

            <!-- Only shown when arriving via a ?join=<slug> link whose
                 church has turned self-signup off (js/tenant-invite
                 resolution below). -->
            <p data-el="signup-disabled-note" class="hidden text-sm text-amber-700 bg-amber-50 rounded-lg p-3 mb-4"></p>

            <form data-el="form" class="space-y-4">
              <div data-el="church-fields" class="hidden space-y-4">
                <div>
                  <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.churchName')}</label>
                  <input type="text" name="church_name" autocomplete="organization" class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.churchSlug')}</label>
                  <input type="text" name="church_slug" pattern="[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?" class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
                  <p class="text-xs text-slate-400 mt-1">${t('auth.churchSlugHint')}</p>
                </div>
              </div>

              <div data-el="full-name-field" class="hidden">
                <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.fullName')}</label>
                <input type="text" name="full_name" autocomplete="name" class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
              </div>

              <div data-el="silent-match" class="hidden text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p data-el="silent-match-question"></p>
                <div class="flex gap-2 mt-2">
                  <button type="button" data-action="silent-match-yes" class="px-3 py-1.5 rounded-lg bg-[#0B1F3A] text-white text-xs font-medium">${t('auth.silentMatchYes')}</button>
                  <button type="button" data-action="silent-match-no" class="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 text-xs font-medium">${t('auth.silentMatchNo')}</button>
                </div>
                <p data-el="silent-match-confirmed" class="hidden text-emerald-700 mt-2"></p>
              </div>

              <div data-el="departments-field" class="hidden">
                <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.joinDepartments')}</label>
                <div class="grid grid-cols-2 gap-1.5 border border-slate-300 rounded-lg p-2 max-h-40 overflow-y-auto text-sm">
                  ${DEPARTMENT_KEYS.map((key) => `
                    <label class="flex items-center gap-1.5">
                      <input type="checkbox" value="${key}" data-dept-checkbox />
                      <span>${departmentLabel(key)}</span>
                    </label>
                  `).join('')}
                </div>
                <p class="text-xs text-slate-400 mt-1">${t('auth.joinDepartmentsHint')}</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.email')}</label>
                <input type="email" name="email" required autocomplete="username" class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.password')}</label>
                <input type="password" name="password" required minlength="6" autocomplete="current-password"
                       class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
              </div>

              <p data-el="status" class="text-sm"></p>

              <button type="submit" data-el="submit-btn"
                      class="w-full py-2 rounded-lg bg-[#0B1F3A] text-white font-medium hover:bg-[#0a1628] disabled:opacity-50 transition-colors">
                ${t('auth.signIn')}
              </button>

              <button type="button" data-action="show-forgot"
                      data-el="forgot-link"
                      class="w-full text-center text-sm text-slate-500 hover:text-[#0B1F3A]">
                ${t('auth.forgotPassword')}
              </button>
            </form>
          </div>

          <div data-el="forgot-panel" class="hidden space-y-4">
            <h2 class="text-lg font-semibold text-[#0B1F3A]">${t('auth.resetTitle')}</h2>
            <p class="text-sm text-slate-500">${t('auth.resetIntro')}</p>

            <form data-el="forgot-form" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.email')}</label>
                <input type="email" name="email" required autocomplete="email" class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
              </div>

              <p data-el="forgot-status" class="text-sm"></p>

              <button type="submit" data-el="forgot-submit-btn"
                      class="w-full py-2 rounded-lg bg-[#0B1F3A] text-white font-medium hover:bg-[#0a1628] disabled:opacity-50 transition-colors">
                ${t('auth.sendResetLink')}
              </button>
              <button type="button" data-action="show-main"
                      class="w-full text-center text-sm text-slate-500 hover:text-[#0B1F3A]">
                ${t('auth.backToSignIn')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  const modeButtons = container.querySelectorAll('[data-mode]');
  const signupTabEl = container.querySelector('[data-el="signup-tab"]');
  const signupTabLabelEl = container.querySelector('[data-el="signup-tab-label"]');
  const signupDisabledNoteEl = container.querySelector('[data-el="signup-disabled-note"]');
  const churchFields = container.querySelector('[data-el="church-fields"]');
  const fullNameField = container.querySelector('[data-el="full-name-field"]');
  const departmentsField = container.querySelector('[data-el="departments-field"]');
  const silentMatchEl = container.querySelector('[data-el="silent-match"]');
  const silentMatchQuestionEl = container.querySelector('[data-el="silent-match-question"]');
  const silentMatchConfirmedEl = container.querySelector('[data-el="silent-match-confirmed"]');
  const form = container.querySelector('[data-el="form"]');
  const statusEl = container.querySelector('[data-el="status"]');
  const submitBtn = container.querySelector('[data-el="submit-btn"]');

  const mainPanel = container.querySelector('[data-el="main-panel"]');
  const forgotPanel = container.querySelector('[data-el="forgot-panel"]');
  const forgotForm = container.querySelector('[data-el="forgot-form"]');
  const forgotStatusEl = container.querySelector('[data-el="forgot-status"]');
  const forgotSubmitBtn = container.querySelector('[data-el="forgot-submit-btn"]');

  function setMode(next) {
    mode = next;
    modeButtons.forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('bg-white', active);
      btn.classList.toggle('shadow', active);
      btn.classList.toggle('text-[#0B1F3A]', active);
      btn.classList.toggle('text-slate-500', !active);
    });
    const isSignup = mode === 'signup';
    const isNewChurch = mode === 'new-church';
    churchFields.classList.toggle('hidden', !isNewChurch);
    form.elements.church_name.required = isNewChurch;
    form.elements.church_slug.required = isNewChurch;
    fullNameField.classList.toggle('hidden', !isSignup && !isNewChurch);
    fullNameField.querySelector('input').required = isSignup || isNewChurch;
    departmentsField.classList.toggle('hidden', !isSignup);
    submitBtn.textContent = isNewChurch ? t('auth.startTrial') : isSignup ? t('auth.createAccount') : t('auth.signIn');
    container.querySelector('[data-el="forgot-link"]').classList.toggle('hidden', mode !== 'login');
    // The email/password fields are shared between all three modes, so the
    // autocomplete hint has to switch too — "current-password" tells a
    // mobile browser's password manager to offer a saved credential,
    // "new-password" tells it to offer generating/saving a fresh one.
    // Getting this wrong is a common reason autofill/"remember me"
    // silently doesn't work on phones even though it works on desktop.
    form.elements.email.autocomplete = isSignup || isNewChurch ? 'email' : 'username';
    form.elements.password.autocomplete = isSignup || isNewChurch ? 'new-password' : 'current-password';
    statusEl.textContent = '';
    silentMatchEl.classList.add('hidden');
    silentMatchConfirmedEl.classList.add('hidden');
  }

  modeButtons.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
  // ?mode=new-church lets the marketing site's "Get Started" CTA land
  // straight on the sign-up-a-new-church tab instead of the login tab.
  const requestedMode = new URLSearchParams(window.location.search).get('mode');
  setMode(requestedMode === 'new-church' ? 'new-church' : 'login');

  const joinSlug = new URLSearchParams(window.location.search).get('join');
  if (joinSlug) {
    supabase.rpc('get_tenant_by_slug', { p_slug: joinSlug }).then(({ data, error }) => {
      const tenant = !error && data?.[0] ? data[0] : null;
      if (!tenant) return; // unknown slug -- stay on the no-signup-tab default, fail quietly
      if (!tenant.allow_self_signup) {
        signupDisabledNoteEl.textContent = t('auth.selfSignupDisabled', { church: tenant.name });
        signupDisabledNoteEl.classList.remove('hidden');
        return;
      }
      inviteTenant = tenant;
      signupTabLabelEl.textContent = t('auth.joinChurch', { church: tenant.name });
      signupTabEl.classList.remove('hidden');
      setMode('signup');
    });
  }

  // Auto-derives the URL slug from the church name as it's typed, but only
  // until the person edits the slug field directly themselves — matches
  // the common "title -> auto-slug, but stop clobbering it once they've
  // customized it" pattern.
  let slugTouched = false;
  form.elements.church_slug.addEventListener('input', () => { slugTouched = true; });
  form.elements.church_name.addEventListener('input', () => {
    if (slugTouched) return;
    form.elements.church_slug.value = form.elements.church_name.value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
  });

  // Only in 'signup' mode -- 'new-church' creates a brand-new tenant
  // with nobody in it yet, nothing to match against. Confirming "yes"
  // only remembers which Silent record was matched; the actual upgrade
  // (and its server-side corroboration check) happens at submit time,
  // once email/password are known -- see handleSubmit().
  let confirmedSilentMatch = null;
  let silentMatchTimeout = null;
  form.elements.full_name.addEventListener('input', () => {
    confirmedSilentMatch = null;
    silentMatchEl.classList.add('hidden');
    silentMatchConfirmedEl.classList.add('hidden');
    if (mode !== 'signup') return;
    clearTimeout(silentMatchTimeout);
    const name = form.elements.full_name.value.trim();
    if (!name) return;
    silentMatchTimeout = setTimeout(async () => {
      const { data } = await supabase.rpc('find_silent_user_match', {
        p_full_name: name,
        ...(inviteTenant ? { p_tenant_id: inviteTenant.id } : {}),
      });
      const match = Array.isArray(data) && data[0];
      if (!match || form.elements.full_name.value.trim() !== name) return;
      silentMatchQuestionEl.textContent = t('auth.silentMatchQuestion', { name: match.full_name });
      silentMatchEl.dataset.matchId = match.id;
      silentMatchEl.dataset.matchName = match.full_name;
      silentMatchEl.classList.remove('hidden');
    }, 300);
  });

  silentMatchEl.querySelector('[data-action="silent-match-yes"]').addEventListener('click', () => {
    confirmedSilentMatch = { id: silentMatchEl.dataset.matchId, name: silentMatchEl.dataset.matchName };
    silentMatchConfirmedEl.textContent = t('auth.silentMatchConfirmed', { name: confirmedSilentMatch.name });
    silentMatchConfirmedEl.classList.remove('hidden');
  });
  silentMatchEl.querySelector('[data-action="silent-match-no"]').addEventListener('click', () => {
    confirmedSilentMatch = null;
    silentMatchEl.classList.add('hidden');
  });

  container.querySelector('[data-action="show-forgot"]').addEventListener('click', () => {
    mainPanel.classList.add('hidden');
    forgotPanel.classList.remove('hidden');
    forgotStatusEl.textContent = '';
    forgotForm.reset();
  });

  container.querySelector('[data-action="show-main"]').addEventListener('click', () => {
    forgotPanel.classList.add('hidden');
    mainPanel.classList.remove('hidden');
  });

  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = forgotForm.elements.email.value.trim();

    forgotSubmitBtn.disabled = true;
    forgotStatusEl.className = 'text-sm text-slate-500';
    forgotStatusEl.textContent = t('auth.sendingReset');

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });

    forgotSubmitBtn.disabled = false;

    if (error) {
      forgotStatusEl.className = 'text-sm text-rose-600';
      forgotStatusEl.textContent = t('auth.resetFailed', { message: error.message });
      return;
    }

    forgotStatusEl.className = 'text-sm text-emerald-600';
    forgotStatusEl.textContent = t('auth.resetEmailSent');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;

    submitBtn.disabled = true;
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = mode === 'new-church' ? t('auth.creatingChurch') : mode === 'signup' ? t('auth.creatingAccount') : t('auth.signingIn');

    if (mode === 'new-church') {
      const churchName = form.elements.church_name.value.trim();
      const churchSlug = form.elements.church_slug.value.trim().toLowerCase();
      const fullName = form.elements.full_name.value.trim();

      // tenants has no client-facing INSERT policy by design (see
      // sql/saas_platform/01_schema.sql) -- this RPC is the one controlled
      // path through that, and it must run *before* signUp() so the new
      // tenant's id can travel in as signup metadata for handle_new_user()
      // to pick up (see sql/saas_platform/03_signup_rpcs.sql).
      const { data: tenantId, error: tenantError } = await supabase.rpc('create_tenant_for_signup', {
        p_name: churchName,
        p_slug: churchSlug,
      });

      if (tenantError) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = tenantError.message;
        submitBtn.disabled = false;
        return;
      }

      markInteractiveSignIn();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, tenant_id: tenantId } },
      });

      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = error.message;
      } else if (!data.session) {
        statusEl.className = 'text-sm text-emerald-600';
        statusEl.textContent = t('auth.accountCreatedCheckEmail');
      } else {
        // Best-effort: claim_tenant_admin() only ever succeeds once, for
        // whoever's account is still role-less in a brand new tenant --
        // see sql/saas_platform/03_signup_rpcs.sql. If app.js's own
        // auth-state listener happens to render before this resolves,
        // it'll catch up on the next profile refresh.
        const { error: claimError } = await supabase.rpc('claim_tenant_admin');
        if (claimError) console.error('claim_tenant_admin failed:', claimError.message);
        // onAuthStateChange in app.js takes over the screen underneath
        // from here, same as always -- the plan picker is just an
        // overlay on top of it. Skipping (or Stripe Checkout itself
        // being cancelled) leaves them in the app exactly like before
        // this existed: a real, cardless trial they can subscribe from
        // anytime via Plans & Pricing.
        createPlanPickerModal({ supabase, onSkip: () => {} }).open();
      }
    } else if (mode === 'signup') {
      if (!inviteTenant) {
        // Shouldn't be reachable -- the tab is hidden without a resolved
        // invite -- but signUp() would otherwise fail on a missing
        // tenant_id with a confusing raw database error, so fail clearly.
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('auth.noInvite');
        submitBtn.disabled = false;
        return;
      }
      const fullName = form.elements.full_name.value.trim();
      const selectedDepartments = Array.from(form.querySelectorAll('[data-dept-checkbox]:checked')).map((cb) => cb.value);
      markInteractiveSignIn();

      if (confirmedSilentMatch) {
        const { data: upgradeData, error: upgradeError } = await supabase.functions.invoke('upgrade-silent-user', {
          body: { silent_profile_id: confirmedSilentMatch.id, claimed_full_name: fullName, email, password },
        });
        if (upgradeError) {
          statusEl.className = 'text-sm text-rose-600';
          statusEl.textContent = await extractFunctionErrorMessage(upgradeError);
          submitBtn.disabled = false;
          return;
        }
        if (upgradeData.status === 'pending_review') {
          statusEl.className = 'text-sm text-emerald-600';
          statusEl.textContent = t('auth.silentClaimPendingReview');
          submitBtn.disabled = false;
          return;
        }
        // The Edge Function updates auth.users server-side -- it doesn't
        // sign this browser in, so a normal password sign-in finishes
        // the job, same as the 'login' branch below.
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          statusEl.className = 'text-sm text-rose-600';
          statusEl.textContent = signInError.message;
        } else {
          await requestDepartmentMemberships(upgradeData.profile_id, selectedDepartments);
        }
        submitBtn.disabled = false;
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, tenant_id: inviteTenant.id } },
      });

      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = error.message;
      } else if (!data.session) {
        // Email confirmation is required, so there's no session yet to
        // file membership requests under — they'll need to select
        // departments again after confirming and logging in.
        statusEl.className = 'text-sm text-emerald-600';
        statusEl.textContent = t('auth.accountCreatedCheckEmail');
      } else {
        await requestDepartmentMemberships(data.user.id, selectedDepartments);
        // onAuthStateChange in app.js takes over from here.
      }
    } else {
      markInteractiveSignIn();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = error.message;
      }
    }

    submitBtn.disabled = false;
  });
}
