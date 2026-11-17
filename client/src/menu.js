// One screen with three modes: "loading" (progress bar), "start" (first
// visit, over the slowly drifting gallery) and "pause" (in-game menu).

const $ = (id) => document.getElementById(id);

// [keys shown as keycaps, what they do]
const HELP = {
  desktop: [
    [['W', 'A', 'S', 'D'], 'Walk'],
    [['Shift'], 'Run'],
    [['Mouse'], 'Look around'],
    [['Q', 'E'], 'Turn'],
    [['Click'], 'Open a picture'],
    [['Esc'], 'This menu'],
  ],
  mobile: [
    [['Joystick'], 'Walk — push to the edge to run'],
    [['Drag'], 'Look around'],
    [['Tap'], 'Open a picture'],
    [['Pinch'], 'Zoom an open picture'],
  ],
};

export function createMenu({ isMobile, isBlocked, onEnter, onHome, onAdmin }) {
  const root = $('menu');
  const helpList = $('menu-help');
  const label = (id) => $(id).querySelector('span');
  let lastLockChange = 0;

  for (const [keycaps, what] of HELP[isMobile ? 'mobile' : 'desktop']) {
    const li = document.createElement('li');
    const keys = document.createElement('span');
    for (const k of keycaps) {
      const kbd = document.createElement('kbd');
      kbd.textContent = k;
      keys.append(kbd);
    }
    const text = document.createElement('span');
    text.textContent = what;
    li.append(keys, text);
    helpList.append(li);
  }

  const mode = () => root.dataset.mode;
  const isOpen = () => root.classList.contains('open');

  function open(nextMode) {
    document.exitPointerLock?.();
    root.dataset.mode = nextMode;
    root.classList.add('open');
    label('menu-enter').textContent = nextMode === 'pause' ? 'Resume' : 'Enter the museum';
    $('menu-tag').textContent = nextMode === 'pause' ? 'Paused' : 'Walk through the collection';
    if (nextMode !== 'loading') $('menu-enter').focus({ preventScroll: true });
  }

  function close() {
    root.classList.remove('open');
    helpList.hidden = true;
    $('menu-help-btn').setAttribute('aria-expanded', 'false');
  }

  $('menu-enter').addEventListener('click', () => {
    const first = mode() === 'start';
    close();
    onEnter(first);
  });
  $('menu-home').addEventListener('click', () => {
    onHome();
    close();
    onEnter(false);
  });
  $('menu-help-btn').addEventListener('click', (e) => {
    helpList.hidden = !helpList.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!helpList.hidden));
  });
  $('menu-admin').addEventListener('click', onAdmin);
  $('menu-btn').addEventListener('click', () => open('pause'));

  // Full screen is not available everywhere (e.g. iPhone Safari): hide the button there.
  const fsButton = $('menu-fullscreen');
  if (!document.documentElement.requestFullscreen) fsButton.hidden = true;
  fsButton.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    label('menu-fullscreen').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  });

  // Esc releases the mouse on desktop; treat that as "pause" unless a dialog took it.
  document.addEventListener('pointerlockchange', () => {
    lastLockChange = performance.now();
    if (!document.pointerLockElement && !isBlocked()) open('pause');
  });
  // Capture phase: decide before other Esc handlers close their own dialogs.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || performance.now() - lastLockChange < 300) return;
      if (!isBlocked()) open('pause');
      else if (isOpen() && mode() === 'pause' && document.querySelectorAll('.overlay.open').length === 1) {
        close();
      }
    },
    true,
  );

  return {
    open,
    close,
    get mode() {
      return isOpen() ? mode() : null;
    },
    setProgress(fraction, text) {
      const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      $('menu-bar').style.width = `${pct}%`;
      $('menu-bar').parentElement.setAttribute('aria-valuenow', pct);
      if (text) $('menu-status').textContent = text;
    },
    setAdmin(isAdmin) {
      label('menu-admin').textContent = isAdmin ? 'Log out' : 'Curator';
      $('menu-admin').classList.toggle('active', isAdmin);
      $('curator-pill').hidden = !isAdmin;
    },
    // Small line under the buttons, e.g. "12 pictures on display · 5 sections".
    setInfo(text) {
      $('menu-foot').textContent = text;
    },
  };
}
