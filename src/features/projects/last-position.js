export const RESUME_KEY = "vogue-marry:last-position:v1";
export const ISLAND_SECTIONS = new Set(["carte", "cap", "journal", "manoeuvres", "arsenal"]);
const SAFE_SLUG = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u;

export function readLastPosition(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(RESUME_KEY) || "null");
    return saved && typeof saved.slug === "string" && SAFE_SLUG.test(saved.slug) && ISLAND_SECTIONS.has(saved.section)
      ? { slug: saved.slug, section: saved.section } : null;
  } catch {
    return null;
  }
}

export function saveLastPosition(storage, slug, section) {
  if (!SAFE_SLUG.test(String(slug)) || !ISLAND_SECTIONS.has(section)) return false;
  try {
    storage?.setItem(RESUME_KEY, JSON.stringify({ slug, section }));
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function browserStorage(browser = typeof window === "undefined" ? null : window) {
  try { return browser?.localStorage || null; } catch { return null; }
}
