# WeDID

**Universal DID resolver for the browser.**

WeDID resolves [W3C Decentralized Identifiers](https://www.w3.org/TR/did-core/) — turning cryptographic identities into connected services, right from your browser. No wallet. No token. Just resolution.

## What it does

You land on a website and WeDID treats the current domain as the identity input. It tries to resolve the site's root-domain DID, then surfaces any explicit DID hints the page provides. The result is simple: who this site says it is, what services it exposes, and whether the identity checks out.

### On any page

WeDID resolves the current site automatically:

- **`https://example.com` -> `did:web:example.com`** — WeDID fetches `https://example.com/.well-known/did.json`.

WeDID also scans for explicit DID hints:

- **`<meta name="did" content="did:web:qart.app:users:fresh-farms">`** — the page declares its identity. WeDID resolves it and shows a green badge in the toolbar.
- **`<a href="did:web:example.com">`** — a DID link. WeDID resolves it and adds a verification checkmark.
- **`<div data-did="did:key:z6Mk...">`** — any element with a `data-did` attribute gets resolved and annotated.

### In the popup

Click the WeDID icon and it resolves the active site's DID automatically:

```
┌─────────────────────────────┐
│ WeDID                 v0.1.0│
├─────────────────────────────┤
│ CURRENT SITE                │
│ ryanwold.net                │
├─────────────────────────────┤
│ did:web:ryanwold.net        │
│                             │
│ VERIFICATION METHODS        │
│ JsonWebKey2020 #key-1       │
│                             │
│ SERVICES                    │
│ ProfilePage    /fresh-farms │
│ PaymailService /.well-kno…  │
│ QartSpace      /api/v1/co…  │
├─────────────────────────────┤
│ wedid.app · W3C DID Resolver│
└─────────────────────────────┘
```

The popup tells you:
- **Who** — the DID and its verification methods (keys)
- **What** — service endpoints (profile pages, payment services, commerce APIs)
- **How** — whether the resolution was cached, fetched, or self-certified (did:key)
- **Where** — which current site was used as the identity input

### Badge indicators

| Badge | Meaning |
|-------|---------|
| **OK** (green) | Verified identity with service endpoints |
| **ID** (blue) | Verified identity, no services listed |
| *(none)* | No DIDs detected on this page |

## Supported DID methods

| Method | Resolution | Network? |
|--------|-----------|----------|
| `did:web` | Fetches `/.well-known/did.json` or `/path/did.json` over HTTPS | Yes |
| `did:key` | Derives DID Document from the public key itself | No — self-certified |

More methods (`did:ion`, `did:pkh`, `did:btc`) can be added via the pluggable resolver architecture.

## For web developers

### Declare your page's identity

Add a meta tag to your HTML:

```html
<meta
  name="did"
  content="did:web:yoursite.com"
>
```

Or a link tag:

```html
<link
  rel="did"
  href="did:web:yoursite.com:users:alice"
>
```

WeDID will resolve it automatically for visitors who have the extension installed.

If your site's DID is simply `did:web:yoursite.com`, you do not need an HTML hint. WeDID will derive it from the current host and fetch `/.well-known/did.json` automatically.

### Listen for resolution

When WeDID resolves a DID on your page, it dispatches a custom event:

```javascript
window.addEventListener("wedid:resolved", (e) => {
  console.log("Resolved DID:", e.detail.did);
  console.log("Services:", e.detail.services);

  // Connect to a Qart commerce space
  const qartService = e.detail.services.find(s => s.type === "QartSpace");
  if (qartService) {
    const space = new QartSpace(handle, {
      endpoint: qartService.serviceEndpoint
    });
  }
});
```

### Annotate elements

Any element with a `data-did` attribute will be resolved and get a verification indicator:

```html
<span data-did="did:web:qart.app:users:fresh-farms">
  Fresh Farms Market
</span>
```

Becomes:

> Fresh Farms Market ✓

## How it works

DID resolution is to identity what DNS is to naming. A DID is a globally unique identifier controlled by the subject, not a registrar. The DID Document describes public keys and service endpoints — enough to verify identity and connect, without a central authority.

```
did:web:qart.app:users:fresh-farms
 │   │        │
 │   │        └── path: /users/fresh-farms/did.json
 │   └── host: qart.app
 └── method: web (HTTPS resolution)
```

WeDID is the browser polyfill for a future where DID resolution is native — the same way early DNS tools became unnecessary once operating systems handled resolution themselves.

## Install

### From source (developer mode)

1. Clone this repo
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `wedid` directory
5. After code changes, click `Reload` for the extension and refresh the page you're testing

### From the Chrome Web Store

Coming soon.

## Privacy

- WeDID only makes network requests when resolving `did:web` identifiers (fetching the DID document over HTTPS). `did:key` resolution is entirely local.
- No analytics. No tracking. No data leaves your browser except the DID document fetch itself.
- Resolution results are cached locally for 5 minutes.

## Links

- [W3C DID Core Spec](https://www.w3.org/TR/did-core/)
- [did:web Method Spec](https://w3c-ccg.github.io/did-method-web/)
- [did:key Method Spec](https://w3c-ccg.github.io/did-method-key/)
- [wedid.app](https://wedid.app)

---

*WeDID is infrastructure, not product. Resolve, connect, get out of the way.*
