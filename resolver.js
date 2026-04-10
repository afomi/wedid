/**
 * WeDID Universal DID Resolver
 *
 * Resolves W3C Decentralized Identifiers to DID Documents.
 * Supports: did:web, did:key (Ed25519, secp256k1)
 * Extensible for: did:ion, did:pkh, did:btc, etc.
 *
 * https://www.w3.org/TR/did-core/
 * https://w3c-ccg.github.io/did-method-web/
 * https://w3c-ccg.github.io/did-method-key/
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class DIDResolver {
  constructor() {
    this.cache = new Map();
    this.methods = {
      web: this.resolveWeb.bind(this),
      key: this.resolveKey.bind(this),
    };
  }

  /**
   * Resolve a DID to its DID Document.
   * Returns { didDocument, didResolutionMetadata, didDocumentMetadata }
   */
  async resolve(did) {
    if (!did || typeof did !== "string") {
      return this.error("invalidDid", "DID must be a non-empty string");
    }

    const parsed = this.parse(did);
    if (!parsed) {
      return this.error("invalidDid", `Cannot parse DID: ${did}`);
    }

    // Check cache
    const cached = this.cache.get(did);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return {
        ...cached.result,
        didResolutionMetadata: {
          ...cached.result.didResolutionMetadata,
          cached: true,
        },
      };
    }

    const resolver = this.methods[parsed.method];
    if (!resolver) {
      return this.error(
        "methodNotSupported",
        `DID method "${parsed.method}" is not supported. Supported: ${Object.keys(this.methods).join(", ")}`
      );
    }

    try {
      const result = await resolver(parsed);
      this.cache.set(did, { result, timestamp: Date.now() });
      return result;
    } catch (err) {
      return this.error("internalError", err.message);
    }
  }

  /**
   * Parse a DID string into { method, id, path, query, fragment, full }
   */
  parse(did) {
    // did:method:method-specific-id[/path][?query][#fragment]
    const match = did.match(
      /^did:([a-z0-9]+):([a-zA-Z0-9._:%-]+)(\/[^?#]*)?(\\?[^#]*)?(#.*)?$/
    );
    if (!match) return null;

    return {
      method: match[1],
      id: match[2],
      path: match[3] || "",
      query: match[4] || "",
      fragment: match[5] || "",
      full: did.split("#")[0].split("?")[0], // canonical form without fragment/query
    };
  }

  /**
   * did:web resolution — https://w3c-ccg.github.io/did-method-web/
   *
   * did:web:example.com → https://example.com/.well-known/did.json
   * did:web:example.com:users:alice → https://example.com/users/alice/did.json
   */
  async resolveWeb(parsed) {
    const parts = parsed.id.split(":");
    const host = decodeURIComponent(parts[0]);
    const pathSegments = parts.slice(1);

    let url;
    if (pathSegments.length === 0) {
      url = `https://${host}/.well-known/did.json`;
    } else {
      const path = pathSegments.map(decodeURIComponent).join("/");
      url = `https://${host}/${path}/did.json`;
    }

    const response = await fetch(url, {
      headers: { Accept: "application/did+json, application/json" },
    });

    if (!response.ok) {
      return this.error(
        "notFound",
        `DID document not found at ${url} (HTTP ${response.status})`
      );
    }

    const contentType = response.headers.get("content-type") || "";
    const didDocument = await response.json();

    // Verify the document ID matches the DID
    if (didDocument.id && didDocument.id !== parsed.full) {
      return this.error(
        "invalidDidDocument",
        `DID document ID "${didDocument.id}" does not match requested DID "${parsed.full}"`
      );
    }

    return {
      didDocument,
      didResolutionMetadata: {
        contentType: contentType.includes("did+json")
          ? "application/did+json"
          : "application/json",
        retrieved: new Date().toISOString(),
        url,
      },
      didDocumentMetadata: {},
    };
  }

  /**
   * did:key resolution — https://w3c-ccg.github.io/did-method-key/
   *
   * Derives a DID Document from a multibase-encoded public key.
   * The DID Document is self-certifying — no network fetch needed.
   */
  async resolveKey(parsed) {
    const multibaseKey = parsed.id;

    if (!multibaseKey.startsWith("z")) {
      return this.error(
        "invalidDid",
        "did:key identifiers must use base58btc (z) multibase encoding"
      );
    }

    // Decode base58btc (without the 'z' prefix)
    const keyBytes = base58btcDecode(multibaseKey.slice(1));
    if (!keyBytes) {
      return this.error("invalidDid", "Failed to decode multibase key");
    }

    // Read multicodec prefix
    const codec = identifyMulticodec(keyBytes);
    if (!codec) {
      return this.error(
        "invalidDid",
        "Unrecognized multicodec prefix in did:key"
      );
    }

    const publicKeyBytes = keyBytes.slice(codec.prefixLength);
    const did = `did:key:${multibaseKey}`;
    const keyId = `${did}#${multibaseKey}`;

    const didDocument = {
      "@context": [
        "https://www.w3.org/ns/did/v1",
        "https://w3id.org/security/multikey/v1",
      ],
      id: did,
      verificationMethod: [
        {
          id: keyId,
          type: "Multikey",
          controller: did,
          publicKeyMultibase: multibaseKey,
        },
      ],
      authentication: [keyId],
      assertionMethod: [keyId],
      capabilityInvocation: [keyId],
      capabilityDelegation: [keyId],
    };

    // Add key agreement for Ed25519 (X25519 conversion)
    if (codec.name === "ed25519-pub") {
      const agreementKeyId = `${did}#${multibaseKey}-x25519`;
      didDocument.keyAgreement = [
        {
          id: agreementKeyId,
          type: "Multikey",
          controller: did,
          publicKeyMultibase: multibaseKey, // simplified; proper impl converts to X25519
        },
      ];
    }

    return {
      didDocument,
      didResolutionMetadata: {
        contentType: "application/did+json",
        retrieved: new Date().toISOString(),
        selfCertified: true,
      },
      didDocumentMetadata: {},
    };
  }

  /**
   * Extract service endpoints from a DID Document.
   */
  static getServices(didDocument, type = null) {
    const services = didDocument.service || [];
    if (!type) return services;
    return services.filter((s) => s.type === type);
  }

  /**
   * Extract verification methods from a DID Document.
   */
  static getVerificationMethods(didDocument) {
    return didDocument.verificationMethod || [];
  }

  /**
   * Register a custom DID method resolver.
   */
  registerMethod(method, resolverFn) {
    this.methods[method] = resolverFn;
  }

  /**
   * Clear the resolution cache.
   */
  clearCache() {
    this.cache.clear();
  }

  error(code, message) {
    return {
      didDocument: null,
      didResolutionMetadata: { error: code, message },
      didDocumentMetadata: {},
    };
  }
}

// --- Multicodec / Multibase helpers ---

const MULTICODEC_TABLE = [
  { prefix: [0xed, 0x01], prefixLength: 2, name: "ed25519-pub" },
  { prefix: [0xe7, 0x01], prefixLength: 2, name: "secp256k1-pub" },
  { prefix: [0x80, 0x24], prefixLength: 2, name: "p256-pub" },
  { prefix: [0x81, 0x24], prefixLength: 2, name: "p384-pub" },
  { prefix: [0xec, 0x01], prefixLength: 2, name: "x25519-pub" },
];

function identifyMulticodec(bytes) {
  for (const entry of MULTICODEC_TABLE) {
    if (
      entry.prefix.every((b, i) => bytes[i] === b) &&
      bytes.length > entry.prefixLength
    ) {
      return entry;
    }
  }
  return null;
}

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58btcDecode(str) {
  try {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const idx = BASE58_ALPHABET.indexOf(str[i]);
      if (idx < 0) return null;

      let carry = idx;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }

    // Handle leading '1's (zeros in base58)
    for (let i = 0; i < str.length && str[i] === "1"; i++) {
      bytes.push(0);
    }

    return new Uint8Array(bytes.reverse());
  } catch {
    return null;
  }
}

// Export for use in background.js and content.js
if (typeof globalThis !== "undefined") {
  globalThis.DIDResolver = DIDResolver;
}
