export type PublicSiteLanguage = "th" | "en" | "mm";

const STORAGE_KEY = "sahadiesel-public-lang";

export const PUBLIC_SITE_LANGUAGE_OPTIONS: {
  code: PublicSiteLanguage;
  label: string;
}[] = [
  { code: "th", label: "ไทย (TH)" },
  { code: "en", label: "English (EN)" },
  { code: "mm", label: "မြန်မာ (MM)" },
];

/** ล้าง cookie/สถานะ Google Translate ที่ทำให้ React DOM พัง */
export function clearGoogleTranslateArtifacts() {
  if (typeof document === "undefined") return;

  const expired = "Thu, 01 Jan 1970 00:00:00 GMT";
  document.cookie = `googtrans=;path=/;expires=${expired}`;
  const hostname = window.location.hostname;
  if (hostname && !hostname.startsWith("localhost")) {
    document.cookie = `googtrans=;path=/;expires=${expired};domain=.${hostname}`;
  }

  document.documentElement.classList.remove("translated-ltr", "translated-rtl");
  document.body?.classList.remove("translated-ltr", "translated-rtl");

  document.getElementById("google-translate-script")?.remove();
  document.getElementById("google_translate_element")?.replaceChildren();
}

export function getPublicSiteLanguage(): PublicSiteLanguage {
  if (typeof window === "undefined") return "th";
  const stored = localStorage.getItem(STORAGE_KEY);
  // migrate legacy code "my" (Malaysia ISO) → "mm" (Myanmar ISO)
  if (stored === "my") {
    localStorage.setItem(STORAGE_KEY, "mm");
    return "mm";
  }
  if (stored === "en" || stored === "mm" || stored === "th") return stored;
  return "th";
}

/** เปลี่ยนภาษา แล้วรีเฟรชหน้า (ใช้พจนานุกรมในแอป ไม่ใช้ Google Translate) */
export function setPublicSiteLanguage(lang: PublicSiteLanguage) {
  localStorage.setItem(STORAGE_KEY, lang);
  clearGoogleTranslateArtifacts();
  window.location.reload();
}

export function publicSiteLanguageBadge(lang: PublicSiteLanguage): string {
  if (lang === "mm") return "MM";
  if (lang === "en") return "EN";
  return "TH";
}
