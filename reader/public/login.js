import { installGridMotion } from './grid-motion.js';

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.currentTarget.querySelector('button');
  const error = document.querySelector('#login-error');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'signing in…';
  form.setAttribute('aria-busy', 'true');
  error.textContent = '';
  const values = Object.fromEntries(new FormData(form));
  let navigating = false;

  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) });
    if (response.ok) {
      navigating = true;
      location.href = '/';
      return;
    }
    error.textContent = response.status === 429
      ? 'too many sign-in attempts. wait a few minutes and try again.'
      : 'that username or password did not match.';
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

installGridMotion();
