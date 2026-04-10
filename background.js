/**
 * WeDID Background Service Worker
 *
 * Handles DID resolution requests from content scripts and popup.
 * Maintains a shared resolver instance with caching.
 */

importScripts("resolver.js");

const resolver = new DIDResolver();

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "resolve") {
    handleResolve(message.did).then(sendResponse);
    return true; // async response
  }

  if (message.type === "getServices") {
    handleGetServices(message.did, message.serviceType).then(sendResponse);
    return true;
  }

  if (message.type === "clearCache") {
    resolver.clearCache();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "getState") {
    handleGetState(sender.tab?.id).then(sendResponse);
    return true;
  }
});

// Track resolved DIDs per tab
const tabState = new Map();

async function handleResolve(did) {
  const result = await resolver.resolve(did);

  if (result.didDocument) {
    // Update badge for the requesting tab
    updateBadge(result);
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
  return tabState.get(tabId) || { dids: [] };
}

function updateBadge(result) {
  if (!result.didDocument) return;

  const services = DIDResolver.getServices(result.didDocument);
  const hasServices = services.length > 0;

  // Green if services found, blue if just identity
  chrome.action.setBadgeBackgroundColor({
    color: hasServices ? "#059669" : "#2563eb",
  });
  chrome.action.setBadgeText({
    text: hasServices ? "OK" : "ID",
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
