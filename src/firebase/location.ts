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
