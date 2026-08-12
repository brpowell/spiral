//! Minimal token-gated admin panel (embedded HTML).

pub const ADMIN_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>spk-registry admin</title>
  <style>
    :root {
      --bg: #141414;
      --surface: #1e1e1e;
      --border: #333;
      --text: #eee;
      --muted: #999;
      --accent: #6cb6ff;
      --danger: #f07178;
      --ok: #7fd962;
      --warn: #e6c07b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.45 ui-sans-serif, system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    main { max-width: 960px; margin: 0 auto; padding: 1.5rem; }
    h1 { font-size: 1.35rem; font-weight: 600; margin: 0 0 1rem; }
    h2 { font-size: 1.05rem; font-weight: 600; margin: 1.75rem 0 0.75rem; }
    section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.1rem;
      margin-bottom: 1rem;
    }
    label { display: block; color: var(--muted); font-size: 0.8rem; margin-bottom: 0.25rem; }
    input[type=text], input[type=password], input[type=file], textarea {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 6px;
      padding: 0.45rem 0.6rem;
      margin-bottom: 0.75rem;
    }
    textarea { min-height: 3.5rem; resize: vertical; }
    .row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
    button {
      background: var(--accent);
      color: #0b0b0b;
      border: 0;
      border-radius: 6px;
      padding: 0.45rem 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }
    button.secondary { background: transparent; color: var(--text); border: 1px solid var(--border); }
    button.danger { background: var(--danger); color: #111; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.45rem 0.35rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); font-weight: 500; }
    .muted { color: var(--muted); }
    .badge {
      display: inline-block;
      font-size: 0.72rem;
      padding: 0.1rem 0.4rem;
      border-radius: 999px;
      border: 1px solid var(--border);
    }
    .badge.yanked { color: var(--warn); border-color: var(--warn); }
    .badge.live { color: var(--ok); border-color: var(--ok); }
    #status {
      margin-top: 0.75rem;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
    }
    #status.err { color: var(--danger); }
    #status.ok { color: var(--ok); }
    .actions button { margin: 0.15rem 0.15rem 0.15rem 0; }
    dialog {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      padding: 1rem 1.2rem;
      max-width: 420px;
    }
    dialog::backdrop { background: rgba(0,0,0,0.55); }
  </style>
</head>
<body>
<main>
  <h1>spk-registry admin</h1>

  <section>
    <label for="token">Admin token</label>
    <div class="row">
      <input id="token" type="password" placeholder="ADMIN_TOKEN" autocomplete="off" style="flex:1" />
      <button type="button" class="secondary" id="saveToken">Save</button>
      <button type="button" id="refresh">Refresh list</button>
    </div>
    <p class="muted">Stored in sessionStorage only. Sent as <code>Authorization: Bearer …</code>.</p>
  </section>

  <section>
    <h2 style="margin-top:0">Upload pack</h2>
    <label for="spk">.spk archive</label>
    <input id="spk" type="file" accept=".spk,application/zip" />
    <p class="muted">Pack preview is taken from <code>pack.json</code> <code>preview</code> (or the first contribution preview when omitted) — no separate upload.</p>
    <button type="button" id="upload">Upload</button>
  </section>

  <section>
    <h2 style="margin-top:0">Published versions</h2>
    <div id="list"><p class="muted">Save a token and refresh.</p></div>
  </section>

  <div id="status"></div>
</main>

<dialog id="purgeDialog">
  <form method="dialog" id="purgeForm">
    <h2 style="margin-top:0">Purge (hard delete)</h2>
    <p class="muted" id="purgeHint"></p>
    <label for="purgeConfirm">Type confirm string</label>
    <input id="purgeConfirm" type="text" required autocomplete="off" />
    <label for="purgeReason">Reason</label>
    <textarea id="purgeReason" required></textarea>
    <div class="row">
      <button type="submit" class="danger" value="ok">Purge</button>
      <button type="submit" class="secondary" value="cancel" formnovalidate>Cancel</button>
    </div>
  </form>
</dialog>

<script>
const tokenEl = document.getElementById('token');
const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');
const dialog = document.getElementById('purgeDialog');
const purgeForm = document.getElementById('purgeForm');
const purgeHint = document.getElementById('purgeHint');
const purgeConfirm = document.getElementById('purgeConfirm');
const purgeReason = document.getElementById('purgeReason');

let pendingPurge = null;

tokenEl.value = sessionStorage.getItem('adminToken') || '';

function setStatus(msg, ok) {
  statusEl.textContent = msg || '';
  statusEl.className = ok === true ? 'ok' : ok === false ? 'err' : '';
}

function authHeaders(extra = {}) {
  const token = tokenEl.value.trim();
  if (!token) throw new Error('Admin token required');
  return { Authorization: 'Bearer ' + token, ...extra };
}

document.getElementById('saveToken').onclick = () => {
  sessionStorage.setItem('adminToken', tokenEl.value.trim());
  setStatus('Token saved in sessionStorage.', true);
};

async function api(path, opts = {}) {
  const headers = authHeaders(opts.headers || {});
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!res.ok) {
    const msg = (body && (body.message || body.code)) || res.statusText;
    throw new Error(res.status + ' ' + msg);
  }
  return body;
}

async function refresh() {
  setStatus('Loading…');
  const data = await api('/v1/admin/packs');
  const versions = data.versions || [];
  if (!versions.length) {
    listEl.innerHTML = '<p class="muted">No versions yet.</p>';
    setStatus('Empty catalog.', true);
    return;
  }
  const rows = versions.map(v => {
    const id = v.authorId + '/' + v.packId + '@' + v.version;
    const yanked = !!v.yankedAt;
    const badge = yanked
      ? '<span class="badge yanked">yanked</span>'
      : '<span class="badge live">live</span>';
    return '<tr>' +
      '<td>' +
        (v.previewUrl ? '<img src="' + v.previewUrl + '" alt="" width="32" height="32" style="border-radius:4px;vertical-align:middle;margin-right:0.5rem;object-fit:cover;background:#111" />' : '') +
        '<code>' + id + '</code><div class="muted">' + (v.contributionTypes || []).join(', ') + '</div></td>' +
      '<td>' + badge + '</td>' +
      '<td class="muted">' + (v.sizeBytes || 0) + ' B<br/><code style="font-size:0.7rem">' + (v.sha256 || '').slice(0, 12) + '…</code></td>' +
      '<td class="actions">' +
        (yanked
          ? '<button type="button" class="secondary" data-unyank="' + id + '">Unyank</button>'
          : '<button type="button" class="secondary" data-yank="' + id + '">Yank</button>') +
        '<button type="button" class="danger" data-purge-version="' + id + '">Purge version</button>' +
        '<button type="button" class="danger" data-purge-pack="' + v.authorId + '/' + v.packId + '">Purge pack</button>' +
      '</td></tr>';
  }).join('');
  listEl.innerHTML = '<table><thead><tr><th>Identity</th><th>Status</th><th>Artifact</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  setStatus('Loaded ' + versions.length + ' version(s).', true);

  listEl.querySelectorAll('[data-yank]').forEach(btn => {
    btn.onclick = async () => {
      const [authorId, rest] = btn.dataset.yank.split('/');
      const [packId, version] = rest.split('@');
      try {
        await api('/v1/admin/packs/' + authorId + '/' + packId + '/versions/' + version + '/yank', { method: 'POST' });
        setStatus('Yanked ' + btn.dataset.yank, true);
        await refresh();
      } catch (e) { setStatus(String(e.message || e), false); }
    };
  });

  listEl.querySelectorAll('[data-unyank]').forEach(btn => {
    btn.onclick = async () => {
      const [authorId, rest] = btn.dataset.unyank.split('/');
      const [packId, version] = rest.split('@');
      try {
        await api('/v1/admin/packs/' + authorId + '/' + packId + '/versions/' + version + '/unyank', { method: 'POST' });
        setStatus('Unyanked ' + btn.dataset.unyank, true);
        await refresh();
      } catch (e) { setStatus(String(e.message || e), false); }
    };
  });

  listEl.querySelectorAll('[data-purge-version]').forEach(btn => {
    btn.onclick = () => openPurge({
      confirm: btn.dataset.purgeVersion,
      path: (() => {
        const [authorId, rest] = btn.dataset.purgeVersion.split('/');
        const [packId, version] = rest.split('@');
        return '/v1/admin/packs/' + authorId + '/' + packId + '/versions/' + version + '/purge';
      })(),
    });
  });

  listEl.querySelectorAll('[data-purge-pack]').forEach(btn => {
    btn.onclick = () => openPurge({
      confirm: btn.dataset.purgePack,
      path: '/v1/admin/packs/' + btn.dataset.purgePack + '/purge',
    });
  });
}

function openPurge(target) {
  pendingPurge = target;
  purgeHint.textContent = 'This permanently deletes stored bytes. Confirm must be exactly: ' + target.confirm;
  purgeConfirm.value = '';
  purgeReason.value = '';
  dialog.returnValue = '';
  dialog.showModal();
}

// Capture field values on submit — method=dialog closes before a late reader is reliable.
purgeForm.addEventListener('submit', (e) => {
  const submitter = e.submitter;
  if (!pendingPurge || !submitter || submitter.value !== 'ok') return;
  pendingPurge.confirmValue = purgeConfirm.value.trim();
  pendingPurge.reasonValue = purgeReason.value.trim();
});

// `close` fires on <dialog>, not <form method="dialog">.
dialog.addEventListener('close', async () => {
  if (dialog.returnValue !== 'ok' || !pendingPurge) {
    pendingPurge = null;
    return;
  }
  const target = pendingPurge;
  pendingPurge = null;
  try {
    await api(target.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirm: target.confirmValue || '',
        reason: target.reasonValue || '',
      }),
    });
    setStatus('Purged ' + target.confirm, true);
    await refresh();
  } catch (e) {
    setStatus(String(e.message || e), false);
  }
});

document.getElementById('refresh').onclick = () => refresh().catch(e => setStatus(String(e.message || e), false));

document.getElementById('upload').onclick = async () => {
  const file = document.getElementById('spk').files[0];
  if (!file) { setStatus('Choose a .spk file first.', false); return; }
  const fd = new FormData();
  fd.append('spk', file);
  try {
    setStatus('Uploading…');
    const body = await api('/v1/admin/packs', { method: 'POST', body: fd });
    const previewNote = body.previewUrl ? ' · preview ' + body.previewUrl : '';
    setStatus('Published ' + body.authorId + '/' + body.packId + '@' + body.version + ' (sha256 ' + body.sha256.slice(0, 12) + '…)' + previewNote, true);
    await refresh();
  } catch (e) {
    setStatus(String(e.message || e), false);
  }
};

if (tokenEl.value.trim()) {
  refresh().catch(e => setStatus(String(e.message || e), false));
}
</script>
</body>
</html>
"#;
