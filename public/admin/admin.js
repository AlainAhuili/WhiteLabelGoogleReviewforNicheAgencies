const KEY_STORAGE = 'reviewWidgetApiKey';
const $ = (id) => document.getElementById(id);

const LAYOUT_LABELS = { grid: 'Grid', carousel: 'Carousel', list: 'List', badge: 'Floating badge' };

let apiKey = '';
let agency = null;
let widgets = [];
let editingId = null; // null while creating a new widget

function readKey() {
  try {
    return sessionStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

function writeKey(value) {
  try {
    if (value) sessionStorage.setItem(KEY_STORAGE, value);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage unavailable (private mode); the key just won't survive a reload.
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    signOut();
    throw new Error('Your session expired. Please sign in again.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---- Auth -------------------------------------------------------------------

function showLogin() {
  $('app').hidden = true;
  $('login').hidden = false;
  $('api-key').focus();
}

function signOut() {
  apiKey = '';
  writeKey('');
  showLogin();
}

async function signIn(key) {
  apiKey = key;
  const data = await api('/me');
  writeKey(key);
  agency = data.agency;
  $('demo-badge').hidden = !data.demoMode;
  $('login').hidden = true;
  $('app').hidden = false;
  renderAgency();
  await loadWidgets();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    await signIn($('api-key').value.trim());
  } catch (err) {
    $('login-error').textContent = err.message === 'Your session expired. Please sign in again.'
      ? 'That API key is not valid.'
      : err.message;
  }
});

$('logout').addEventListener('click', signOut);

// ---- Branding -----------------------------------------------------------------

function renderAgency() {
  const b = agency.branding;
  $('agency-name').textContent = b.brandName || agency.name;
  const logo = $('brand-logo');
  logo.hidden = !b.logoUrl;
  if (b.logoUrl) logo.src = b.logoUrl;

  const form = $('branding-form');
  form.brandName.value = b.brandName;
  form.primaryColor.value = b.primaryColor;
  form.logoUrl.value = b.logoUrl;
  form.poweredByText.value = b.poweredByText;
  form.poweredByUrl.value = b.poweredByUrl;
  form.hidePoweredBy.checked = b.hidePoweredBy;
}

$('branding-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = $('branding-status');
  status.textContent = 'Saving…';
  try {
    const data = await api('/branding', {
      method: 'PUT',
      body: {
        brandName: form.brandName.value,
        primaryColor: form.primaryColor.value,
        logoUrl: form.logoUrl.value,
        poweredByText: form.poweredByText.value,
        poweredByUrl: form.poweredByUrl.value,
        hidePoweredBy: form.hidePoweredBy.checked,
      },
    });
    agency = data.agency;
    renderAgency();
    status.textContent = 'Saved.';
    if (editingId) renderPreview(editingId);
  } catch (err) {
    status.textContent = err.message;
  }
});

// ---- Widget list --------------------------------------------------------------

async function loadWidgets() {
  const data = await api('/widgets');
  widgets = data.widgets;
  renderWidgetList();
}

function renderWidgetList() {
  const list = $('widget-list');
  list.textContent = '';
  $('no-widgets').hidden = widgets.length > 0;

  for (const w of widgets) {
    const li = document.createElement('li');

    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = w.name || 'Untitled widget';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${LAYOUT_LABELS[w.layout]} · ${w.minRating}★+ · ${w.id}`;
    info.append(name, meta, googleUsageLine(w.googleUsage));

    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    const edit = document.createElement('button');
    edit.className = 'ghost';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => openEditor(w));
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'Delete';
    del.addEventListener('click', () => deleteWidget(w));
    buttons.append(edit, del);

    li.append(info, buttons);
    list.append(li);
  }
  updateRefreshButton();
}

function allowanceUsedUp(w) {
  if (!w.googleUsage) return false; // demo mode: nothing is counted
  const { requests, limit } = w.googleUsage;
  return Boolean(limit) && requests >= limit;
}

function googleUsageLine(usage) {
  if (!usage) return ''; // demo mode: nothing is counted
  const line = document.createElement('div');
  line.className = 'usage';
  line.textContent = usage.limit
    ? `Google requests this month: ${usage.requests} of ${usage.limit}`
    : `Google requests this month: ${usage.requests}`;
  if (usage.limit && usage.requests >= usage.limit) {
    line.classList.add('used-up');
    line.textContent += ". Limit reached: reviews won't update until next month.";
  }
  return line;
}

// Refreshing asks Google again, so it is unavailable once the allowance is used up.
function updateRefreshButton() {
  const w = widgets.find((x) => x.id === editingId);
  const usedUp = Boolean(w) && allowanceUsedUp(w);
  $('refresh-reviews').disabled = usedUp;
  $('refresh-reviews').title = usedUp
    ? 'This widget has used its Google requests for this month'
    : 'Fetch fresh reviews from Google';
}

async function deleteWidget(w) {
  if (!confirm(`Delete "${w.name || w.id}"? Sites embedding it will stop showing reviews.`)) return;
  try {
    await api(`/widgets/${w.id}`, { method: 'DELETE' });
    if (editingId === w.id) closeEditor();
    await loadWidgets();
  } catch (err) {
    alert(err.message);
  }
}

// ---- Editor -------------------------------------------------------------------

const form = $('widget-form');

function openEditor(w) {
  editingId = w ? w.id : null;
  updateRefreshButton();
  $('editor-title').textContent = w ? `Edit: ${w.name || w.id}` : 'New widget';
  $('form-error').textContent = '';
  $('place-results').textContent = '';
  $('place-query').value = '';

  form.name.value = w?.name ?? '';
  form.placeId.value = w?.placeId ?? '';
  form.layout.value = w?.layout ?? 'grid';
  form.theme.value = w?.theme ?? 'light';
  form.minRating.value = String(w?.minRating ?? 4);
  form.maxReviews.value = String(w?.maxReviews ?? 5);
  form.showReviewButton.checked = w?.showReviewButton ?? true;
  $('use-brand-color').checked = !w?.accentColor;
  form.accentColor.value = w?.accentColor || agency.branding.primaryColor;
  form.accentColor.disabled = $('use-brand-color').checked;

  $('editor').hidden = false;
  if (w) showOutput(w);
  else $('widget-output').hidden = true;
  $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  editingId = null;
  $('editor').hidden = true;
  $('preview').textContent = '';
}

$('new-widget').addEventListener('click', () => openEditor(null));
$('close-editor').addEventListener('click', closeEditor);
$('use-brand-color').addEventListener('change', (e) => {
  form.accentColor.disabled = e.target.checked;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('form-error').textContent = '';
  const body = {
    name: form.name.value,
    placeId: form.placeId.value,
    layout: form.layout.value,
    theme: form.theme.value,
    minRating: Number(form.minRating.value),
    maxReviews: Number(form.maxReviews.value),
    showReviewButton: form.showReviewButton.checked,
    accentColor: $('use-brand-color').checked ? '' : form.accentColor.value,
  };
  try {
    const data = editingId
      ? await api(`/widgets/${editingId}`, { method: 'PATCH', body })
      : await api('/widgets', { method: 'POST', body });
    editingId = data.widget.id;
    $('editor-title').textContent = `Edit: ${data.widget.name || data.widget.id}`;
    await loadWidgets();
    showOutput(data.widget);
  } catch (err) {
    $('form-error').textContent = err.message;
  }
});

// Place search

$('place-search').addEventListener('click', searchPlaces);
$('place-query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchPlaces();
  }
});

async function searchPlaces() {
  const q = $('place-query').value.trim();
  const results = $('place-results');
  if (!q) return;
  results.textContent = '';
  const button = $('place-search');
  button.disabled = true;
  try {
    const { places } = await api(`/places/search?q=${encodeURIComponent(q)}`);
    if (!places.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'No matches. Try adding the city.';
      results.append(li);
    }
    for (const p of places) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      const title = document.createElement('strong');
      title.textContent = p.name;
      const detail = document.createElement('small');
      const rating = p.rating != null ? `${p.rating}★ (${p.userRatingCount}) · ` : '';
      detail.textContent = rating + p.address;
      btn.append(title, detail);
      btn.addEventListener('click', () => {
        form.placeId.value = p.placeId;
        if (!form.name.value) form.name.value = p.name;
        results.textContent = '';
      });
      li.append(btn);
      results.append(li);
    }
  } catch (err) {
    $('form-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

// Output: embed code, review link and preview

function showOutput(w) {
  $('embed-code').textContent = w.embedCode;
  $('review-link').textContent = w.reviewLink;
  $('widget-output').hidden = false;
  renderPreview(w.id);
}

function renderPreview(id) {
  const old = $('preview').firstChild;
  if (old) old.remove();
  // A fresh host element so the widget re-fetches and re-renders from scratch.
  const host = document.createElement('div');
  $('preview').append(host);
  window.ReviewWidget.mount(host, id, { fresh: true }).then(() => loadWidgets().catch(() => {}));
}

$('refresh-reviews').addEventListener('click', async () => {
  if (!editingId) return;
  try {
    await api(`/widgets/${editingId}/refresh`, { method: 'POST' });
    renderPreview(editingId);
  } catch (err) {
    alert(err.message);
  }
});

document.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-copy]');
  if (!target) return;
  const text = $(target.dataset.copy).textContent;
  try {
    await navigator.clipboard.writeText(text);
    target.textContent = 'Copied!';
    setTimeout(() => (target.textContent = 'Copy'), 1500);
  } catch {
    prompt('Copy this:', text);
  }
});

// ---- Boot -----------------------------------------------------------------------

const saved = readKey();
if (saved) {
  signIn(saved).catch(showLogin);
} else {
  showLogin();
}
