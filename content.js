/**
 * WeDID Content Script
 *
 * Scans pages for DID references and resolves them.
 * Looks for:
 *   - data-did attributes on any element
 *   - <a href="did:..."> links
 *   - <meta name="did" content="did:..."> tags
 *   - Plain text did: URIs (opt-in via data-wedid-scan)
 *
 * Resolved DIDs get a verification indicator injected.
 */

(function () {
  "use strict";

  const RESOLVED_ATTR = "data-wedid-resolved";

  // Run on page load
  scanPage();

  // Watch for dynamic content
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
    }
    if (shouldScan) scanPage();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  function scanPage() {
    // 1. Elements with data-did attribute
    const didElements = document.querySelectorAll(
      `[data-did]:not([${RESOLVED_ATTR}])`
    );
    didElements.forEach((el) => {
      const did = el.getAttribute("data-did");
      if (did) resolveAndAnnotate(el, did);
    });

    // 2. Links with did: href
    const didLinks = document.querySelectorAll(
      `a[href^="did:"]:not([${RESOLVED_ATTR}])`
    );
    didLinks.forEach((el) => {
      const did = el.getAttribute("href");
      if (did) resolveAndAnnotate(el, did);
    });

    // 3. Meta tags
    const metaDid = document.querySelector('meta[name="did"]');
    if (metaDid && !metaDid.hasAttribute(RESOLVED_ATTR)) {
      const did = metaDid.getAttribute("content");
      if (did) {
        metaDid.setAttribute(RESOLVED_ATTR, "true");
        resolveForPage(did);
      }
    }

    // 4. Link rel="did"
    const linkDid = document.querySelector('link[rel="did"]');
    if (linkDid && !linkDid.hasAttribute(RESOLVED_ATTR)) {
      const did = linkDid.getAttribute("href");
      if (did) {
        linkDid.setAttribute(RESOLVED_ATTR, "true");
        resolveForPage(did);
      }
    }
  }

  async function resolveAndAnnotate(el, did) {
    el.setAttribute(RESOLVED_ATTR, "pending");

    const result = await chrome.runtime.sendMessage({
      type: "resolve",
      did,
    });

    if (result.didDocument) {
      el.setAttribute(RESOLVED_ATTR, "verified");
      el.setAttribute("title", `Verified DID: ${did}`);
      injectIndicator(el, result);
    } else {
      el.setAttribute(RESOLVED_ATTR, "failed");
      el.setAttribute(
        "title",
        `DID resolution failed: ${result.didResolutionMetadata.message}`
      );
    }
  }

  async function resolveForPage(did) {
    const result = await chrome.runtime.sendMessage({
      type: "resolve",
      did,
    });

    if (result.didDocument) {
      // Dispatch a custom event so page scripts can react
      window.dispatchEvent(
        new CustomEvent("wedid:resolved", {
          detail: {
            did,
            services: result.didDocument.service || [],
          },
        })
      );
    }
  }

  function injectIndicator(el, result) {
    // Don't double-inject
    if (el.querySelector(".wedid-indicator")) return;

    const services = result.didDocument.service || [];
    const indicator = document.createElement("span");
    indicator.className = "wedid-indicator";
    indicator.setAttribute("aria-label", "Verified decentralized identity");
    indicator.textContent = "\u2713"; // checkmark
    indicator.style.cssText = [
      "display: inline-block",
      "margin-left: 4px",
      "padding: 0 4px",
      "font-size: 11px",
      "font-weight: bold",
      "line-height: 16px",
      "border-radius: 3px",
      "vertical-align: middle",
      "cursor: help",
      services.length > 0
        ? "background: #059669; color: white"
        : "background: #2563eb; color: white",
    ].join("; ");

    indicator.title = services.length > 0
      ? `Verified identity with ${services.length} service${services.length > 1 ? "s" : ""}`
      : "Verified decentralized identity";

    el.style.position = el.style.position || "relative";
    el.appendChild(indicator);
  }
})();
