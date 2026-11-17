import * as THREE from 'three';

const EYE_HEIGHT = 1.65;
const WALK_SPEED = 3.4; // m/s
const RUN_SPEED = 6.2;
const TURN_SPEED = 1.9; // rad/s for the Q / E keys
const ACCELERATION = 9; // how quickly you reach speed (higher = snappier)
const BRAKING = 12; // how quickly you stop
const LOOK_SMOOTHING = 30; // takes the jitter out of mouse and touch look
const BOB_HEIGHT = 0.03; // m, gentle head bob while walking
const STRIDE = 1.5; // m per bob cycle
const MAX_PITCH = Math.PI / 2 - 0.08;
const TAP_SLOP = 7; // px of movement before a press counts as a drag
const REACH = 14; // metres: how far away a picture or board can be clicked

// Frame-rate independent easing toward a target.
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

// Keep receiving a pointer's events after it leaves the element. Some browsers
// throw if the pointer is already gone; losing capture is harmless.
function capture(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* ignore */
  }
}

// Desktop: pointer lock + WASD. Mobile: joystick + drag-look.
// Dragging also looks around when pointer lock is off, so it works everywhere.
export function createControls({
  camera,
  dom,
  gallery,
  start,
  isMobile,
  onFrame,
  onBoard,
  isBlocked,
  isIdle, // true while the start menu is up: the view drifts slowly behind it
  onInteract,
}) {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // yaw / pitch are where the player is aiming; view* is what the camera shows.
  let yaw = start.yaw;
  let pitch = 0;
  let viewYaw = yaw;
  let viewPitch = 0;
  const velocity = { x: 0, z: 0 };
  let bobPhase = 0;
  let bobAmount = 0;

  const keys = new Set();
  const joy = { x: 0, y: 0 };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  camera.rotation.order = 'YXZ';
  camera.position.set(start.x, EYE_HEIGHT, start.z);

  const isLocked = () => document.pointerLockElement === dom;
  const look = (dx, dy, sensitivity) => {
    yaw -= dx * sensitivity;
    pitch = THREE.MathUtils.clamp(pitch - dy * sensitivity, -MAX_PITCH, MAX_PITCH);
  };

  function lock() {
    if (isMobile || isLocked()) return;
    // Some embedded browsers refuse pointer lock; drag-look still works there.
    try {
      dom.requestPointerLock()?.catch?.(() => {});
    } catch {
      /* unsupported */
    }
  }

  function pick(clientX, clientY) {
    if (isLocked()) ndc.set(0, 0);
    else {
      const rect = dom.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    }
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(gallery.pickTargets, true)[0];
    if (!hit) return null;
    for (let o = hit.object; o; o = o.parent) {
      if (o.userData.slotId) return { slotId: o.userData.slotId, distance: hit.distance };
      if (o.userData.sectionId) return { sectionId: o.userData.sectionId, distance: hit.distance };
    }
    return null;
  }

  // ---- pointer: look and tap ----
  let lookPointer = null;

  dom.addEventListener('pointerdown', (e) => {
    if (isBlocked() || lookPointer) return;
    lookPointer = { id: e.pointerId, x: e.clientX, y: e.clientY, travelled: 0 };
    if (!isLocked()) capture(dom, e.pointerId);
    onInteract?.();
  });

  dom.addEventListener('pointermove', (e) => {
    if (isLocked()) return look(e.movementX, e.movementY, 0.0021);
    if (!lookPointer || e.pointerId !== lookPointer.id) return;
    const dx = e.clientX - lookPointer.x;
    const dy = e.clientY - lookPointer.y;
    lookPointer.x = e.clientX;
    lookPointer.y = e.clientY;
    lookPointer.travelled += Math.abs(dx) + Math.abs(dy);
    if (lookPointer.travelled > TAP_SLOP) look(dx, dy, e.pointerType === 'touch' ? 0.0046 : 0.0034);
  });

  const release = (e) => {
    if (!lookPointer || e.pointerId !== lookPointer.id) return;
    const wasTap = lookPointer.travelled <= TAP_SLOP && e.type === 'pointerup';
    lookPointer = null;
    if (wasTap && !isBlocked()) tap(e);
  };
  dom.addEventListener('pointerup', release);
  dom.addEventListener('pointercancel', release);

  function tap(e) {
    const hit = pick(e.clientX, e.clientY);
    if (hit?.slotId && hit.distance < REACH) return onFrame(hit.slotId);
    if (hit?.sectionId && hit.distance < REACH) return onBoard(hit.sectionId);

    if (e.pointerType !== 'touch') lock();
  }

  document.addEventListener('pointerlockchange', () => {
    document.body.classList.toggle('locked', isLocked());
    lookPointer = null;
  });

  // ---- keyboard ----
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  window.addEventListener('keydown', (e) => {
    if (typing(e) || isBlocked()) return;
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    keys.add(e.code);
    onInteract?.();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // ---- joystick ----
  const stick = document.getElementById('joystick');
  const knob = document.getElementById('joystick-knob');
  let stickPointer = null;
  const setStick = (x, y) => {
    joy.x = x;
    joy.y = y;
    knob.style.transform = `translate(${x * 36}px, ${y * 36}px)`;
    stick.classList.toggle('running', Math.hypot(x, y) > 0.9);
  };
  const moveStick = (e) => {
    const rect = stick.getBoundingClientRect();
    let x = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    let y = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    setStick(x, y);
  };
  stick.addEventListener('pointerdown', (e) => {
    if (stickPointer !== null) return;
    stickPointer = e.pointerId;
    capture(stick, e.pointerId);
    moveStick(e);
    onInteract?.();
  });
  stick.addEventListener('pointermove', (e) => e.pointerId === stickPointer && moveStick(e));
  const endStick = (e) => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    setStick(0, 0);
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  // ---- per-frame ----
  const down = (...codes) => (codes.some((c) => keys.has(c)) ? 1 : 0);

  function update(dt) {
    let wantX = 0;
    let wantZ = 0;
    let moving = false;

    if (isBlocked()) {
      keys.clear();
      // Behind the start menu the view sways gently across the entrance.
      if (isIdle?.() && !calm) yaw = start.yaw + Math.sin(performance.now() / 4200) * 0.16;
    } else {
      yaw -= (down('KeyE') - down('KeyQ')) * TURN_SPEED * dt;

      let forward = down('KeyW', 'ArrowUp') - down('KeyS', 'ArrowDown') - joy.y;
      let strafe = down('KeyD', 'ArrowRight') - down('KeyA', 'ArrowLeft') + joy.x;
      const push = Math.hypot(forward, strafe);

      if (push > 0.08) {
        moving = true;
        if (push > 1) {
          forward /= push;
          strafe /= push;
        }
        // Keys are all-or-nothing; the joystick is analogue and runs when pushed to its edge.
        const usingStick = Math.hypot(joy.x, joy.y) > 0.08;
        const running = down('ShiftLeft', 'ShiftRight') || (usingStick && push > 0.9);
        const speed = running ? RUN_SPEED : WALK_SPEED;
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        wantX = (-sin * forward + cos * strafe) * speed;
        wantZ = (-cos * forward - sin * strafe) * speed;
      }
    }

    // Ease toward the wanted velocity, move, then let walls stop whatever they block.
    const rate = moving ? ACCELERATION : BRAKING;
    velocity.x = damp(velocity.x, wantX, rate, dt);
    velocity.z = damp(velocity.z, wantZ, rate, dt);
    const pos = camera.position;
    const fromX = pos.x;
    const fromZ = pos.z;
    pos.x += velocity.x * dt;
    pos.z += velocity.z * dt;
    gallery.clampPosition(pos);
    const movedX = pos.x - fromX;
    const movedZ = pos.z - fromZ;
    if (dt > 0) {
      // Sliding along a wall keeps the speed along it and drops the part going into it.
      if (Math.abs(movedX - velocity.x * dt) > 1e-5) velocity.x = movedX / dt;
      if (Math.abs(movedZ - velocity.z * dt) > 1e-5) velocity.z = movedZ / dt;
    }
    const travelled = Math.hypot(movedX, movedZ);
    const speedNow = dt > 0 ? travelled / dt : 0;

    // Head bob follows distance walked, and fades in and out with speed.
    bobPhase += (travelled / STRIDE) * Math.PI * 2;
    bobAmount = damp(bobAmount, calm ? 0 : Math.min(1, speedNow / WALK_SPEED), 8, dt);
    pos.y = EYE_HEIGHT + Math.sin(bobPhase) * BOB_HEIGHT * bobAmount;

    viewYaw = damp(viewYaw, yaw, LOOK_SMOOTHING, dt);
    viewPitch = damp(viewPitch, pitch, LOOK_SMOOTHING, dt);
    camera.rotation.set(viewPitch, viewYaw, 0);
  }

  return {
    update,
    // Grab the mouse (desktop). Must be called from a click or key handler.
    lock,
    goHome() {
      velocity.x = velocity.z = 0;
      yaw = viewYaw = start.yaw;
      pitch = viewPitch = 0;
      camera.position.set(start.x, EYE_HEIGHT, start.z);
    },
    // Face the way the visit starts (used when leaving the drifting start-menu view).
    faceStart() {
      yaw = start.yaw;
      pitch = 0;
    },
  };
}
