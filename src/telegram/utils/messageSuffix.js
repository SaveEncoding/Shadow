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
 * After a successful auto-edit the bot also appends an invisible content stamp
 * (see attachBotStamp). On edited_channel_post, a valid stamp means "we already
 * processed this exact body" and the handler must no-op; if an admin changes the
 * text the stamp no longer matches and the bot may apply the suffix again.
 */

/** Caption limit on Telegram. */
export const CAPTION_MAX_LENGTH = 1024;
/** Text message limit on Telegram. */
export const TEXT_MAX_LENGTH = 4096;

/** Invisible bookends for the bot content-stamp (must differ so lastIndexOf works). */
export const BOT_STAMP_START = "\u2060"; // word joiner
export const BOT_STAMP_END = "\u2063"; // invisible separator
const BIT0 = "\u200b"; // zero-width space
const BIT1 = "\u200c"; // zero-width non-joiner

/**
 * Fast non-crypto hash → 8 hex chars. Only used for anti-loop stamping, not security.
 * @param {string} s
 */
export function hashContent(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h, 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** @param {string} hex */
function encodeHexToZw(hex) {
  let out = "";
  for (const ch of hex) {
    const n = parseInt(ch, 16);
    if (Number.isNaN(n)) continue;
    const bits = n.toString(2).padStart(4, "0");
    for (const b of bits) {
      out += b === "0" ? BIT0 : BIT1;
    }
  }
  return out;
}

/** @param {string} zw */
function decodeZwToHex(zw) {
  if (!zw || zw.length % 4 !== 0) return null;
  let hex = "";
  for (let i = 0; i < zw.length; i += 4) {
    let bits = "";
    for (let j = 0; j < 4; j++) {
      const c = zw[i + j];
      if (c === BIT0) bits += "0";
      else if (c === BIT1) bits += "1";
      else return null;
    }
    hex += parseInt(bits, 2).toString(16);
  }
  return hex;
}

/**
 * Append an invisible stamp that authenticates `text` as last written by the bot.
 * Stamp = START + ZW-encoded hash(text) + END
 * @param {string} text
 */
export function attachBotStamp(text) {
  const base = text ?? "";
  const hex = hashContent(base);
  return base + BOT_STAMP_START + encodeHexToZw(hex) + BOT_STAMP_END;
}

/**
 * Strip a trailing bot stamp if present (valid or not).
 * @param {string|null|undefined} text
 * @returns {{ text: string, hadStamp: boolean, valid: boolean }}
 */
export function stripBotStamp(text) {
  const raw = text ?? "";
  const start = raw.lastIndexOf(BOT_STAMP_START);
  if (start < 0) {
    return { text: raw, hadStamp: false, valid: false };
  }
  const afterStart = raw.slice(start + BOT_STAMP_START.length);
  const end = afterStart.lastIndexOf(BOT_STAMP_END);
  if (end < 0) {
    return { text: raw, hadStamp: false, valid: false };
  }
  const payload = afterStart.slice(0, end);
  const trailing = afterStart.slice(end + BOT_STAMP_END.length);
  // Stamp must be at the very end of the message.
  if (trailing.length > 0) {
    return { text: raw, hadStamp: false, valid: false };
  }

  const body = raw.slice(0, start);
  const hex = decodeZwToHex(payload);
  if (!hex || hex.length !== 8) {
    return { text: body, hadStamp: true, valid: false };
  }
  const valid = hex === hashContent(body);
  return { text: body, hadStamp: true, valid };
}

/**
 * True when the message ends with a stamp that matches the body (bot's own edit).
 * @param {string|null|undefined} text
 */
export function hasValidBotStamp(text) {
  return stripBotStamp(text).valid;
}

/**
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
  // Work on stamp-free body so "already_present" and length checks are clean.
  const stripped = stripBotStamp(text);
  const base = stripped.text;
  const ents = Array.isArray(entities) ? entities.map((e) => ({ ...e })) : [];
  const foot = suffix == null ? "" : String(suffix);

  if (!foot) {
    return { text: base, entities: ents, skipped: "empty_suffix" };
  }

  if (base.endsWith(sep + foot) || base.endsWith(foot)) {
    return { text: base, entities: ents, skipped: "already_present" };
  }

  const addition = sep + foot;
  // Reserve room for stamp (~ 2 bookends + 32 ZW bits for 8 hex chars)
  const stampBudget = BOT_STAMP_START.length + BOT_STAMP_END.length + 32;
  if (base.length + addition.length + stampBudget > maxLen) {
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
  // Ignore invisible stamp when looking for the admin marker.
  const body = stripBotStamp(text).text;
  return body.includes(String(marker));
}
