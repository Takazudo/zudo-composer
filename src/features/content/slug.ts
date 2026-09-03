/**
 * URL-friendly text derived from a human title.
 *
 * Deliberately no transliteration: Content stores slugs verbatim and its own
 * browser journey authors "東京", so folding letters to ASCII here would invent
 * a route the author never wrote — and stripping combining marks to do it would
 * quietly turn "ガ" into "カ". Everything that is neither a letter nor a number
 * collapses to a single hyphen instead, which is the part every slug agrees on.
 */
export function deriveSlug(title: string): string {
  return title
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
