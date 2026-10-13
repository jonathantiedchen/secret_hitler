// Replies are asked to be one JSON object, but some models wrap it in a ```json fence or put a sentence
// around it (Anthropic models ignore OpenRouter's JSON mode), and some write raw line breaks inside its
// strings (Gemini, in multi-line thoughts), which JSON requires escaped. Take the object they wrote;
// nothing is filled in for them, so a reply without a complete object stays unusable.

const tryParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isObject = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value);

// Escape the control characters (line breaks, tabs) that appear inside string literals; the rest is unchanged
function escapeControlCharsInStrings(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString && !escaped && ch < ' ') {
      out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
      continue;
    }
    if (escaped) escaped = false;
    else if (inString && ch === '\\') escaped = true;
    else if (ch === '"') inString = !inString;
    out += ch;
  }
  return out;
}

// The JSON in a reply, and whether it had to be read leniently (taken out of surrounding text, or with
// line breaks in its strings escaped); null when there is none
export function extractJson(text: string): { value: unknown; unwrapped: boolean } | null {
  const direct = tryParse(text.trim());
  if (direct !== undefined) return { value: direct, unwrapped: false };

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const braces = start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
  const candidates = [fenced, braces].filter((c): c is string => c !== undefined).map((c) => c.trim());
  for (const candidate of [...candidates, ...candidates.map(escapeControlCharsInStrings)]) {
    const value = tryParse(candidate);
    if (isObject(value)) return { value, unwrapped: true };
  }
  return null;
}
