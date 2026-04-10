/**
 * WeDID Background Service Worker
 *
 * Handles DID resolution requests from content scripts and popup.
 * Maintains a shared resolver instance with caching.
 */

importScripts("resolver.js");

const resolver = new DIDResolver();
const tabState = new Map();

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId ?? sender.tab?.id;

  if (message.type === "resolve" || message.type === "resolveSiteDid") {
    handleResolve(message.did, {
      tabId,
      remember: Boolean(message.remember) || message.type === "resolveSiteDid",
      primary: Boolean(message.primary) || message.type === "resolveSiteDid",
    }).then(sendResponse).catch((error) => {
      sendResponse({
        didDocument: null,
        didResolutionMetadata: {
          error: "internalError",
          message: error.message || "DID resolution failed",
        },
        didDocumentMetadata: {},
      });
    });
    return true; // async response
  }

  if (message.type === "getServices") {
    handleGetServices(message.did, message.serviceType).then(sendResponse).catch((error) => {
      sendResponse({
        error: "internalError",
        message: error.message || "Failed to get services",
        services: [],
      });
    });
    return true;
  }

  if (message.type === "clearCache") {
    resolver.clearCache();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "getState") {
    handleGetState(tabId).then(sendResponse).catch(() => {
      sendResponse({ dids: [] });
    });
    return true;
  }
});

async function handleResolve(did, options = {}) {
  const result = await resolver.resolve(did);

  if (typeof options.tabId === "number" && (options.remember || options.primary)) {
    rememberTabResult(options.tabId, did, result, options.primary);
  }

  if (result.didDocument) {
    updateBadge(result, options.tabId);
  }

  return result;
}

async function handleGetServices(did, serviceType) {
  const result = await resolver.resolve(did);
  if (!result.didDocument) {
    return { error: result.didResolutionMetadata.error, services: [] };
  }
  return {
    services: DIDResolver.getServices(result.didDocument, serviceType),
  };
}

async function handleGetState(tabId) {
  if (typeof tabId !== "number") {
    return { dids: [] };
  }
  return tabState.get(tabId) || { dids: [] };
}

function rememberTabResult(tabId, did, result, isPrimary) {
  const current = tabState.get(tabId) || { dids: [] };
  const next = {
    ...current,
    dids: [...current.dids],
  };

  if (result.didDocument && !next.dids.includes(did)) {
    next.dids.unshift(did);
  }

  if (isPrimary) {
    next.primaryDid = did;
    next.primaryResult = result;
  }

  tabState.set(tabId, next);
}

function updateBadge(result, tabId) {
  if (!result.didDocument) return;

  const services = DIDResolver.getServices(result.didDocument);
  const hasServices = services.length > 0;
  const badgeColor = hasServices ? "#059669" : "#2563eb";
  const badgeText = hasServices ? "OK" : "ID";
  const badgeOptions = typeof tabId === "number" ? { tabId } : {};

  chrome.action.setBadgeBackgroundColor({
    ...badgeOptions,
    color: badgeColor,
  });
  chrome.action.setBadgeText({
    ...badgeOptions,
    text: badgeText,
  });
}

// Clean up tab state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

// Reset badge when navigating
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId });
    tabState.delete(tabId);
  }
});
