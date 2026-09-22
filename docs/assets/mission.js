const scenes = [...document.querySelectorAll(".mission-scene")];
const sceneButtons = [...document.querySelectorAll("[data-scene]")];
const sceneCounter = document.querySelector("[data-scene-counter]");
let current = 0;
document.body.classList.add("mission-ready");

function activate(next) {
  current = Math.min(Math.max(next, 0), scenes.length - 1);
  scenes.forEach((scene, index) => {
    scene.classList.toggle("active", index === current);
    scene.setAttribute("aria-hidden", String(index !== current));
  });
  sceneButtons.forEach((button, index) => {
    button.classList.toggle("current", index === current);
    button.setAttribute("aria-current", index === current ? "step" : "false");
  });
  sceneCounter.textContent = `Scene ${current + 1} of ${scenes.length}`;
  history.replaceState(null, "", `#scene-${current + 1}`);
}

sceneButtons.forEach((button, index) => button.addEventListener("click", () => activate(index)));
document.querySelector("[data-scene-next]")?.addEventListener("click", () => activate(current + 1));
document.querySelector("[data-scene-prev]")?.addEventListener("click", () => activate(current - 1));

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey ||
      event.target.closest("input, select, textarea, [contenteditable]")) return;
  if (event.key === " " && event.target.closest("button, a, summary")) return;
  if (["ArrowRight", " ", "PageDown"].includes(event.key)) {
    event.preventDefault();
    activate(current + 1);
  } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
    event.preventDefault();
    activate(current - 1);
  } else if (event.key === "Home") {
    event.preventDefault();
    activate(0);
  } else if (event.key === "End") {
    event.preventDefault();
    activate(scenes.length - 1);
  }
});

const requested = Number(location.hash.match(/^#scene-(\d+)$/)?.[1] ?? 1) - 1;
activate(requested);
window.addEventListener("hashchange", () => {
  activate(Number(location.hash.match(/^#scene-(\d+)$/)?.[1] ?? 1) - 1);
});
