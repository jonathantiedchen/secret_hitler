// Replies are asked to be one JSON object, but some models wrap it in a ```json fence or put a sentence
// around it (Anthropic models ignore OpenRouter's JSON mode). Take the object they wrote; nothing is
// filled in for them, so a reply without a complete object stays unusable.

const tryParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isObject = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value);

// The JSON in a reply, and whether it had to be taken out of surrounding text; null when there is none
export function extractJson(text: string): { value: unknown; unwrapped: boolean } | null {
  const direct = tryParse(text.trim());
  if (direct !== undefined) return { value: direct, unwrapped: false };

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const braces = start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
  for (const candidate of [fenced, braces]) {
    const value = candidate === undefined ? undefined : tryParse(candidate.trim());
    if (isObject(value)) return { value, unwrapped: true };
  }
  return null;
}
