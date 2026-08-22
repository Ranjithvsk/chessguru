// Formatting + brand config shared by all pages.
export const rupees = (paise?: number | null): string =>
  paise == null ? "" : "₹" + (paise / 100).toLocaleString("en-IN");

export const dateShort = (iso?: string): string =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
export const dateShortYr = (iso?: string): string =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "";
export const dateLong = (iso?: string): string =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";
export const dateRange = (a?: string, b?: string): string => {
  if (!a) return "";
  if (!b || a === b) return dateShort(a);
  return `${dateShort(a)} → ${dateShort(b)}`;
};
export const ago = (iso?: string): string => {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// Rating-type visual language. Same palette as chessguru.cc for family feel.
export const RATING = {
  FIDE:    { label: "FIDE Rated",  bg: "linear-gradient(135deg,#1e40af,#3b82f6)", hero: "/marketing/cat-fide-rated.webp" },
  AICF:    { label: "AICF Rated",  bg: "linear-gradient(135deg,#c2410c,#f97316)", hero: "/marketing/cat-aicf-rated.webp" },
  STATE:   { label: "State Rated", bg: "linear-gradient(135deg,#166534,#22c55e)", hero: "/marketing/cat-state-rated.webp" },
  UNRATED: { label: "Unrated",     bg: "rgba(255,255,255,0.10)",                  hero: "/marketing/cat-open.webp" },
} as const;
export const FORMAT_LABEL: Record<string, string> = { CLASSICAL: "Classical", RAPID: "Rapid", BLITZ: "Blitz" };

// Indian states + UTs — reused by the submit form dropdown.
export const STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh",
  "Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland",
  "Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand",
  "West Bengal","Delhi","Puducherry","Chandigarh","Jammu and Kashmir","Ladakh",
  "Andaman and Nicobar","Dadra and Nagar Haveli and Daman and Diu","Lakshadweep",
] as const;
