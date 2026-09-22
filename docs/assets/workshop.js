const root = document.documentElement;
const themeButton = document.querySelector("[data-theme-toggle]");

function currentTheme() {
  return root.dataset.theme ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function setTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("workshop-theme", theme);
  if (themeButton) {
    themeButton.textContent = theme === "dark" ? "Light mode" : "Dark mode";
    themeButton.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
  }
}

const savedTheme = localStorage.getItem("workshop-theme");
if (savedTheme === "light" || savedTheme === "dark") {
  setTheme(savedTheme);
} else if (themeButton) {
  themeButton.textContent = currentTheme() === "dark" ? "Light mode" : "Dark mode";
}

themeButton?.addEventListener("click", () => {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
});

for (const block of document.querySelectorAll("pre")) {
  const command = block.querySelector("code")?.textContent ?? block.textContent;
  const button = document.createElement("button");
  button.className = "copy-code";
  button.type = "button";
  button.textContent = "Copy";
  button.setAttribute("aria-label", "Copy command");
  button.setAttribute("aria-live", "polite");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select and copy manually";
    }
    button.setAttribute("aria-label", button.textContent);
    window.setTimeout(() => {
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy command");
    }, 1500);
  });
  block.append(button);
}
