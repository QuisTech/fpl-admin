import { callGeminiWithFallback, GeminiExhaustedError } from '../../lib/gemini-client.js';
import { logAIDecision } from '../../lib/firestore.js';

export interface TransferDecision {
  action: 'ROLL' | 'TRANSFER' | 'CHIP';
  transfersIn?: number[];
  transfersOut?: number[];
  chipName?: 'WC' | 'FH' | 'BB' | 'TC';
  reasoning: string;
  confidence: number;
}

/**
 * Safely parse JSON from Gemini response text.
 * Handles markdown-wrapped JSON (```json ... ```) and malformed responses.
 */
function safeParseJSON(text: string): any {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("[GeminiAgent] Failed to parse JSON response:", cleaned.substring(0, 200));
    throw new Error(`Invalid JSON from Gemini: ${(e as Error).message}`);
  }
}

export async function getGeminiTransferDecision(
  userId: string,
  squad: any[],
  gameweek: number,
  fixtures: any[],
  bank: number,
  freeTransfers: number,
  chipState: Record<string, number>,
  riskMode: string
): Promise<TransferDecision> {
  
  // Build context for Gemini
  const squadSummary = squad.map(p => 
    `${p.name} (${p.position}) - £${(p.cost/10).toFixed(1)}M - xP: ${p.xP}`
  ).join('\n');
  
  const fixturesSummary = fixtures.slice(0, 5).map(f => 
    `GW${f.gw}: ${f.team} vs ${f.opponent} (FDR: ${f.difficulty})`
  ).join('\n');
  
  const prompt = `
    You are an elite FPL AI agent. Analyze this situation and make a decision.
    
    GAMEWEEK: ${gameweek}
    RISK MODE: ${riskMode.toUpperCase()}
    FREE TRANSFERS: ${freeTransfers}
    BANK: £${(bank/10).toFixed(1)}M
    
    CURRENT SQUAD:
    ${squadSummary}
    
    UPCOMING FIXTURES (next 5 GWs):
    ${fixturesSummary}
    
    CHIPS AVAILABLE:
    ${Object.entries(chipState).filter(([_, avail]) => avail).map(([chip]) => chip).join(', ') || 'None'}
    
    RESPOND WITH JSON:
    {
      "action": "ROLL" or "TRANSFER" or "CHIP",
      "transfersIn": [playerIds] (if action is TRANSFER),
      "transfersOut": [playerIds] (if action is TRANSFER),
      "chipName": "WC"/"FH"/"BB"/"TC" (if action is CHIP),
      "reasoning": "your strategic reasoning here",
      "confidence": 0-100
    }
  `;
  
  const result = await callGeminiWithFallback({
    prompt,
    temperature: 0.3,
    jsonMode: true,
  });

  const decision = safeParseJSON(result.text);
  
  // Log the decision to Firestore (non-blocking — don't let log failure crash the response)
  logAIDecision({
    userId,
    gameweek,
    decision: decision.action,
    reasoning: decision.reasoning,
    confidence: decision.confidence,
    details: {
      transfersIn: decision.transfersIn,
      transfersOut: decision.transfersOut,
      chipName: decision.chipName
    },
    modelUsed: result.modelUsed,
    riskMode
  }).catch(err => {
    console.error("[GeminiAgent] Non-fatal: Failed to log decision to Firestore:", err.message);
  });
  
  return decision;
}

export async function getGeminiChipAdvice(
  userId: string,
  squad: any[],
  chips: Record<string, number>,
  gameweek: number,
  fixtures: any[]
): Promise<{ recommendation: string; reasoning: string; confidence: number }> {
  
  const prompt = `
    Analyze if I should play a chip this GW${gameweek}.
    
    Squad strength: Avg xP ${(squad.reduce((s,p)=>s+p.xP,0)/15).toFixed(1)}
    Chips available: ${Object.entries(chips).filter(([_,a]) => a).map(([c]) => c).join(', ')}
    
    Recommend: WC, FH, BB, TC, or HOLD.
    Respond with JSON: {"recommendation": "WC/HOLD/etc", "reasoning": "...", "confidence": 0-100}
  `;
  
  const result = await callGeminiWithFallback({
    prompt,
    temperature: 0.2,
    jsonMode: true,
  });

  const decision = safeParseJSON(result.text);
  
  // Non-blocking Firestore log
  logAIDecision({
    userId,
    gameweek,
    decision: `CHIP_${decision.recommendation}`,
    reasoning: decision.reasoning,
    confidence: decision.confidence,
    details: { chipName: decision.recommendation !== 'HOLD' ? decision.recommendation : undefined },
    modelUsed: result.modelUsed
  }).catch(err => {
    console.error("[GeminiAgent] Non-fatal: Failed to log chip advice to Firestore:", err.message);
  });
  
  return decision;
}
