import Groq from "groq-sdk";

// ─── Model Tiers (priority order: best → most available) ───────────────
const MODEL_TIERS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
] as const;

type ModelTier = (typeof MODEL_TIERS)[number];

// ─── Key Management ────────────────────────────────────────────────────
function getApiKeys(): string[] {
  const keys: string[] = [];
  const envKeys = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
  ];
  for (const k of envKeys) {
    if (k && k.trim()) {
      keys.push(k.trim());
    }
  }
  if (keys.length === 0) {
    throw new Error(
      "[LLMClient] FATAL: No valid GROQ_API_KEY environment variables found."
    );
  }
  return keys;
}

// ─── Retry Config ──────────────────────────────────────────────────────
const MAX_RETRIES_PER_KEY = 3;
const BASE_DELAY_MS = 500;

function isRetryableError(err: any): boolean {
  const status = err?.status ?? err?.httpStatusCode ?? err?.code;
  // 429 = rate limit, 500/502/503 = server errors, ECONNRESET etc.
  if ([429, 500, 502, 503].includes(status)) return true;
  const msg = String(err?.message || "").toLowerCase();
  if (
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("resource exhausted") ||
    msg.includes("overloaded") ||
    msg.includes("unavailable") ||
    msg.includes("internal") ||
    msg.includes("econnreset") ||
    msg.includes("timeout") ||
    msg.includes("fetch failed")
  )
    return true;
  return false;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Types ─────────────────────────────────────────────────────────────
export interface LLMCallOptions {
  prompt: string;
  temperature?: number;
  jsonMode?: boolean;
}

export interface LLMCallResult {
  text: string;
  modelUsed: ModelTier;
  keyIndex: number;
  attempts: number;
}

// ─── Main Resilient Caller ─────────────────────────────────────────────
export async function callLLMWithFallback(
  options: LLMCallOptions
): Promise<LLMCallResult> {
  const keys = getApiKeys();
  const errors: Array<{
    model: string;
    keyIndex: number;
    attempt: number;
    error: string;
  }> = [];
  let totalAttempts = 0;

  for (const model of MODEL_TIERS) {
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      const groq = new Groq({ apiKey: keys[keyIndex] });

      for (let attempt = 1; attempt <= MAX_RETRIES_PER_KEY; attempt++) {
        totalAttempts++;
        try {
          console.log(
            `[LLMClient] Trying model=${model} key=${keyIndex + 1}/${keys.length} attempt=${attempt}/${MAX_RETRIES_PER_KEY}`
          );

          const response = await groq.chat.completions.create({
            model,
            messages: [{ role: "user", content: options.prompt }],
            temperature: options.temperature ?? 0.3,
            ...(options.jsonMode
              ? { response_format: { type: "json_object" } }
              : {}),
          });

          const text = response.choices[0]?.message?.content;
          if (!text || text.trim().length === 0) {
            throw new Error("Empty response from LLM");
          }

          console.log(
            `[LLMClient] ✓ Success on model=${model} key=${keyIndex + 1} after ${totalAttempts} total attempt(s)`
          );

          return {
            text,
            modelUsed: model,
            keyIndex: keyIndex + 1,
            attempts: totalAttempts,
          };
        } catch (err: any) {
          const errorMsg = err?.message || String(err);
          errors.push({
            model,
            keyIndex: keyIndex + 1,
            attempt,
            error: errorMsg,
          });
          console.warn(
            `[LLMClient] ✗ Failed model=${model} key=${keyIndex + 1} attempt=${attempt}: ${errorMsg}`
          );

          // Non-retryable errors: skip retries, move to next key
          if (!isRetryableError(err)) {
            console.warn(
              `[LLMClient] Non-retryable error, skipping remaining retries for this key`
            );
            break;
          }

          if (attempt < MAX_RETRIES_PER_KEY) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            console.log(`[LLMClient] Backing off ${delay}ms...`);
            await sleep(delay);
          }
        }
      }
    }
  }

  console.error(
    `[LLMClient] EXHAUSTED all ${totalAttempts} attempts across ${MODEL_TIERS.length} models and ${keys.length} keys`
  );
  console.error(`[LLMClient] Error log:`, JSON.stringify(errors, null, 2));

  throw new LLMExhaustedError(
    `All LLM API keys and models exhausted after ${totalAttempts} attempts. Last error: ${errors[errors.length - 1]?.error}`,
    errors
  );
}

export class LLMExhaustedError extends Error {
  public readonly errors: Array<{
    model: string;
    keyIndex: number;
    attempt: number;
    error: string;
  }>;

  constructor(
    message: string,
    errors: Array<{
      model: string;
      keyIndex: number;
      attempt: number;
      error: string;
    }>
  ) {
    super(message);
    this.name = "LLMExhaustedError";
    this.errors = errors;
  }
}
