const form = document.querySelector("#reservation");
const result = document.querySelector("#result");
const stockStatus = document.querySelector("#stock-status");
const themeButton = document.querySelector("#theme");
const root = document.documentElement;
const saved = localStorage.getItem("pharmacy-theme");
if (saved === "dark" || saved === "light") root.dataset.theme = saved;
function themeLabel() {
  const dark = (root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
  themeButton.textContent = dark ? "Light mode" : "Dark mode";
  return dark;
}
themeLabel();
themeButton.addEventListener("click", () => {
  root.dataset.theme = themeLabel() ? "light" : "dark";
  localStorage.setItem("pharmacy-theme", root.dataset.theme);
  themeLabel();
});
themeButton.hidden = false;

function text(tag, value) {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}

async function refreshStock() {
  stockStatus.textContent = "Loading stock from the service.";
  const response = await fetch("/stock");
  if (!response.ok) throw new Error(`Stock request failed: HTTP ${response.status}`);
  const { items } = await response.json();
  document.querySelector("#stock").replaceChildren(...items.map((item) => {
    const row = document.createElement("tr");
    row.dataset.sku = item.sku;
    const name = text("td", item.sku);
    name.append(text("small", item.name));
    row.append(name, text("td", String(item.available)));
    return row;
  }));
  stockStatus.textContent = "Read from GET /stock.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.querySelector("#submit");
  submit.disabled = true;
  result.removeAttribute("data-status");
  result.replaceChildren(text("p", "Sending your request."));
  try {
    const response = await fetch("/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: form.elements.sku.value, quantity: Number(form.elements.quantity.value) })
    });
    const body = await response.json();
    document.querySelector("#response").textContent = `HTTP ${response.status}\n${JSON.stringify(body, null, 2)}`;
    result.dataset.status = String(response.status);
    if (response.status === 201) {
      result.replaceChildren(text("h3", "HTTP 201 / Reservation created"),
        text("p", `${body.sku}: ${body.quantity} reserved, ${body.remaining} remaining.`));
    } else if (response.status === 409) {
      result.replaceChildren(text("h3", "HTTP 409 / Requested stock unavailable"));
      if (body.suggestion) {
        result.append(text("p", `Suggestion: ${body.suggestion.sku} / ${body.suggestion.name}. ${body.suggestion.available} available.`),
          text("p", "Nothing reserved. A person must choose whether to request the alternative."));
        const choose = text("button", `Choose ${body.suggestion.sku}`);
        choose.type = "button";
        choose.addEventListener("click", () => {
          form.elements.sku.value = body.suggestion.sku;
          document.querySelector("#submit").focus();
        });
        result.append(choose);
      } else {
        result.append(text("p", "No suggestion in this response. Nothing reserved."));
      }
    } else {
      throw new Error(`HTTP ${response.status}: ${body.error || "Unexpected response"}`);
    }
    try {
      await refreshStock();
    } catch (error) {
      stockStatus.textContent = `${error.message}. Stock below may be stale; reload before another request.`;
    }
  } catch (error) {
    result.replaceChildren(text("h3", "Request could not be confirmed"), text("p", error.message),
      text("p", "Inspect the API response and current stock before retrying."));
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#submit").disabled = false;
refreshStock().catch((error) => { stockStatus.textContent = error.message; });
