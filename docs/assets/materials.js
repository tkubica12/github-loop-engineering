(() => {
  "use strict";

  function revealTarget() {
    const target = document.getElementById(location.hash.slice(1));
    if (!target) return;
    const slide = target.closest(".deck-stage > .slide");
    if (slide && target !== slide) {
      const url = new URL(location.href);
      url.hash = slide.id;
      history.replaceState(null, "", url.href);
    }
    for (let parent = target; parent; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS") parent.open = true;
    }
  }

  // Resolve legacy numeric slide links before the unchanged deck runtime starts.
  revealTarget();
  window.addEventListener("hashchange", revealTarget);

  document.addEventListener("keydown", (event) => {
    if (!document.querySelector(".deck-stage") || !["ArrowUp", "ArrowDown"].includes(event.key) ||
        document.querySelector("dialog[open]") || event.altKey || event.ctrlKey || event.metaKey ||
        !(event.target instanceof Element) ||
        event.target.closest("input, select, textarea, [contenteditable]")) return;
    event.preventDefault();
    event.target.dispatchEvent(new KeyboardEvent("keydown", {
      key: event.key === "ArrowDown" ? "ArrowRight" : "ArrowLeft",
      bubbles: true, cancelable: true, shiftKey: event.shiftKey
    }));
  });

  for (const pre of document.querySelectorAll(".code pre")) {
    if (pre.closest(".slide-content, .deck-stage")) continue;
    const text = pre.querySelector("code")?.textContent ?? pre.textContent;
    const button = document.createElement("input");
    button.type = "button";
    button.className = "ctrl";
    button.dataset.copyCommand = "";
    button.value = "Copy command";
    button.setAttribute("aria-label", "Copy command");
    button.setAttribute("aria-live", "polite");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        button.value = "Copied";
      } catch {
        button.value = "Select and copy manually";
      }
      button.setAttribute("aria-label", button.value);
    });
    pre.before(button);
  }
})();
