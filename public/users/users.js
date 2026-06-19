// Users page: add, list, edit, and delete users via the /api/users endpoints.

const form = document.getElementById('user-form');
const formTitle = document.getElementById('form-title');
const submitBtn = document.getElementById('submit-btn');
const cancelBtn = document.getElementById('cancel-btn');
const formMsg = document.getElementById('form-msg');
const idField = document.getElementById('user-id');
const rowsEl = document.getElementById('user-rows');
const emptyEl = document.getElementById('users-empty');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function setMessage(text, kind) {
  formMsg.textContent = text || '';
  formMsg.className = 'form-msg' + (kind ? ` ${kind}` : '');
}

// Switch the form between "add" and "edit" modes.
function enterEditMode(user) {
  idField.value = user.id;
  form.first_name.value = user.first_name;
  form.last_name.value = user.last_name;
  form.email.value = user.email;
  formTitle.textContent = `Edit user #${user.id}`;
  submitBtn.textContent = 'Save changes';
  cancelBtn.hidden = false;
  setMessage('');
  form.first_name.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  form.reset();
  idField.value = '';
  formTitle.textContent = 'Add user';
  submitBtn.textContent = 'Add user';
  cancelBtn.hidden = true;
  setMessage('');
}

async function loadUsers() {
  const users = await fetch('/api/users').then((r) => r.json());
  emptyEl.hidden = users.length > 0;
  rowsEl.innerHTML = users.map((u) => `
    <tr data-id="${u.id}">
      <td>${escapeHtml(u.first_name)}</td>
      <td>${escapeHtml(u.last_name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td class="actions-col">
        <button class="link-btn" data-action="edit">Edit</button>
        <button class="link-btn danger" data-action="delete">Delete</button>
      </td>
    </tr>`).join('');
  // Stash the user objects on the rows for quick edit access.
  rowsEl.querySelectorAll('tr').forEach((tr) => {
    tr._user = users.find((u) => String(u.id) === tr.dataset.id);
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = idField.value;
  const payload = {
    first_name: form.first_name.value,
    last_name: form.last_name.value,
    email: form.email.value,
  };
  const res = await fetch(id ? `/api/users/${id}` : '/api/users', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    resetForm();
    setMessage(id ? 'User updated.' : 'User added.', 'success');
    await loadUsers();
  } else {
    const { error } = await res.json().catch(() => ({}));
    setMessage(error || 'Something went wrong.', 'error');
  }
});

cancelBtn.addEventListener('click', resetForm);

// Event delegation for the per-row Edit / Delete buttons.
rowsEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const tr = btn.closest('tr');
  const user = tr._user;
  if (btn.dataset.action === 'edit') {
    enterEditMode(user);
  } else if (btn.dataset.action === 'delete') {
    if (!confirm(`Delete ${user.first_name} ${user.last_name}?`)) return;
    const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
    if (res.ok) {
      if (idField.value === String(user.id)) resetForm();
      await loadUsers();
    } else {
      setMessage('Failed to delete user.', 'error');
    }
  }
});

loadUsers();
