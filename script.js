/*
 * Money Tracker - App Update Manager
 *
 * To release a new version:
 * 1. Change APP_VERSION in sw.js.
 * 2. Change "version" in version.json to the same value.
 *
 * User data is stored in localStorage (budget_app_v3) and is never cleared
 * by the update process.
 */

let newWorker = null;
let appRegistration = null;
let installedAppVersion = null;
let availableAppVersion = null;
let updateCheckInProgress = false;

const VERSION_URL = './version.json';

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '').split('-')[0];
}

function compareVersions(a, b) {
  const av = normalizeVersion(a).split('.').map(Number);
  const bv = normalizeVersion(b).split('.').map(Number);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const x = Number.isFinite(av[i]) ? av[i] : 0;
    const y = Number.isFinite(bv[i]) ? bv[i] : 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function setUpdateStatus(text, type = 'normal') {
  const el = document.getElementById('app-update-status');
  if (!el) return;
  el.textContent = text;
  el.className =
    'text-xs mt-1 ' +
    (type === 'success' ? 'text-emerald-400' :
     type === 'warning' ? 'text-amber-400' :
     type === 'error' ? 'text-rose-400' : 'text-gray-400');
}

function setCurrentVersion(version) {
  const el = document.getElementById('current-app-version');
  if (el) el.textContent = version ? `v${normalizeVersion(version)}` : '—';
}

function showUpdateButton(show) {
  const button = document.getElementById('check-app-update-btn');
  if (!button) return;
  button.classList.toggle('hidden', !show);
  if (show) {
    button.disabled = false;
    button.classList.remove('opacity-70');
    button.textContent = 'עדכן';
  }
}

function showUpdateNotification(version) {
  availableAppVersion = normalizeVersion(version);
  const notification = document.getElementById('update-notification');
  const versionEl = document.getElementById('update-version');

  if (versionEl) versionEl.textContent = `v${availableAppVersion}`;
  if (notification) notification.classList.add('active');

  showUpdateButton(true);
  setUpdateStatus(`גרסה חדשה זמינה: v${availableAppVersion}`, 'warning');

  if (window.lucide) lucide.createIcons();
}

function closeUpdateNotification() {
  const notification = document.getElementById('update-notification');
  if (notification) notification.classList.remove('active');
}

function getInstalledVersionFromServiceWorker() {
  if (!navigator.serviceWorker.controller) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 1500);

    const handler = (event) => {
      if (event.data?.action === 'version') {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('message', handler);
        resolve(normalizeVersion(event.data.version));
      }
    };

    navigator.serviceWorker.addEventListener('message', handler);
    navigator.serviceWorker.controller.postMessage({ action: 'getVersion' });
  });
}

async function fetchLatestVersion() {
  const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  const version = normalizeVersion(data.version);
  if (!version) throw new Error('Missing version');
  return version;
}

async function checkForAppUpdate({showResult = true} = {}) {
  if (updateCheckInProgress) return false;
  updateCheckInProgress = true;

  if (showResult) setUpdateStatus('בודק אם קיימת גרסה חדשה...');

  try {
    if ('serviceWorker' in navigator) {
      appRegistration =
        appRegistration || await navigator.serviceWorker.getRegistration('./');

      if (!appRegistration) {
        appRegistration = await navigator.serviceWorker.register('./sw.js');
      }

      await appRegistration.update();
    }

    const latest = await fetchLatestVersion();
    availableAppVersion = latest;

    if (!installedAppVersion) {
      installedAppVersion =
        normalizeVersion(localStorage.getItem('money_tracker_installed_version')) ||
        null;
    }

    if (installedAppVersion && compareVersions(latest, installedAppVersion) > 0) {
      showUpdateNotification(latest);
      return true;
    }

    if (showResult) {
      setUpdateStatus(`הגרסה שלך מעודכנת (v${latest})`, 'success');
    }
    showUpdateButton(false);
    return false;
  } catch (error) {
    console.warn('App update check failed:', error);
    if (showResult) {
      setUpdateStatus('לא ניתן לבדוק עדכונים כרגע. נסה שוב מאוחר יותר.', 'error');
    }
    return false;
  } finally {
    updateCheckInProgress = false;
  }
}

function waitForWorkerInstalled(worker, timeoutMs = 15000) {
  if (!worker) return Promise.reject(new Error('No service worker available'));

  if (worker.state === 'installed') return Promise.resolve(worker);

  return new Promise((resolve, reject) => {
    let finished = false;

    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      worker.removeEventListener('statechange', onStateChange);
      fn(value);
    };

    const onStateChange = () => {
      if (worker.state === 'installed') finish(resolve, worker);
      else if (worker.state === 'redundant') {
        finish(reject, new Error('Service worker became redundant'));
      }
    };

    const timeout = setTimeout(() => {
      finish(reject, new Error('Timed out waiting for service worker installation'));
    }, timeoutMs);

    worker.addEventListener('statechange', onStateChange);
  });
}

async function waitForWaitingWorker(registration, timeoutMs = 15000) {
  if (registration.waiting) return registration.waiting;

  const worker = registration.installing;
  if (worker) {
    await waitForWorkerInstalled(worker, timeoutMs);
    if (registration.waiting) return registration.waiting;
  }

  return new Promise((resolve, reject) => {
    let finished = false;

    const cleanup = () => {
      clearTimeout(timeout);
      registration.removeEventListener('updatefound', onUpdateFound);
    };

    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      cleanup();
      fn(value);
    };

    const onUpdateFound = async () => {
      const installing = registration.installing;
      if (!installing) return;
      try {
        await waitForWorkerInstalled(installing, timeoutMs);
        if (registration.waiting) finish(resolve, registration.waiting);
        else finish(reject, new Error('New service worker installed but is not waiting'));
      } catch (error) {
        finish(reject, error);
      }
    };

    const timeout = setTimeout(() => {
      finish(reject, new Error('Timed out waiting for a new service worker'));
    }, timeoutMs);

    registration.addEventListener('updatefound', onUpdateFound);
  });
}

async function applyAppUpdate() {
  if (!appRegistration) {
    appRegistration = await navigator.serviceWorker.getRegistration('./');
  }

  if (!appRegistration) {
    setUpdateStatus('לא ניתן למצוא את שירות העדכון. נסה לרענן את הדף.', 'error');
    return;
  }

  const button = document.getElementById('check-app-update-btn');
  if (button) {
    button.disabled = true;
    button.textContent = 'מעדכן...';
    button.classList.remove('hidden');
    button.classList.add('opacity-70');
  }

  closeUpdateNotification();
  setUpdateStatus('מוריד ומתקין את העדכון...', 'normal');

  try {
    // Force the browser to check sw.js on the network.
    await appRegistration.update();

    // Wait until the new worker is actually installed and waiting.
    const worker = await waitForWaitingWorker(appRegistration, 15000);
    newWorker = worker;

    setUpdateStatus('מפעיל את הגרסה החדשה...', 'normal');
    worker.postMessage({ action: 'skipWaiting' });

    // controllerchange below performs the final reload. This keeps all
    // localStorage data intact while the new cached app becomes active.
  } catch (error) {
    console.warn('App update failed:', error);
    setUpdateStatus(
      'העדכון לא הותקן. ודא שהגרסה החדשה הועלתה לשרת ונסה שוב.',
      'error'
    );

    if (button) {
      button.disabled = false;
      button.textContent = 'עדכן';
      button.classList.remove('opacity-70');
    }
  }
}

function checkForUpdateFromSettings() {
  const button = document.getElementById('check-app-update-btn');
  if (button) {
    button.disabled = true;
    button.textContent = 'בודק...';
    button.classList.remove('hidden');
    button.classList.add('opacity-70');
  }

  checkForAppUpdate({showResult: true}).finally(() => {
    if (button) {
      button.disabled = false;
      button.classList.remove('opacity-70');

      if (!availableAppVersion || !installedAppVersion ||
          compareVersions(availableAppVersion, installedAppVersion) <= 0) {
        button.classList.add('hidden');
        button.textContent = 'עדכן';
      }
    }
  });
}

function registerAppServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setUpdateStatus('עדכונים אינם נתמכים בדפדפן זה.', 'warning');
    return;
  }

  window.addEventListener('load', async () => {
    try {
      appRegistration = await navigator.serviceWorker.register('./sw.js');

      appRegistration.addEventListener('updatefound', () => {
        newWorker = appRegistration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', async () => {
          if (newWorker.state !== 'installed') return;

          if (navigator.serviceWorker.controller) {
            try {
              const latest = await fetchLatestVersion();
              if (installedAppVersion && compareVersions(latest, installedAppVersion) > 0) {
                showUpdateNotification(latest);
              }
            } catch (e) {
              console.warn('Could not read latest version:', e);
            }
          }
        });
      });

      if (appRegistration.waiting) {
        newWorker = appRegistration.waiting;
      }

      const swVersion = await getInstalledVersionFromServiceWorker();

      if (swVersion) {
        installedAppVersion = swVersion;
        localStorage.setItem('money_tracker_installed_version', swVersion);
        setCurrentVersion(swVersion);
      } else {
        const saved = normalizeVersion(
          localStorage.getItem('money_tracker_installed_version')
        );
        if (saved) {
          installedAppVersion = saved;
          setCurrentVersion(saved);
        }
      }

      await checkForAppUpdate({showResult:false});
    } catch (error) {
      console.warn('Service worker registration failed:', error);
      setUpdateStatus('לא ניתן להפעיל עדכונים אוטומטיים כרגע.', 'warning');
    }
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    // Never clear localStorage here.
    window.location.reload();
  });
}

registerAppServiceWorker();
