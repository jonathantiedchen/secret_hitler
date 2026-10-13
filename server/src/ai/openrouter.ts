// OpenRouter API client for LLM calls

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  // US dollars (OpenRouter credits); see costSource for how it was determined
  cost: number;
  costSource: CostSource;
  // 'length' means the reply was cut off at the token limit
  finishReason?: string;
}

// reported: charged amount from OpenRouter; estimated: from the model's listed per-token price;
// unknown: neither was available (cost counted as 0)
export type CostSource = 'reported' | 'estimated' | 'unknown';

// USD per token
export interface ModelPricing {
  prompt: number;
  completion: number;
}

export function extractCost(
  usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined,
  pricing: ModelPricing | undefined
): { cost: number; costSource: CostSource } {
  if (typeof usage?.cost === 'number') return { cost: usage.cost, costSource: 'reported' };
  if (pricing) {
    const cost = (usage?.prompt_tokens ?? 0) * pricing.prompt + (usage?.completion_tokens ?? 0) * pricing.completion;
    return { cost, costSource: 'estimated' };
  }
  return { cost: 0, costSource: 'unknown' };
}

// Why a response had no text, from the fields OpenRouter passes through (shown in the game's abort reason)
export function describeEmptyResponse(data: {
  error?: unknown;
  provider?: string;
  usage?: { completion_tokens?: number };
  choices?: Array<{ finish_reason?: string; native_finish_reason?: string; message?: { refusal?: unknown; reasoning?: unknown; tool_calls?: unknown } }>;
}): string {
  const choice = data.choices?.[0];
  const parts = [
    data.error !== undefined && `error: ${JSON.stringify(data.error).slice(0, 300)}`,
    !data.choices?.length && 'no choices',
    choice?.finish_reason && `finish_reason: ${choice.finish_reason}`,
    choice?.native_finish_reason && `native_finish_reason: ${choice.native_finish_reason}`,
    choice?.message?.refusal && `refusal: ${String(choice.message.refusal).slice(0, 300)}`,
    choice?.message?.reasoning && `reasoning only (${String(choice.message.reasoning).length} characters)`,
    choice?.message?.tool_calls && 'tool calls instead of text',
    data.usage && `${data.usage.completion_tokens ?? 0} completion tokens`,
    data.provider && `provider: ${data.provider}`,
  ].filter(Boolean);
  return parts.length ? ` (${parts.join('; ')})` : '';
}

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl = 'https://openrouter.ai/api/v1';

  // Listed prices, fetched once and only if a response lacks a reported cost
  private pricing: Promise<Map<string, ModelPricing>> | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async getPricing(): Promise<Map<string, ModelPricing>> {
    this.pricing ??= fetch(`${this.baseUrl}/models`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: { data: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> }) =>
        new Map(body.data.map((m) => [m.id, { prompt: Number(m.pricing?.prompt ?? NaN), completion: Number(m.pricing?.completion ?? NaN) }])))
      .catch((error) => {
        console.warn('[OpenRouter] Could not load model prices:', error);
        return new Map<string, ModelPricing>();
      });
    return this.pricing;
  }

  async chat(
    model: string,
    messages: ChatMessage[],
    options: {
      temperature?: number;
      maxTokens?: number;
    } = {}
  ): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60 second timeout

    try {
      console.log(`[OpenRouter] Calling ${model}...`);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://secret-hitler-llm.local',
          'X-Title': 'Secret Hitler LLM Arena',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 1500,
          // Ask for a JSON object; providers that don't support it ignore the parameter
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[OpenRouter] API error: ${response.status} - ${error}`);
        throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];

      if (!choice?.message?.content) {
        console.error(`[OpenRouter] Invalid response:`, JSON.stringify(data));
        throw new Error(`OpenRouter returned empty response${describeEmptyResponse(data)}`);
      }

      // OpenRouter reports the charged cost; otherwise use the model's listed price
      let { cost, costSource } = extractCost(data.usage, undefined);
      if (costSource !== 'reported') {
        const prices = await this.getPricing();
        const listed = [prices.get(model), prices.get(data.model)].find((p) => p && Number.isFinite(p.prompt) && Number.isFinite(p.completion));
        ({ cost, costSource } = extractCost(data.usage, listed));
        console.warn(`[OpenRouter] No reported cost for ${model}; ${costSource === 'estimated' ? 'estimated from listed prices' : 'cost unknown'}`);
      }

      console.log(`[OpenRouter] Success: ${data.usage?.total_tokens || 0} tokens, $${cost.toFixed(6)} (${costSource})`);

      return {
        content: choice.message.content,
        model: data.model,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        cost,
        costSource,
        finishReason: choice.finish_reason,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`[OpenRouter] Request timed out after 60s`);
        throw new Error('OpenRouter request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Mock client for development without API key
export class MockLLMClient {
  private delay: number;

  constructor(delay = 500) {
    this.delay = delay;
  }

  async chat(
    model: string,
    messages: ChatMessage[],
    _options: { temperature?: number; maxTokens?: number } = {}
  ): Promise<LLMResponse> {
    await new Promise((resolve) => setTimeout(resolve, this.delay));

    // Generate mock response based on context; the 'mock-invalid' model never answers usably
    const lastMessage = messages[messages.length - 1]?.content || '';
    let content = model === 'mock-invalid' ? 'I would rather not answer in JSON.' : this.generateMockResponse(lastMessage, model);

    return {
      content,
      model,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      cost: 0,
      costSource: 'reported',
    };
  }

  private generateMockResponse(context: string, _model: string): string {
    // Extract valid candidates from context if present
    const candidatesMatch = context.match(/Valid candidates: ([^\n]+)/);
    const validCandidates = candidatesMatch
      ? candidatesMatch[1].split(', ').map(s => s.trim())
      : ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'];

    // Simple mock responses based on context keywords
    if (context.includes('PHASE: NOMINATION')) {
      const name = validCandidates[Math.floor(Math.random() * validCandidates.length)];
      const thoughts = [
        `${name} has been consistent. I think they're trustworthy.`,
        `I'm taking a risk with ${name}, but let's see how this plays out.`,
        `${name} seems like a safe choice right now.`,
        `I've been watching ${name} closely. Time to test them.`,
      ];
      const dialogues = [
        `I nominate ${name} as Chancellor. Let's see what they can do.`,
        `${name}, I'd like you to be my Chancellor.`,
        `I'm going with ${name}. I think they'll serve us well.`,
        `${name} for Chancellor. Any objections?`,
      ];
      return JSON.stringify({
        thought: thoughts[Math.floor(Math.random() * thoughts.length)],
        action: { type: 'nominate', target: name },
        dialogue: dialogues[Math.floor(Math.random() * dialogues.length)],
      });
    }

    if (context.includes('PHASE: VOTING')) {
      const vote = Math.random() > 0.3 ? 'ja' : 'nein';
      const jaThoughts = [
        'This pairing seems trustworthy.',
        'I don\'t see a reason to reject this.',
        'Let\'s give them a chance.',
      ];
      const neinThoughts = [
        'Something feels off about this nomination.',
        'I don\'t trust one of them.',
        'We should wait for a better pairing.',
      ];
      const jaDialogues = [
        'I support this government.',
        'JA. Let\'s move forward.',
        'I\'m voting yes on this one.',
      ];
      const neinDialogues = [
        'I have concerns about this pairing.',
        'NEIN. I don\'t trust this.',
        'I\'m voting against this government.',
      ];
      return JSON.stringify({
        thought: vote === 'ja'
          ? jaThoughts[Math.floor(Math.random() * jaThoughts.length)]
          : neinThoughts[Math.floor(Math.random() * neinThoughts.length)],
        action: { type: 'vote', vote },
        dialogue: vote === 'ja'
          ? jaDialogues[Math.floor(Math.random() * jaDialogues.length)]
          : neinDialogues[Math.floor(Math.random() * neinDialogues.length)],
      });
    }

    if (context.includes('PHASE: LEGISLATION (President)')) {
      const index = Math.floor(Math.random() * 3);
      const thoughts = [
        'I\'ll discard this one strategically...',
        'This is a tough choice, but I\'ll go with my gut.',
        'Let me give the Chancellor a fair choice.',
      ];
      const dialogues = [
        'The deck wasn\'t kind to us this round.',
        'I\'ve made my choice. Over to you, Chancellor.',
        'Interesting cards this round...',
      ];
      return JSON.stringify({
        thought: thoughts[Math.floor(Math.random() * thoughts.length)],
        action: { type: 'discard', index },
        dialogue: dialogues[Math.floor(Math.random() * dialogues.length)],
      });
    }

    if (context.includes('PHASE: LEGISLATION (Chancellor)')) {
      if (context.includes('VETO OPTION') && Math.random() < 0.3) {
        return JSON.stringify({
          thought: 'I don\'t like either of these. Let\'s try a veto.',
          action: { type: 'veto' },
          dialogue: 'I wish to veto this agenda.',
        });
      }
      const index = Math.floor(Math.random() * 2);
      const thoughts = [
        'I need to make the right choice here...',
        'This decision could change the game.',
        'Let me think about what\'s best for my team.',
      ];
      const dialogues = [
        'I\'ve made my decision.',
        'This is what we\'re going with.',
        'The President gave me an interesting choice.',
      ];
      return JSON.stringify({
        thought: thoughts[Math.floor(Math.random() * thoughts.length)],
        action: { type: 'enact', index },
        dialogue: dialogues[Math.floor(Math.random() * dialogues.length)],
      });
    }

    if (context.includes('PHASE: CLAIM')) {
      // Mostly truthful, sometimes a lie (one card flipped), sometimes no claim
      const seen = context.match(/Privately, for you only: [^\n]*/)?.[0] ?? '';
      const cards = seen.match(/LIBERAL|FASCIST/g) ?? [];
      const roll = Math.random();
      if (roll < 0.1) {
        return JSON.stringify({ thought: 'Better not to commit to anything.', action: { type: 'claim', cards: null, party: null }, dialogue: 'I\'d rather not say.' });
      }
      const flip = (c: string) => (c === 'LIBERAL' ? 'FASCIST' : 'LIBERAL');
      const lie = roll < 0.3;
      if (context.includes('PHASE: CLAIM (Investigation)')) {
        // The private line ends with the party; the name before it may not contain card words
        const party = cards[cards.length - 1] ?? 'LIBERAL';
        const claimed = lie ? flip(party) : party;
        return JSON.stringify({ thought: lie ? 'I will misreport this.' : 'I will report what I saw.', action: { type: 'claim', party: claimed }, dialogue: `They are ${claimed}.` });
      }
      // Legislation lines also mention the enacted card at the end; keep only the cards seen
      const count = context.includes('PHASE: CLAIM (Chancellor)') ? 2 : 3;
      const actual = cards.slice(0, count);
      const claimed = lie ? [flip(actual[0]), ...actual.slice(1)] : actual;
      return JSON.stringify({ thought: lie ? 'I will misreport the cards.' : 'I will report the cards.', action: { type: 'claim', cards: claimed }, dialogue: `I had ${claimed.join(', ')}.` });
    }

    if (context.includes('PHASE: VETO RESPONSE')) {
      const accept = Math.random() < 0.5;
      return JSON.stringify({
        thought: accept ? 'Fine, let\'s scrap this agenda.' : 'No, you will enact one of them.',
        action: { type: 'veto_response', accept },
        dialogue: accept ? 'I agree to the veto.' : 'I refuse the veto.',
      });
    }

    if (context.includes('PHASE: EXECUTION')) {
      const targetsMatch = context.match(/Valid targets: ([^\n]+)/);
      const targets = targetsMatch
        ? targetsMatch[1].split(', ').map(s => s.trim())
        : validCandidates;
      const target = targets[Math.floor(Math.random() * targets.length)];
      return JSON.stringify({
        thought: `I have to make a difficult choice. ${target} has been suspicious.`,
        action: { type: 'execute', target },
        dialogue: `After careful consideration, I'm executing ${target}.`,
      });
    }

    if (context.includes('PHASE: INVESTIGATION')) {
      const targetsMatch = context.match(/Valid targets: ([^\n]+)/);
      const targets = targetsMatch
        ? targetsMatch[1].split(', ').map(s => s.trim())
        : validCandidates;
      const target = targets[Math.floor(Math.random() * targets.length)];
      return JSON.stringify({
        thought: `I want to know more about ${target}.`,
        action: { type: 'investigate', target },
        dialogue: `I'm going to investigate ${target}.`,
      });
    }

    if (context.includes('PHASE: SPECIAL ELECTION')) {
      const targetsMatch = context.match(/Valid targets: ([^\n]+)/);
      const targets = targetsMatch
        ? targetsMatch[1].split(', ').map(s => s.trim())
        : validCandidates;
      const target = targets[Math.floor(Math.random() * targets.length)];
      return JSON.stringify({
        thought: `${target} should be the next President.`,
        action: { type: 'special_elect', target },
        dialogue: `I'm choosing ${target} as the next President.`,
      });
    }

    // Default response
    return JSON.stringify({
      thought: 'I\'m analyzing the situation...',
      dialogue: 'Let me think about this carefully.',
    });
  }
}
