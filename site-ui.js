let activeModal = null;

export function listenToMedia(query, callback) {
  if (typeof query.addEventListener === "function") query.addEventListener("change", callback);
  else if (typeof query.addListener === "function") query.addListener(callback);
}

export function hasOtherModal(dialog) {
  return Boolean(activeModal?.open && activeModal !== dialog);
}

function notifyModalChange(open) {
  document.documentElement.classList.toggle("dialog-open", open);
  document.dispatchEvent(new Event("site-modal-change"));
}

function releaseModal(dialog) {
  if (dialog !== activeModal) return;
  activeModal = null;
  dialog.removeAttribute("aria-modal");
  notifyModalChange(false);
}

document.addEventListener("close", (event) => {
  if (!event.target.open) releaseModal(event.target);
}, true);

export function openModal(dialog) {
  if (typeof dialog.showModal !== "function" || activeModal?.open || dialog.open) return false;
  activeModal = dialog;
  try {
    dialog.showModal();
  } catch {
    activeModal = null;
    return false;
  }
  dialog.setAttribute("aria-modal", "true");
  notifyModalChange(true);
  return true;
}

export function closeDialog(dialog) {
  if (!dialog.open) return;
  dialog.close();
  releaseModal(dialog);
}

export async function copyText(text, container = document.body) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Some contexts deny the async API but still support copying a selection.
  }

  const previous = document.activeElement;
  const selection = document.createElement("textarea");
  selection.className = "clipboard-selection";
  selection.value = text;
  selection.readOnly = true;
  selection.tabIndex = -1;
  container.append(selection);
  try {
    selection.focus({ preventScroll: true });
    selection.select();
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    selection.remove();
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
  }
}
