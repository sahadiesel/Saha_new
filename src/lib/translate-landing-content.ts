import type { LandingPageContent } from "@/app/page";

const LANDING_TEXT_FIELDS: (keyof LandingPageContent)[] = [
  "heroTitle",
  "heroDescription",
  "buttonText",
  "servicesTitle",
  "s1Title",
  "s1Desc",
  "s2Title",
  "s2Desc",
  "s3Title",
  "s3Desc",
  "s4Title",
  "s4Desc",
  "footerAboutTitle",
  "footerAboutDesc",
  "footerContactTitle",
];

export function translateLandingContent(
  content: LandingPageContent,
  t: (label: string) => string
): LandingPageContent {
  const out = { ...content };
  for (const key of LANDING_TEXT_FIELDS) {
    const value = out[key];
    if (typeof value === "string" && value.trim()) {
      out[key] = t(value);
    }
  }
  return out;
}
