import { load, save, remove } from "./storage";

// Guest gate: now that spins are only consumed on failure, a skilled
// unregistered player could spin forever. We cap free-of-account play
// so registration carries weight. Counter is reset on register/login.
//
// SOFT_LIMIT — first nag (toast banner suggesting register).
// HARD_LIMIT — block further rounds until the user signs up or logs in.
//
// The client counter is the soft enforcement layer (instant UX, no
// network). A device that clears storage will get a fresh count, but
// the server-side IP rate-limit on /api/questions for unauthenticated
// callers catches that case as a hard fallback.
export const GUEST_SOFT_LIMIT = 5;
export const GUEST_HARD_LIMIT = 10;

const KEY = "guest_plays";

export function getGuestPlays() {
  return Math.max(0, Number(load(KEY, 0)) || 0);
}

export function incrementGuestPlays() {
  const next = getGuestPlays() + 1;
  save(KEY, next);
  return next;
}

export function resetGuestPlays() {
  remove(KEY);
}

export function guestStatus() {
  const n = getGuestPlays();
  return {
    plays: n,
    nearLimit: n >= GUEST_SOFT_LIMIT && n < GUEST_HARD_LIMIT,
    blocked: n >= GUEST_HARD_LIMIT,
    remaining: Math.max(0, GUEST_HARD_LIMIT - n),
  };
}
