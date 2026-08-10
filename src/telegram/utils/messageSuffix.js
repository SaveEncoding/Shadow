/**
 * Append a channel official suffix while preserving Telegram MessageEntity offsets.
 *
 * Telegram entity offsets are UTF-16 code units — the same metric as JavaScript's
 * string.length for typical BMP + surrogate-pair text.
 *
 * Original entities are left unchanged (suffix is always appended at the end).
 * Optional suffixEntities are expressed relative to the start of `suffix` and
 * are shifted by base.length + sep.length.
 *
 * @param {string|null|undefined} text
 * @param {Array<object>|null|undefined} entities
 * @param {string|null|undefined} suffix
 * @param {{ maxLen?: number, sep?: string, suffixEntities?: Array<object> }} [opts]
 * @returns {{ text: string, entities: Array<object>, skipped: null|string }}
 */
export function appendSuffixPreservingEntities(
  text,
  entities,
  suffix,
  { maxLen = 4096, sep = "\n\n", suffixEntities = [] } = {}
) {
  const base = text ?? "";
  const ents = Array.isArray(entities) ? entities.map((e) => ({ ...e })) : [];
  const foot = suffix == null ? "" : String(suffix);

  if (!foot) {
    return { text: base, entities: ents, skipped: "empty_suffix" };
  }

  if (base.endsWith(sep + foot) || base.endsWith(foot)) {
    return { text: base, entities: ents, skipped: "already_present" };
  }

  const addition = sep + foot;
  if (base.length + addition.length > maxLen) {
    return { text: base, entities: ents, skipped: "too_long" };
  }

  const offsetBase = base.length + sep.length;
  const extra = (Array.isArray(suffixEntities) ? suffixEntities : []).map((e) => ({
    ...e,
    offset: e.offset + offsetBase,
  }));

  return {
    text: base + addition,
    entities: ents.concat(extra),
    skipped: null,
  };
}

/** Caption limit on Telegram. */
export const CAPTION_MAX_LENGTH = 1024;
/** Text message limit on Telegram. */
export const TEXT_MAX_LENGTH = 4096;

/**
 * Pick text/entities from a message-like object (channel post or forward copy).
 * @returns {{ kind: 'text'|'caption'|null, text: string, entities: Array<object>, maxLen: number }}
 */
export function extractEditableContent(message) {
  if (!message) {
    return { kind: null, text: "", entities: [], maxLen: TEXT_MAX_LENGTH };
  }
  if (typeof message.text === "string") {
    return {
      kind: "text",
      text: message.text,
      entities: message.entities ?? [],
      maxLen: TEXT_MAX_LENGTH,
    };
  }
  if (typeof message.caption === "string") {
    return {
      kind: "caption",
      text: message.caption,
      entities: message.caption_entities ?? [],
      maxLen: CAPTION_MAX_LENGTH,
    };
  }
  return { kind: null, text: "", entities: [], maxLen: TEXT_MAX_LENGTH };
}

/**
 * True when channel admins opted this post out of auto-suffix via a marker substring.
 * Matching is plain substring (case-sensitive) so admins control exact characters.
 *
 * @param {string|null|undefined} text
 * @param {string|null|undefined} marker
 */
export function shouldSkipAutoSuffix(text, marker) {
  if (marker == null || marker === "") return false;
  const body = text ?? "";
  return body.includes(String(marker));
}

