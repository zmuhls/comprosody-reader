try {
  const saved = localStorage.getItem('readings-theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.dataset.theme = saved;
    document.documentElement.style.colorScheme = saved;
  }
} catch {}
