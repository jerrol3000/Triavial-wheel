import { setModal } from "../store/uiSlice";

// Promise-based confirm that resolves to true (user confirmed) or false
// (user cancelled / dismissed). Drop-in replacement for window.confirm,
// just async:
//
//   if (!(await confirmDialog(dispatch, { title: "Quit round?", message: "..." }))) return;
//
// Renders via the ConfirmModal component mounted in App.js so the
// styling matches the rest of the game's modal vocabulary.
//
// Why not just take onConfirm/onCancel callbacks: a Promise reads
// linearly in async code, no callback nesting, and mirrors window.confirm's
// return-value pattern almost exactly — easier to migrate existing
// `if (!confirm(...))` blocks.
export function confirmDialog(dispatch, opts = {}) {
  return new Promise((resolve) => {
    dispatch(setModal({
      name: "confirm",
      data: {
        title: opts.title || "Are you sure?",
        message: opts.message || "",
        confirmText: opts.confirmText || "OK",
        cancelText: opts.cancelText || "Cancel",
        destructive: !!opts.destructive,
        icon: opts.icon || null,
        // ConfirmModal handles closing the modal itself — we just
        // resolve the promise with the user's choice.
        onConfirm: () => resolve(true),
        onCancel:  () => resolve(false),
      },
    }));
  });
}
