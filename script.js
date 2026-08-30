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
let updateApplying = false;

const VERSION_URL = './version.json';
const SW_URL = './sw.js';

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
  const button = document.getElementById('apply-app-update-btn');
  if (!button) return;
  button.classList.toggle('hidden', !show);
  if (show) {
    button.disabled = false;
    button.classList.remove('opacity-70');
    button.textContent = 'עדכן';
  }
}

function setCheckButtonState({disabled = false, text = 'בדוק עדכונים'} = {}) {
  const button = document.getElementById('check-app-update-btn');
  if (!button) return;
  button.disabled = disabled;
  button.textContent = text;
  button.classList.toggle('opacity-70', disabled);
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

function registerVersionedServiceWorker(version) {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);

  const cleanVersion = normalizeVersion(version) || Date.now().toString();
  // The query string changes whenever a release changes. Combined with
  // updateViaCache:'none', this prevents a stale sw.js from being reused.
  return navigator.serviceWorker.register(
    `${SW_URL}?appVersion=${encodeURIComponent(cleanVersion)}`,
    { updateViaCache: 'none' }
  ).then((registration) => {
    appRegistration = registration;
    return registration;
  });
}

async function ensureServiceWorkerIsFresh(latestVersion) {
  if (!('serviceWorker' in navigator)) return null;

  const registration = await registerVersionedServiceWorker(latestVersion);
  await registration.update();
  return registration;
}

async function checkForAppUpdate({showResult = true} = {}) {
  if (updateCheckInProgress || updateApplying) return false;
  updateCheckInProgress = true;

  if (showResult) setUpdateStatus('בודק אם קיימת גרסה חדשה...');

  try {
    // Read the release marker first, then use that exact version to address
    // the service worker. This makes Git/GitHub Pages deployments reliable
    // even when the browser has an older sw.js in its HTTP cache.
    const latest = await fetchLatestVersion();

    if ('serviceWorker' in navigator) {
      await ensureServiceWorkerIsFresh(latest);
    }

    if (!installedAppVersion) {
      installedAppVersion =
        normalizeVersion(localStorage.getItem('money_tracker_installed_version')) ||
        null;
    }

    if (installedAppVersion && compareVersions(latest, installedAppVersion) > 0) {
      availableAppVersion = latest;
      showUpdateNotification(latest);
      return true;
    }

    // On a first install there is no controller yet. Treat the freshly
    // registered worker as the installed version without forcing an update.
    if (!installedAppVersion && appRegistration?.active) {
      const activeVersion = await getInstalledVersionFromServiceWorker();
      if (activeVersion) {
        installedAppVersion = activeVersion;
        localStorage.setItem('money_tracker_installed_version', activeVersion);
      }
    }

    if (showResult) {
      const shownVersion = installedAppVersion || latest;
      setCurrentVersion(shownVersion);
      setUpdateStatus(`הגרסה שלך מעודכנת (v${shownVersion})`, 'success');
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
  if (updateApplying) return;
  updateApplying = true;

  const button = document.getElementById('apply-app-update-btn');
  if (button) {
    button.disabled = true;
    button.textContent = 'מעדכן...';
    button.classList.remove('hidden');
    button.classList.add('opacity-70');
  }
  setCheckButtonState({disabled: true, text: 'מעדכן...'});
  closeUpdateNotification();
  setUpdateStatus('מוריד ומתקין את העדכון...', 'normal');

  try {
    const latest = availableAppVersion || await fetchLatestVersion();
    const registration = await ensureServiceWorkerIsFresh(latest);
    if (!registration) throw new Error('Service worker is not supported');

    // If the new worker is already waiting, use it. Otherwise wait for the
    // versioned sw.js to install. Its install step fetches every app asset
    // with cache:'no-store', so changed Git files are actually downloaded.
    const worker = await waitForWaitingWorker(registration, 20000);
    newWorker = worker;

    setUpdateStatus('מפעיל את הגרסה החדשה...', 'normal');
    worker.postMessage({ action: 'skipWaiting' });
  } catch (error) {
    console.warn('App update failed:', error);
    setUpdateStatus(
      'העדכון לא הותקן. ודא שהגרסה החדשה הועלתה לשרת ונסה שוב.',
      'error'
    );
    showUpdateButton(Boolean(availableAppVersion));
    setCheckButtonState({disabled: false, text: 'בדוק עדכונים'});
    updateApplying = false;
  }
}

async function checkForUpdateFromSettings() {
  setCheckButtonState({disabled: true, text: 'בודק...'});
  try {
    await checkForAppUpdate({showResult: true});
  } finally {
    if (!updateApplying) setCheckButtonState({disabled: false, text: 'בדוק עדכונים'});
  }
}

function registerAppServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setUpdateStatus('עדכונים אינם נתמכים בדפדפן זה.', 'warning');
    return;
  }

  window.addEventListener('load', async () => {
    try {
      // Get the release marker first so the service worker URL itself is
      // versioned from the start. This avoids stale sw.js on static hosts.
      const latest = await fetchLatestVersion();
      await registerVersionedServiceWorker(latest);

      appRegistration.addEventListener('updatefound', () => {
        newWorker = appRegistration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', async () => {
          if (newWorker.state !== 'installed') return;
          if (navigator.serviceWorker.controller) {
            try {
              const latestVersion = await fetchLatestVersion();
              if (installedAppVersion && compareVersions(latestVersion, installedAppVersion) > 0) {
                showUpdateNotification(latestVersion);
              }
            } catch (e) {
              console.warn('Could not read latest version:', e);
            }
          }
        });
      });

      if (appRegistration.waiting) newWorker = appRegistration.waiting;

      const swVersion = await getInstalledVersionFromServiceWorker();
      if (swVersion) {
        installedAppVersion = swVersion;
        localStorage.setItem('money_tracker_installed_version', swVersion);
        setCurrentVersion(swVersion);
      } else {
        const saved = normalizeVersion(localStorage.getItem('money_tracker_installed_version'));
        if (saved) {
          installedAppVersion = saved;
          setCurrentVersion(saved);
        }
      }

      await checkForAppUpdate({showResult: false});
    } catch (error) {
      console.warn('Service worker registration failed:', error);
      setUpdateStatus('לא ניתן להפעיל עדכונים אוטומטיים כרגע.', 'warning');
    }
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    // Never clear localStorage here: user data must survive updates.
    localStorage.setItem(
      'money_tracker_installed_version',
      normalizeVersion(availableAppVersion || installedAppVersion || '')
    );
    installedAppVersion = normalizeVersion(availableAppVersion || installedAppVersion || '');
    window.location.reload();
  });
}

registerAppServiceWorker();
