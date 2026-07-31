export type PublicSiteLanguage = "th" | "en" | "my";

const STORAGE_KEY = "sahadiesel-public-lang";

export const PUBLIC_SITE_LANGUAGE_OPTIONS: {
  code: PublicSiteLanguage;
  label: string;
}[] = [
  { code: "th", label: "ไทย (TH)" },
  { code: "en", label: "English (EN)" },
  { code: "my", label: "ภาษาพม่า (MY)" },
];

function readGoogTransCookie(): PublicSiteLanguage | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)googtrans=([^;]+)/);
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  const target = value.split("/").pop();
  if (target === "en" || target === "my" || target === "th") return target;
  return null;
}

export function getPublicSiteLanguage(): PublicSiteLanguage {
  if (typeof window === "undefined") return "th";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "my" || stored === "th") return stored;
  return readGoogTransCookie() ?? "th";
}

function writeGoogTransCookie(lang: PublicSiteLanguage) {
  const hostname = window.location.hostname;
  const expired = "Thu, 01 Jan 1970 00:00:00 GMT";
  const clearCookie = (suffix: string) => {
    document.cookie = `googtrans=;path=/;expires=${expired}${suffix}`;
  };

  if (lang === "th") {
    clearCookie("");
    if (hostname && !hostname.startsWith("localhost")) {
      clearCookie(`;domain=.${hostname}`);
    }
    return;
  }

  const value = `googtrans=/th/${lang};path=/`;
  document.cookie = value;
  if (hostname && !hostname.startsWith("localhost")) {
    document.cookie = `${value};domain=.${hostname}`;
  }
}

/** เปลี่ยนภาษาเว็บสาธารณะ แล้วรีเฟรชหน้า */
export function setPublicSiteLanguage(lang: PublicSiteLanguage) {
  localStorage.setItem(STORAGE_KEY, lang);
  writeGoogTransCookie(lang);
  window.location.reload();
}

export function publicSiteLanguageBadge(lang: PublicSiteLanguage): string {
  if (lang === "my") return "MY";
  if (lang === "en") return "EN";
  return "TH";
}
