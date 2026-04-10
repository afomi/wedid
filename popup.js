/**
 * WeDID Popup
 *
 * Manual DID lookup and display of resolved DID documents.
 */

const input = document.getElementById("did-input");
const btn = document.getElementById("resolve-btn");
const status = document.getElementById("status");

btn.addEventListener("click", () => resolve());
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") resolve();
});

// On open, check if the current page has a resolved DID
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    chrome.runtime.sendMessage(
      { type: "getState", tabId: tabs[0].id },
      (state) => {
        if (state && state.dids && state.dids.length > 0) {
          input.value = state.dids[0];
          resolve();
        }
      }
    );
  }
});

async function resolve() {
  const did = input.value.trim();
  if (!did) return;

  status.innerHTML = '<div class="status-empty">Resolving...</div>';

  const result = await chrome.runtime.sendMessage({ type: "resolve", did });

  if (result.didResolutionMetadata.error) {
    status.innerHTML = `<div class="error">${escapeHtml(result.didResolutionMetadata.message)}</div>`;
    return;
  }

  renderDocument(result);
}

function renderDocument(result) {
  const doc = result.didDocument;
  const services = doc.service || [];
  const methods = doc.verificationMethod || [];
  const meta = result.didResolutionMetadata;

  let html = '<div class="did-result">';
  html += `<div class="did-id">${escapeHtml(doc.id)}</div>`;

  // Resolution metadata
  if (meta.cached) {
    html += '<div style="font-size:11px;color:#888;margin-bottom:8px">cached</div>';
  }
  if (meta.selfCertified) {
    html += '<div style="font-size:11px;color:#059669;margin-bottom:8px">self-certified (no network fetch)</div>';
  }

  // Verification methods
  if (methods.length > 0) {
    html += '<div class="section-label">Verification Methods</div>';
    html += '<ul class="verification-methods">';
    for (const m of methods) {
      const typeLabel = m.type || "unknown";
      const idShort = (m.id || "").split("#").pop();
      html += `<li>${escapeHtml(typeLabel)} #${escapeHtml(idShort)}</li>`;
    }
    html += "</ul>";
  }

  // Services
  if (services.length > 0) {
    html += '<div class="section-label">Services</div>';
    for (const s of services) {
      const endpoint = s.serviceEndpoint || "";
      const isUrl = endpoint.startsWith("http");
      html += '<div class="service-item">';
      html += `<span class="service-type">${escapeHtml(s.type)}</span>`;
      if (isUrl) {
        html += `<a class="service-endpoint" href="${escapeHtml(endpoint)}" target="_blank" title="${escapeHtml(endpoint)}">${escapeHtml(truncate(endpoint, 30))}</a>`;
      } else {
        html += `<span class="service-endpoint">${escapeHtml(truncate(endpoint, 30))}</span>`;
      }
      html += "</div>";
    }
  }

  html += "</div>";
  status.innerHTML = html;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "\u2026";
}
