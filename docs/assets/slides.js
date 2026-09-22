const slides = [...document.querySelectorAll(".slide")];
const counter = document.querySelector("[data-slide-counter]");
const progress = document.querySelector("[data-slide-progress]");
let index = 0;
slides.forEach((slide, slideIndex) => {
  slide.id ||= `slide-${slideIndex + 1}`;
});
document.body.classList.add("slides-ready");

const deck = document.querySelector("main");
deck?.removeAttribute("aria-live");

const counterText = document.createElement("span");
counterText.setAttribute("aria-hidden", "true");
const counterStatus = document.createElement("span");
counterStatus.style.cssText =
  "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;";
if (counter) {
  counter.setAttribute("role", "status");
  counter.setAttribute("aria-live", "polite");
  counter.setAttribute("aria-atomic", "true");
  counter.replaceChildren(counterText, counterStatus);
}

function requestedIndex() {
  const match = location.hash.match(/^#slide-(\d+)$/);
  return match ? Math.min(Math.max(Number(match[1]) - 1, 0), slides.length - 1) : 0;
}

function show(next, updateHash = true) {
  index = Math.min(Math.max(next, 0), slides.length - 1);
  slides.forEach((slide, slideIndex) => {
    const active = slideIndex === index;
    slide.classList.toggle("active", active);
    slide.setAttribute("aria-hidden", String(!active));
  });
  counterText.textContent = `${index + 1} / ${slides.length}`;
  counterStatus.textContent =
    `Slide ${index + 1} of ${slides.length}: ${slides[index].dataset.title || "Slide"}`;
  progress.style.width = `${((index + 1) / slides.length) * 100}%`;
  document.title = `${slides[index].dataset.title || "Workshop"} | ${index + 1}/${slides.length}`;
  if (updateHash) {
    history.replaceState(null, "", `#slide-${index + 1}`);
  }
}

async function fullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch (error) {
    counterText.textContent = "Fullscreen unavailable";
    counterStatus.textContent = "Fullscreen unavailable";
    console.error("Fullscreen request failed:", error);
  }
}

document.querySelector("[data-slide-next]")?.addEventListener("click", () => show(index + 1));
document.querySelector("[data-slide-prev]")?.addEventListener("click", () => show(index - 1));
document.querySelector("[data-slide-fullscreen]")?.addEventListener("click", fullscreen);

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey ||
      event.target.closest("input, select, textarea, [contenteditable]")) return;
  if (event.key === " " && event.target.closest("button, a, summary")) return;
  if (["ArrowRight", "ArrowDown", " ", "PageDown"].includes(event.key)) {
    event.preventDefault();
    show(index + 1);
  } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
    event.preventDefault();
    show(index - 1);
  } else if (event.key === "Home") {
    event.preventDefault();
    show(0);
  } else if (event.key === "End") {
    event.preventDefault();
    show(slides.length - 1);
  } else if (event.key.toLowerCase() === "f") {
    fullscreen();
  }
});

document.querySelector("main")?.addEventListener("click", (event) => {
  if (event.target.closest("button, a, input, select, textarea, summary, [contenteditable]") ||
      window.getSelection()?.toString()) return;
  show(index + 1);
});

let touchStart = null;
document.addEventListener("touchstart", (event) => {
  touchStart = event.changedTouches[0].clientX;
}, { passive: true });
document.addEventListener("touchend", (event) => {
  if (touchStart === null) return;
  const distance = event.changedTouches[0].clientX - touchStart;
  if (Math.abs(distance) > 60) show(index + (distance < 0 ? 1 : -1));
  touchStart = null;
}, { passive: true });
window.addEventListener("hashchange", () => show(requestedIndex(), false));

show(requestedIndex(), false);
