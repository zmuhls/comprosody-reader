import { installGridMotion } from './grid-motion.js';

const loginForm = document.querySelector('#login-form');
const resetForm = document.querySelector('#reset-form');
const resetOpen = document.querySelector('#reset-open');
const registerOpen = document.querySelector('#register-open');

function setFormBusy(form, busy, busyLabel) {
  const button = form.querySelector('button[type="submit"]');
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyLabel : button.dataset.label;
  if (busy) form.setAttribute('aria-busy', 'true');
  else form.removeAttribute('aria-busy');
}

async function postForm(form, endpoint, errorNode, busyLabel) {
  setFormBusy(form, true, busyLabel);
  errorNode.textContent = '';
  let navigating = false;
  try {
    const values = Object.fromEntries(new FormData(form));
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (response.ok) {
      if (endpoint === '/api/login') {
        navigating = true;
        location.href = '/';
        return;
      }
      let message = 'if the details matched, the password was updated. sign in.';
      try { message = (await response.json())?.message || message; } catch {}
      const username = form.elements.username.value;
      form.reset();
      resetForm.hidden = true;
      loginForm.hidden = false;
      loginForm.elements.username.value = username;
      document.querySelector('#login-status').textContent = message;
      loginForm.elements.password.focus();
      return;
    }
    let message = '';
    try { message = (await response.json())?.message || ''; } catch {}
    if (response.status === 429) message = 'too many attempts. wait a few minutes and try again.';
    else if (response.status === 401) message = endpoint === '/api/login'
      ? 'that username or password did not match.'
      : 'account details did not match.';
    errorNode.textContent = message || 'could not complete this request.';
  } catch {
    errorNode.textContent = 'could not reach the library. check your connection and try again.';
  } finally {
    if (!navigating) setFormBusy(form, false, busyLabel);
  }
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void postForm(loginForm, '/api/login', document.querySelector('#login-error'), 'signing in…');
});

resetForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void postForm(resetForm, '/api/reset-password', document.querySelector('#reset-error'), 'resetting…');
});

resetOpen.addEventListener('click', () => {
  loginForm.hidden = true;
  resetForm.hidden = false;
  resetForm.querySelector('input').focus();
});

document.querySelector('#reset-back').addEventListener('click', () => {
  resetForm.hidden = true;
  loginForm.hidden = false;
  document.querySelector('#reset-error').textContent = '';
  document.querySelector('#login-status').textContent = '';
  loginForm.querySelector('input').focus();
});

fetch('/api/auth-capabilities')
  .then((response) => response.ok ? response.json() : null)
  .then((capabilities) => {
    resetOpen.hidden = capabilities?.passwordReset !== true;
    registerOpen.hidden = capabilities?.registration !== true;
  })
  .catch(() => {});

if (new URLSearchParams(location.search).has('registered')) {
  document.querySelector('#login-status').textContent = 'if the details matched, the password was updated. sign in.';
  history.replaceState(null, '', '/login.html');
}

installGridMotion();
