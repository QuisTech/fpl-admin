import Groq from "groq-sdk";

// ─── Model Tiers (priority order: best → most available) ───────────────
const MODEL_TIERS = [
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "qwen/qwen3.6-27b",
  "groq/compound",
  "openai/gpt-oss-20b",
] as const;

type ModelTier = (typeof MODEL_TIERS)[number];

// ─── Key Management ────────────────────────────────────────────────────
function getApiKeys(): string[] {
  const keys: string[] = [];
  // Scan process.env for any key starting with GROQ_API_KEY or GROQ_API_KEYS
  const envVarNames = Object.keys(process.env)
    .filter((k) => k.startsWith("GROQ_API_KEY"))
    .sort((a, b) => {
      // Custom sort: GROQ_API_KEY first, then GROQ_API_KEY_2, GROQ_API_KEY_3, etc.
      if (a === "GROQ_API_KEY") return -1;
      if (b === "GROQ_API_KEY") return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });

  for (const varName of envVarNames) {
    const val = process.env[varName];
    if (val && val.trim()) {
      // Support comma-separated keys within a single env variable
      const splitKeys = val
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      for (const k of splitKeys) {
        if (!keys.includes(k)) {
          keys.push(k);
        }
      }
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
  system?: string;
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

  const systemContent =
    options.system ||
    (options.jsonMode
      ? "You are a helpful assistant that responds strictly in valid raw JSON format without reasoning tags or markdown code blocks."
      : undefined);

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (systemContent) {
    messages.push({ role: "system", content: systemContent });
  }
  messages.push({ role: "user", content: options.prompt });

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
            messages,
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
