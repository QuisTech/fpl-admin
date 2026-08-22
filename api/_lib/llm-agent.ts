import { callLLMWithFallback, LLMExhaustedError } from '../../lib/llm-client.js';
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
 * Safely parse JSON from LLM response text.
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
    console.error("[LLMAgent] Failed to parse JSON response:", cleaned.substring(0, 200));
    throw new Error(`Invalid JSON from LLM: ${(e as Error).message}`);
  }
}

export async function getLLMTransferDecision(
  userId: string,
  squad: any[],
  gameweek: number,
  fixtures: any[],
  bank: number,
  freeTransfers: number,
  chipState: Record<string, number>,
  riskMode: string,
  userPrompt?: string,
  fplContext?: any | null,
  validTargets?: any[]
): Promise<TransferDecision> {
  
  // Build context for LLM
  const squadSummary = squad.map(p => 
    `${p.name || p.web_name || 'Unknown'} (ID: ${p.id || p.element || 'Unknown'}) (${p.position}) - £${((p.cost || p.now_cost || p.selling_price || 0)/10).toFixed(1)}M - xP: ${(p.xP || 0).toFixed(1)}`
  ).join('\n');
  
  const fixturesSummary = fixtures.slice(0, 5).map(f => 
    `GW${f.gw}: ${f.team} vs ${f.opponent} (FDR: ${f.difficulty})`
  ).join('\n');
  
  let newsSummary = '';
  if (fplContext && (fplContext.injuries?.length > 0 || fplContext.opportunities?.length > 0 || fplContext.returns?.length > 0)) {
    const inj = fplContext.injuries.map((i: any) => `${i.playerName} (${i.status})`).join(', ');
    const ret = fplContext.returns.map((r: any) => `${r.playerName} (${r.status})`).join(', ');
    const risks = fplContext.rotationRisks.map((r: any) => `${r.playerName} (${r.reason})`).join(', ');
    const opps = fplContext.opportunities.map((o: any) => `${o.playerName} (${o.reason})`).join(', ');
    
    newsSummary = `\nLATEST TEAM NEWS:\nINJURIES: ${inj || 'None'}\nRETURNS: ${ret || 'None'}\nRISKS: ${risks || 'None'}\nOPPORTUNITIES: ${opps || 'None'}\n`;
  } else {
    newsSummary = `\nLATEST TEAM NEWS:\nNo significant injury news or updates currently available. Assume players are fit unless noted otherwise.\n`;
  }

  let targetsSummary = '';
  if (validTargets && validTargets.length > 0) {
    targetsSummary = `\nTOP TRANSFER TARGETS (Filtered & Valid):\n${validTargets.map(t => `${t.name} (ID: ${t.id}, Pos: ${t.position || 'Unknown'}) - £${(t.price/10).toFixed(1)}M - riskAdjXP: ${(t.riskAdjustedScore || t.xP || 0).toFixed(2)} - Own: ${t.ownership}% - Form: ${t.form}`).join('\n')}\n`;
  }

  const prompt = `
    You are an elite FPL AI agent. Analyze this situation and make a decision.
    
    GAMEWEEK: ${gameweek}
    RISK MODE: ${riskMode.toUpperCase()}
    FREE TRANSFERS: ${freeTransfers}
    BANK: £${(bank/10).toFixed(1)}M
    
    CRITICAL FPL TRANSFER RULES:
    1. If suggesting a single transfer, the incoming player MUST have the EXACT SAME POSITION (e.g., DEF for DEF, MID for MID) as the outgoing player. Do not suggest swapping a Midfielder for a Defender.

    CRITICAL RISK MODE INSTRUCTIONS:
    ${riskMode === 'safe' ? '- You are in SAFE mode. You MUST prioritize highly-owned "template" players to defend rank. Avoid wild punts.' : ''}
    ${riskMode === 'aggressive' ? '- You are in AGGRESSIVE mode. You MUST prioritize low-ownership "differential" players (under 10% ownership) to catch up in rank. HOWEVER, you must PROTECT premium players (£10.0M+). Do NOT suggest transferring out a premium captaincy option just because they are highly owned.' : ''}
    ${riskMode === 'value' ? '- You are in VALUE mode. Prioritize cheap enablers and players with the highest expected points per million (PPM). Build long-term budget.' : ''}
    
    CURRENT SQUAD:
    ${squadSummary}
    
    UPCOMING FIXTURES (next 5 GWs):
    ${fixturesSummary}
    
    CHIPS AVAILABLE:
    ${Object.entries(chipState).filter(([_, avail]) => avail).map(([chip]) => chip).join(', ') || 'None'}
    ${newsSummary}${targetsSummary}
    ${userPrompt && userPrompt.trim() !== '' ? `USER QUESTION/CONTEXT:\n    "${userPrompt}"\n    (Address this question specifically in your reasoning!)` : ''}
    
    RESPOND WITH VALID JSON OBJECT:
    {
      "action": "ROLL" or "TRANSFER" or "CHIP",
      "transfersIn": [playerIds] (if action is TRANSFER),
      "transfersOut": [playerIds] (if action is TRANSFER),
      "chipName": "WC"/"FH"/"BB"/"TC" (if action is CHIP),
      "reasoning": "your strategic reasoning here",
      "confidence": 0-100
    }
  `;
  
  const result = await callLLMWithFallback({
    prompt,
    temperature: 0.3,
    jsonMode: true,
  });

  const decision = safeParseJSON(result.text);
  
  // Log the decision to Firestore (await it but catch errors so it doesn't crash the main flow)
  await logAIDecision({
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
    riskMode,
    userPrompt
  }).catch(err => {
    console.error("[LLMAgent] Non-fatal: Failed to log decision to Firestore:", err.message);
  });
  
  return decision;
}

export async function getLLMChipAdvice(
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
    Respond with VALID JSON OBJECT: {"recommendation": "WC/HOLD/etc", "reasoning": "...", "confidence": 0-100}
  `;
  
  const result = await callLLMWithFallback({
    prompt,
    temperature: 0.2,
    jsonMode: true,
  });

  const decision = safeParseJSON(result.text);
  
  // Await Firestore log but catch errors
  await logAIDecision({
    userId,
    gameweek,
    decision: `CHIP_${decision.recommendation}`,
    reasoning: decision.reasoning,
    confidence: decision.confidence,
    details: { chipName: decision.recommendation !== 'HOLD' ? decision.recommendation : undefined },
    modelUsed: result.modelUsed
  }).catch(err => {
    console.error("[LLMAgent] Non-fatal: Failed to log chip advice to Firestore:", err.message);
  });
  
  return decision;
}

export async function generateSocialThread(
  squad: any[],
  riskMode: string,
  topPicks: any[],
  totalCost: number,
  expectedPoints: number,
  omittedStars: any[] = [],
  captain?: any,
  viceCaptain?: any
): Promise<string[]> {
  const formatPlayerPrice = (val: any) => {
    const num = Number(val) || 0;
    const inMillions = num > 30 ? num / 10 : num;
    return `£${inMillions.toFixed(1)}M`;
  };

  const squadSummary = squad.map(p => 
    `${p.name || p.web_name || 'Unknown'} (${p.position || 'MID'}) ${formatPlayerPrice(p.now_cost ?? p.cost)}`
  ).join(', ');

  const captainName = captain?.web_name || captain?.name || (squad[0]?.web_name || squad[0]?.name || 'Squad Leader');
  const captainPos = captain?.position || squad[0]?.position || 'MID';
  const captainPrice = formatPlayerPrice(captain?.now_cost ?? captain?.cost ?? squad[0]?.now_cost);
  const captainFull = `${captainName} (${captainPos}, ${captainPrice})`;

  const viceCaptainName = viceCaptain?.web_name || viceCaptain?.name || '';

  const omittedStarsSummary = (omittedStars || []).map(p => 
    `${p.name || p.web_name || 'Unknown'} (${formatPlayerPrice(p.cost ?? p.now_cost)})`
  ).join(', ');

  const formattedTotalCost = (totalCost > 300 ? totalCost / 10 : totalCost).toFixed(1);

  const prompt = `
    You are an elite quantitative FPL Analyst (the "Hedge Fund FPL" persona).
    You just ran our mathematical optimization suite to find the absolute mathematically perfect squad for the upcoming gameweek in the current 2026/27 Premier League season.
    
    Data from the Engine:
    - Selected Risk Strategy: ${riskMode.toUpperCase()}
    - Total Squad Cost: £${formattedTotalCost}M (Must strictly be under £100.0M)
    - Projected Points: ${expectedPoints.toFixed(1)} xP
    - 15-Man Optimal Squad: ${squadSummary}
    - Designated Optimal Captain: ${captainFull}
    ${viceCaptainName ? `- Designated Vice-Captain: ${viceCaptainName}` : ''}
    ${omittedStarsSummary ? `- High-Ownership Template Stars Omitted by Engine: ${omittedStarsSummary}` : ''}

    Write a highly engaging, sharp, and authoritative 4-part Twitter (X) thread explaining the mathematical logic behind this optimal squad.
    
    Vocabulary to Naturally Rotate & Weave into the Thread:
    - "Mixed-Integer Linear Programming (MILP)" or "Branch-and-Bound Optimizer"
    - "Markowitz Mean-Variance Utility Model"
    - "Game-Theoretic EO Shield"
    - "8-Gameweek Rolling Horizon Lookahead"

    Guidelines for the Thread:
    - Tweet 1 (The Hook): State the Risk Strategy (${riskMode.toUpperCase()}), the total cost, and projected xP. Reference our "Mixed-Integer Linear Programming (MILP)" or "Branch-and-Bound" optimizer delivering mathematical alpha over an "8-Gameweek Rolling Horizon Lookahead".
    - Tweet 2 (The Math & Risk): Highlight 1-2 players the engine MATHEMATICALLY REJECTED (from the Omitted Stars list) or highlight budget enablers from the actual 15-man squad that balanced the "Markowitz Mean-Variance Utility Model" / "Game-Theoretic EO Shield".
      STRICT ANTI-HALLUCINATION RULE: You must ONLY mention current Premier League players explicitly listed in the 15-Man Optimal Squad or Omitted Stars above. NEVER mention retired players or players who have left the Premier League.
    - Tweet 3 (The Alpha - Captain Pick): You MUST explicitly name the Designated Optimal Captain "${captainName}". Explain their mathematical advantage for this specific Risk Strategy (${riskMode.toUpperCase()}) (e.g., if SAFE, emphasize low variance and high floor; if AGGRESSIVE, emphasize high ceiling and differential upside; if VALUE, emphasize points-per-million ROI). You are STRICTLY FORBIDDEN from substituting any other player as captain.
    - Tweet 4 (The CTA): A Call-To-Action asking followers to drop a screenshot of their squad below for an AI audit, or telling them to run the Branch-and-Bound MILP engine themselves. MUST conclude with the link "fplhorizon.app" and relevant hashtags: #FPL #FPLCommunity #FantasyPremierLeague.
    
    CRITICAL CONSTRAINTS:
    - You must output exactly 4 tweets.
    - Start tweets with "1/4", "2/4", "3/4", "4/4".
    - EVERY SINGLE TWEET MUST BE STRICTLY UNDER 250 CHARACTERS to comfortably fit Twitter's 280 limit. Do NOT use overly long words.
    - STRICT CAPTAINCY BINDING: The captain named in Tweet 3 MUST be "${captainName}".
    - ZERO CONTRADICTIONS: If a player was rejected in Tweet 2, NEVER name them as captain in Tweet 3.
    - STRICTLY ACCURATE PLAYERS ONLY: Zero hallucinated names outside the provided engine payload.
    - Use numbers and stats to sound authoritative.

    Respond with a STRICT VALID JSON OBJECT matching this exact structure:
    {
      "tweets": ["Tweet 1 text here...", "Tweet 2 text here...", "Tweet 3 text here...", "Tweet 4 text here..."]
    }
  `;

  const result = await callLLMWithFallback({
    prompt,
    temperature: 0.5,
    jsonMode: true,
  });

  const parsed = safeParseJSON(result.text);
  if (!parsed.tweets || !Array.isArray(parsed.tweets)) {
    throw new Error("Invalid response format from LLM for social thread");
  }

  return parsed.tweets;
}
