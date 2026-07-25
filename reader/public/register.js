import { installGridMotion } from './grid-motion.js';

const form = document.querySelector('#register-form');
const button = form.querySelector('button[type="submit"]');
const error = document.querySelector('#register-error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'registering…';
  form.setAttribute('aria-busy', 'true');
  error.textContent = '';
  let navigating = false;
  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    if (response.ok) {
      navigating = true;
      location.href = '/login.html?registered=1';
      return;
    }
    let message = '';
    try { message = (await response.json())?.message || ''; } catch {}
    if (response.status === 429) message = 'too many attempts. wait a few minutes and try again.';
    else if (response.status === 401) message = 'account details did not match.';
    error.textContent = message || 'could not register.';
  } catch {
    error.textContent = 'could not reach the library. check your connection and try again.';
  } finally {
    if (!navigating) {
      button.disabled = false;
      button.textContent = originalLabel;
      form.removeAttribute('aria-busy');
    }
  }
});

fetch('/api/auth-capabilities')
  .then((response) => response.ok ? response.json() : null)
  .then((capabilities) => {
    if (capabilities?.registration === true) return;
    button.disabled = true;
    error.textContent = 'registration is not available.';
  })
  .catch(() => {
    button.disabled = true;
    error.textContent = 'registration is not available.';
  });

installGridMotion();
