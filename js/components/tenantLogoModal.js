// Per-tenant logo upload — Super Admin only. Free for every tenant
// regardless of plan/trial (not gated behind an entitlement, per product
// decision — see sql/saas_platform/09_tenant_logo.sql). Uploads to the
// tenant-logos bucket under {tenant_id}/, then points tenants.logo_url at
// it; app.js's applyTenantLogo() re-reads that after this modal closes.
import { t } from '../i18n.js';
import {
  loadMyDenominationInfo, getMyExtensions, isGlobalSuperAdminForAnyDenomination,
  isGlobalSuperAdminForDenomination, createChurchExtension, grantDenominationRoleByEmail,
} from '../denominationExtensions.js';

const BUCKET = 'tenant-logos';
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

export function createTenantLogoModal({ supabase, tenantId, userId, onSaved, onExtensionCreated }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('logo.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const [{ data, error }] = await Promise.all([
      supabase.from('tenants').select('name, logo_url, address, email, phone, denomination_id').eq('id', tenantId).single(),
      loadMyDenominationInfo(userId),
    ]);
    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('logo.failedToLoad', { message: error.message })}</p>`;
      return;
    }
    render(data?.name || '', data?.logo_url || null, data?.address || '', data?.email || '', data?.phone || '', data?.denomination_id || null);
  }

  function render(name, logoUrl, address, email, phone, denominationId) {
    bodyEl.innerHTML = '';

    // Only name and logo_url are self-service on this table (see
    // sql/saas_platform/09_tenant_logo.sql's own RLS + trigger-guard
    // comment) -- status/trial_ends_at/plan_id/slug stay off-limits.
    // The URL slug is deliberately never derived from this again after
    // signup, so renaming here never changes anyone's login link.
    const nameSection = document.createElement('div');
    nameSection.className = 'mb-6 pb-6 border-b border-slate-200';
    nameSection.innerHTML = `
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('logo.nameLabel')}</label>
      <input type="text" data-el="name-input" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" value="${escapeAttr(name)}" />
      <p data-el="name-status" class="text-sm mb-2"></p>
      <button type="button" data-action="save-name" class="w-full px-4 py-2 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-800 disabled:opacity-50">
        ${t('logo.saveNameButton')}
      </button>
    `;
    bodyEl.appendChild(nameSection);
    const nameInput = nameSection.querySelector('[data-el="name-input"]');
    const nameStatusEl = nameSection.querySelector('[data-el="name-status"]');
    const saveNameBtn = nameSection.querySelector('[data-action="save-name"]');
    saveNameBtn.addEventListener('click', () => saveName(nameInput, nameStatusEl, saveNameBtn));

    if (logoUrl) {
      const preview = document.createElement('img');
      preview.src = logoUrl;
      preview.alt = '';
      preview.className = 'w-20 h-20 rounded-lg object-cover mb-4 border border-slate-200';
      bodyEl.appendChild(preview);
    } else {
      const empty = document.createElement('p');
      empty.className = 'text-sm text-slate-500 mb-4';
      empty.textContent = t('logo.noLogo');
      bodyEl.appendChild(empty);
    }

    const section = document.createElement('div');
    section.innerHTML = `
      <label class="block text-sm font-medium text-slate-600 mb-1">${t(logoUrl ? 'logo.replaceLabel' : 'logo.uploadLabel')}</label>
      <input type="file" data-el="file-input" accept="image/png,image/jpeg,image/svg+xml,image/webp" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" />
      <p class="text-xs text-slate-400 mb-2">${t('logo.hint')}</p>
      <p data-el="upload-status" class="text-sm mb-2"></p>
      <button type="button" data-action="upload" class="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
        ${t(logoUrl ? 'logo.replaceButton' : 'logo.uploadButton')}
      </button>
    `;
    bodyEl.appendChild(section);

    const fileInput = section.querySelector('[data-el="file-input"]');
    const statusEl = section.querySelector('[data-el="upload-status"]');
    const uploadBtn = section.querySelector('[data-action="upload"]');
    uploadBtn.addEventListener('click', () => uploadFile(fileInput, statusEl, uploadBtn));

    // Address printed on the Budget PDF export (budgetPdf.js); email/
    // phone feed send-booking-email's per-tenant reply-to and footer
    // text so a guest's reply reaches the actual church, not the
    // platform. All three saved together under one "Contact Info"
    // action -- separate from the logo upload, which has its own.
    const contactSection = document.createElement('div');
    contactSection.className = 'mt-6 pt-6 border-t border-slate-200';
    contactSection.innerHTML = `
      <h3 class="text-sm font-semibold text-slate-700 mb-2">${t('logo.contactInfoTitle')}</h3>
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('logo.addressLabel')}</label>
      <textarea data-el="address-input" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" placeholder="${t('logo.addressPlaceholder')}">${escapeHtml(address)}</textarea>
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('logo.emailLabel')}</label>
      <input type="email" data-el="email-input" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" placeholder="${t('logo.emailPlaceholder')}" value="${escapeAttr(email)}" />
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('logo.phoneLabel')}</label>
      <input type="tel" data-el="phone-input" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" placeholder="${t('logo.phonePlaceholder')}" value="${escapeAttr(phone)}" />
      <p data-el="address-status" class="text-sm mb-2"></p>
      <button type="button" data-action="save-address" class="w-full px-4 py-2 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-800 disabled:opacity-50">
        ${t('logo.saveAddressButton')}
      </button>
    `;
    bodyEl.appendChild(contactSection);

    const addressInput = contactSection.querySelector('[data-el="address-input"]');
    const emailInput = contactSection.querySelector('[data-el="email-input"]');
    const phoneInput = contactSection.querySelector('[data-el="phone-input"]');
    const addressStatusEl = contactSection.querySelector('[data-el="address-status"]');
    const saveAddressBtn = contactSection.querySelector('[data-action="save-address"]');
    saveAddressBtn.addEventListener('click', () => saveContactInfo(addressInput, emailInput, phoneInput, addressStatusEl, saveAddressBtn));

    renderExtensions(denominationId);
  }

  // Church Extensions -- lets the caller group several independent
  // tenants under one Central Church and hand out cross-extension
  // roles. See js/denominationExtensions.js and
  // sql/saas_platform/34-36_church_extensions*.sql. The URL slug
  // create_church_extension() needs internally is generated from the
  // name (see slugify() below) -- not every church has a domain/URL
  // concept in mind, so it's never shown as a field here.
  function renderExtensions(denominationId) {
    const section = document.createElement('div');
    section.className = 'mt-6 pt-6 border-t border-slate-200';
    bodyEl.appendChild(section);

    if (!denominationId) {
      // First-time bootstrap: this tenant isn't linked to a Central
      // Church yet. Creating the first extension here both makes this
      // tenant the Central Church and grants the caller
      // global_super_admin on it (create_church_extension defaults the
      // Central Church's name to this tenant's own name when none is
      // passed -- see 35_church_extensions_rpcs.sql).
      section.innerHTML = `
        <h3 class="text-sm font-semibold text-slate-700 mb-1">${t('extensions.startTitle')}</h3>
        <p class="text-xs text-slate-500 mb-3">${t('extensions.startIntro')}</p>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('extensions.extensionNameLabel')}</label>
        <input type="text" data-el="ext-name" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-1" />
        <p data-el="ext-status" class="text-sm mb-2"></p>
        <button type="button" data-action="create-extension" class="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
          ${t('extensions.createButton')}
        </button>
      `;
      const nameInput = section.querySelector('[data-el="ext-name"]');
      const statusEl = section.querySelector('[data-el="ext-status"]');
      const createBtn = section.querySelector('[data-action="create-extension"]');
      createBtn.addEventListener('click', () => createExtension(nameInput, statusEl, createBtn));
      return;
    }

    const extensions = getMyExtensions();
    const isGlobalSuperAdmin = isGlobalSuperAdminForDenomination(denominationId);

    const listHtml = extensions.length
      ? `<ul class="text-sm text-slate-700 space-y-1 mb-4">${extensions.map((e) => `
          <li class="flex items-center gap-2">
            <span>${escapeHtml(e.name)}</span>
            ${e.is_acting_as ? `<span class="text-xs text-indigo-600 font-medium">(${t('extensions.myExtension')})</span>` : ''}
          </li>`).join('')}</ul>`
      : `<p class="text-sm text-slate-500 mb-4">${t('extensions.noExtensionsYet')}</p>`;

    section.innerHTML = `
      <h3 class="text-sm font-semibold text-slate-700 mb-2">${t('extensions.listTitle')}</h3>
      ${listHtml}
    `;

    if (!isGlobalSuperAdmin) return;

    const addSection = document.createElement('div');
    addSection.innerHTML = `
      <h4 class="text-sm font-semibold text-slate-700 mb-2">${t('extensions.addExtensionTitle')}</h4>
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('extensions.extensionNameLabel')}</label>
      <input type="text" data-el="ext-name" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-1" />
      <p data-el="ext-status" class="text-sm mb-2"></p>
      <button type="button" data-action="create-extension" class="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 mb-6">
        ${t('extensions.createButton')}
      </button>
    `;
    section.appendChild(addSection);
    const nameInput = addSection.querySelector('[data-el="ext-name"]');
    const statusEl = addSection.querySelector('[data-el="ext-status"]');
    const createBtn = addSection.querySelector('[data-action="create-extension"]');
    createBtn.addEventListener('click', () => createExtension(nameInput, statusEl, createBtn));

    const grantSection = document.createElement('div');
    grantSection.innerHTML = `
      <h4 class="text-sm font-semibold text-slate-700 mb-1">${t('extensions.grantRoleTitle')}</h4>
      <p class="text-xs text-slate-500 mb-3">${t('extensions.grantRoleIntro')}</p>
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('extensions.emailLabel')}</label>
      <input type="email" data-el="grant-email" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" placeholder="${t('extensions.emailPlaceholder')}" />
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('extensions.roleLabel')}</label>
      <select data-el="grant-role" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2">
        <option value="general_overseer">${t('extensions.roleGeneralOverseer')}</option>
        <option value="general_secretary">${t('extensions.roleGeneralSecretary')}</option>
        <option value="global_super_admin">${t('extensions.roleGlobalSuperAdmin')}</option>
      </select>
      <p data-el="grant-status" class="text-sm mb-2"></p>
      <button type="button" data-action="grant-role" class="w-full px-4 py-2 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-800 disabled:opacity-50">
        ${t('extensions.grantButton')}
      </button>
    `;
    section.appendChild(grantSection);
    const emailInput = grantSection.querySelector('[data-el="grant-email"]');
    const roleSelect = grantSection.querySelector('[data-el="grant-role"]');
    const grantStatusEl = grantSection.querySelector('[data-el="grant-status"]');
    const grantBtn = grantSection.querySelector('[data-action="grant-role"]');
    grantBtn.addEventListener('click', () => grantRole(denominationId, emailInput, roleSelect, grantStatusEl, grantBtn));
  }

  async function createExtension(nameInput, statusEl, button) {
    const name = nameInput.value.trim();
    if (!name) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('extensions.nameRequired');
      return;
    }

    button.disabled = true;
    statusEl.className = 'text-sm text-slate-500 mb-2';
    statusEl.textContent = t('extensions.creating');

    // create_church_extension() needs a URL slug internally, but not
    // every church has a domain/URL in mind -- generated from the name
    // here instead of asking for one. On a collision (another tenant
    // already has that exact slug) this silently retries with a fresh
    // random suffix rather than surfacing "that URL is taken" for a
    // field the person never saw.
    const base = slugify(name) || 'church';
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = `${base}-${randomSlugSuffix()}`.slice(0, 32);
      const { error } = await createChurchExtension(supabase, name, slug, null);
      if (!error) {
        onExtensionCreated?.();
        return;
      }
      lastError = error;
      if (!/already taken/i.test(error.message)) break;
    }

    button.disabled = false;
    statusEl.className = 'text-sm text-rose-600 mb-2';
    statusEl.textContent = t('extensions.createFailed', { message: lastError.message });
  }

  async function grantRole(denominationId, emailInput, roleSelect, statusEl, button) {
    const email = emailInput.value.trim();
    if (!email) return;

    button.disabled = true;
    statusEl.className = 'text-sm text-slate-500 mb-2';
    statusEl.textContent = t('extensions.granting');

    const { error, member } = await grantDenominationRoleByEmail(supabase, denominationId, email, roleSelect.value);
    button.disabled = false;
    if (error) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = error.message === 'notFound' ? t('extensions.memberNotFound') : t('extensions.grantFailed', { message: error.message });
      return;
    }

    statusEl.className = 'text-sm text-emerald-600 mb-2';
    statusEl.textContent = t('extensions.grantSucceeded', { name: member.full_name });
    emailInput.value = '';
  }

  async function saveName(nameInput, statusEl, button) {
    const name = nameInput.value.trim();
    if (!name) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.nameRequired');
      return;
    }

    button.disabled = true;
    statusEl.className = 'text-sm text-slate-500 mb-2';
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.from('tenants').update({ name }).eq('id', tenantId);
    button.disabled = false;
    if (error) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.nameSaveFailed', { message: error.message });
      return;
    }

    statusEl.className = 'text-sm text-emerald-600 mb-2';
    statusEl.textContent = t('logo.nameSaved');
    onSaved?.();
  }

  async function saveContactInfo(addressInput, emailInput, phoneInput, statusEl, button) {
    const address = addressInput.value.trim() || null;
    const email = emailInput.value.trim() || null;
    const phone = phoneInput.value.trim() || null;

    button.disabled = true;
    statusEl.className = 'text-sm text-slate-500 mb-2';
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.from('tenants').update({ address, email, phone }).eq('id', tenantId);
    button.disabled = false;
    if (error) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.addressSaveFailed', { message: error.message });
      return;
    }

    statusEl.className = 'text-sm text-emerald-600 mb-2';
    statusEl.textContent = t('logo.addressSaved');
    onSaved?.();
  }

  async function uploadFile(fileInput, statusEl, button) {
    const file = fileInput.files?.[0];
    if (!file) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.noFileSelected');
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.invalidType');
      return;
    }
    if (file.size > MAX_BYTES) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.tooLarge');
      return;
    }

    button.disabled = true;
    statusEl.className = 'text-sm text-slate-500 mb-2';
    statusEl.textContent = t('logo.uploading');

    const ext = file.name.split('.').pop() || 'png';
    // Fixed filename (not timestamped, unlike help-docs/rules) — a logo
    // is meant to be one current image at a stable URL, not a versioned
    // history; upsert just replaces the object in place.
    const path = `${tenantId}/logo.${ext}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: true,
    });
    if (uploadError) {
      button.disabled = false;
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.uploadFailed', { message: uploadError.message });
      return;
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    // Cache-bust: the tenant-logos bucket is public and the filename is
    // stable (logo.png stays logo.png on replace), so without this every
    // browser that already cached the old image keeps showing it.
    const cacheBustedUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await supabase.from('tenants').update({ logo_url: cacheBustedUrl }).eq('id', tenantId);
    button.disabled = false;
    if (updateError) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.uploadFailed', { message: updateError.message });
      return;
    }

    onSaved?.(cacheBustedUrl);
    load();
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
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

// Mirrors authScreen.js's church-name-to-slug derivation for the main
// signup form -- create_church_extension() requires a URL slug
// internally, but it's never shown as a field here (see renderExtensions()).
function slugify(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function randomSlugSuffix() {
  return Math.random().toString(36).slice(2, 8);
}
