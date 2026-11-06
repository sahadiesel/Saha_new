/** Firestore named database and Storage bucket in asia-southeast1 (Singapore). */
export const FIRESTORE_DATABASE_ID = "shddatasg";
export const STORAGE_BUCKET = "shd-bucket-sg";

const LEGACY_STORAGE_BUCKETS = [
  "studio-5187516946-67996.firebasestorage.app",
  "studio-5187516946-67996.appspot.com",
];

/** Point download URLs that still name the old US bucket at the Singapore copy. */
export function storageFileUrl(url: string): string {
  let out = url;
  for (const bucket of LEGACY_STORAGE_BUCKETS) {
    if (out.includes(bucket)) out = out.split(bucket).join(STORAGE_BUCKET);
  }
  return out;
}

/** Rewrite storage URLs inside a Firestore document without touching Timestamps. */
export function remapStorageFields<T>(value: T): T {
  if (typeof value === "string") return storageFileUrl(value) as T;
  if (Array.isArray(value)) return value.map((item) => remapStorageFields(item)) as T;
  if (value && typeof value === "object") {
    if (typeof (value as { toDate?: unknown }).toDate === "function") return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = remapStorageFields(child);
    }
    return out as T;
  }
  return value;
}

/**
 * The Firestore client puts (default) in "create index" links even when the
 * query ran on the named Singapore database. Same-length rewrite keeps the
 * protobuf inside create_composite valid.
 */
export function firestoreIndexUrl(url: string): string {
  const fromName = "(default)";
  let out = url
    .replaceAll("/databases/-default-/", `/databases/${FIRESTORE_DATABASE_ID}/`)
    .replaceAll("/databases/(default)/", `/databases/${FIRESTORE_DATABASE_ID}/`)
    .replaceAll("/databases/%28default%29/", `/databases/${FIRESTORE_DATABASE_ID}/`);
  if (fromName.length !== FIRESTORE_DATABASE_ID.length) return out;
  return out.replace(/create_composite=([^&#]+)/g, (_all, token: string) => {
    try {
      const raw = decodeURIComponent(token);
      const urlSafe = raw.includes("-") || raw.includes("_");
      const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (raw.length % 4)) % 4);
      const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const from = Array.from(fromName, (c) => c.charCodeAt(0));
      const to = Array.from(FIRESTORE_DATABASE_ID, (c) => c.charCodeAt(0));
      for (let i = 0; i <= bytes.length - from.length; i++) {
        let match = true;
        for (let j = 0; j < from.length; j++) {
          if (bytes[i + j] !== from[j]) {
            match = false;
            break;
          }
        }
        if (!match) continue;
        for (let j = 0; j < to.length; j++) bytes[i + j] = to[j];
        i += from.length - 1;
      }
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      let encoded = btoa(binary).replace(/=+$/, "");
      if (urlSafe) encoded = encoded.replace(/\+/g, "-").replace(/\//g, "_");
      return `create_composite=${encoded}`;
    } catch {
      return `create_composite=${token}`;
    }
  });
}
