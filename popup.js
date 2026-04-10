/**
 * WeDID Popup
 *
 * Resolves the active site's DID automatically.
 */

const siteHost = document.getElementById("site-host");
const status = document.getElementById("status");

init().catch((error) => {
  renderError(error.message || "Failed to inspect the current tab.");
});

async function init() {
  const [tab] = await queryActiveTab();
  if (!tab || typeof tab.id !== "number") {
    siteHost.textContent = "No active tab";
    renderEmpty("Open a website to resolve its DID.");
    return;
  }

  const context = getSiteContext(tab.url);
  siteHost.textContent = context.label;

  if (!context.supported) {
    renderEmpty(context.message);
    return;
  }

  status.innerHTML = '<div class="status-empty">Resolving site DID...</div>';

  const state = await sendMessage({
    type: "getState",
    tabId: tab.id,
  }).catch(() => null);

  if (state?.primaryResult) {
    renderResult(state.primaryResult, context.did);
    return;
  }

  const result = await resolveSiteDid(context, tab.id);

  renderResult(result, context.did);
}

function getSiteContext(rawUrl) {
  if (!rawUrl) {
    return {
      supported: false,
      label: "Unknown page",
      message: "Open a website over HTTPS to resolve its DID.",
    };
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      supported: false,
      label: rawUrl,
      message: "Open a website over HTTPS to resolve its DID.",
    };
  }

  const isLocalHttp = url.protocol === "http:" && isLocalhost(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    return {
      supported: false,
      label: url.host || rawUrl,
      message: "Open a website over HTTPS to resolve its DID.",
    };
  }

  return {
    supported: true,
    label: url.host,
    host: url.host,
    did: `did:web:${encodeURIComponent(url.host)}`,
  };
}

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function queryActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(tabs || []);
    });
  });
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

async function resolveSiteDid(context, tabId) {
  const runtimeResult = await sendMessage({
    type: "resolveSiteDid",
    did: context.did,
    tabId,
  }).catch(() => null);

  if (runtimeResult) {
    return runtimeResult;
  }

  return resolveDidWebDirect(context);
}

async function resolveDidWebDirect(context) {
  const url = `https://${context.host}/.well-known/did.json`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/did+json, application/json" },
    });

    if (!response.ok) {
      return {
        didDocument: null,
        didResolutionMetadata: {
          error: "notFound",
          message: `DID document not found at ${url} (HTTP ${response.status})`,
          url,
        },
        didDocumentMetadata: {},
      };
    }

    const didDocument = await response.json();
    if (didDocument.id && didDocument.id !== context.did) {
      return {
        didDocument: null,
        didResolutionMetadata: {
          error: "invalidDidDocument",
          message: `DID document ID "${didDocument.id}" does not match requested DID "${context.did}"`,
          url,
        },
        didDocumentMetadata: {},
      };
    }

    const contentType = response.headers.get("content-type") || "";
    return {
      didDocument,
      didResolutionMetadata: {
        contentType: contentType.includes("did+json")
          ? "application/did+json"
          : "application/json",
        retrieved: new Date().toISOString(),
        url,
        fallback: true,
      },
      didDocumentMetadata: {},
    };
  } catch (error) {
    return {
      didDocument: null,
      didResolutionMetadata: {
        error: "internalError",
        message: error.message || `Failed to fetch ${url}`,
        url,
      },
      didDocumentMetadata: {},
    };
  }
}

function renderResult(result, expectedDid) {
  if (!result) {
    renderError("Resolver returned no result.");
    return;
  }

  if (result.didDocument) {
    renderDocument(result);
    return;
  }

  const meta = result.didResolutionMetadata || {};
  if (meta.error === "notFound") {
    renderEmpty(
      "No site DID found.",
      `Expected ${expectedDid} at /.well-known/did.json`
    );
    return;
  }

  renderError(meta.message || "DID resolution failed.");
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

function renderEmpty(message, detail = "") {
  let html = `<div class="status-empty">${escapeHtml(message)}</div>`;
  if (detail) {
    html += `<div class="status-subtle">${escapeHtml(detail)}</div>`;
  }
  status.innerHTML = html;
}

function renderError(message) {
  status.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
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
