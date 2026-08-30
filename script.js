let newWorker;

// רישום ה-Service Worker ובדיקת גרסה חדשה
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateNotification();
        }
      });
    });
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

// פונקציה להצגת הדיאלוג העליון
function showUpdateNotification() {
  const modal = document.getElementById('update-modal');
  if (modal) {
    modal.classList.add('active');
  }
}

// סגירת הדיאלוג העליון
function closeUpdateNotification() {
  const modal = document.getElementById('update-modal');
  if (modal) {
    modal.classList.remove('active');
  }
}

// ביצוע העדכון והרענון
function applyAppUpdate() {
  if (newWorker) {
    newWorker.postMessage({ action: 'skipWaiting' });
  } else if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ action: 'skipWaiting' });
      } else {
        window.location.reload(true);
      }
    });
  } else {
    window.location.reload(true);
  }
}
