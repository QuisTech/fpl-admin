import axios from 'axios';
import { callLLMWithFallback } from '../../lib/llm-client.js';
import { getFirestore } from '../../lib/firestore.js';
import type { FPLPlayer } from './types.js';

export interface FPLContext {
  generatedAt: string;
  injuries: { playerId: number; playerName: string; status: string; confidence: number; }[];
  doubts: { playerId: number; playerName: string; status: string; }[];
  returns: { playerId: number; playerName: string; status: string; }[];
  rotationRisks: { playerId: number; playerName: string; reason: string; }[];
  opportunities: { playerId: number; playerName: string; reason: string; }[];
}

function safeParseJSON(text: string): any {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return JSON.parse(cleaned);
}

// 1. Fetch News
async function fetchRawNews(): Promise<string> {
  let texts = '';
  try {
    const res = await axios.get('https://www.reddit.com/r/FantasyPL/search.json?q=flair_name%3A%22News%22%20OR%20flair_name%3A%22Press%20Conference%22&restrict_sr=1&sort=new&limit=10', {
      headers: { 'User-Agent': 'FPL-Agent-Bot/1.0 (Contact: agent@fpl.local)' },
      timeout: 5000
    });
    const posts = res.data?.data?.children || [];
    texts = posts.map((p: any) => `Title: ${p.data.title}\n${p.data.selftext}`).join('\n\n---\n\n');
  } catch (err: any) {
    console.warn('[NewsService] Failed to fetch reddit, falling back to RSS', err.message);
  }

  if (!texts || texts.trim() === '') {
    try {
      const res = await axios.get('https://www.fantasyfootballscout.co.uk/feed/', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000
      });
      const items = res.data.match(/<item>([\s\S]*?)<\/item>/g) || [];
      texts = items.slice(0, 15).map((item: string) => {
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
        const title = titleMatch ? titleMatch[1] : '';
        const descMatch = item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) || item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || item.match(/<description>([\s\S]*?)<\/description>/);
        let desc = descMatch ? descMatch[1] : '';
        desc = desc.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
        return `Title: ${title}\n${desc}`;
      }).join('\n\n---\n\n');
    } catch (e: any) {
      console.error('[NewsService] Failed to fetch RSS', e.message);
    }
  }

  return texts;
}

// 2. Fuzzy match player by name
function findBestPlayerMatch(name: string, players: FPLPlayer[]): FPLPlayer | null {
  if (!name) return null;
  const lowerName = name.toLowerCase().trim();
  
  // exact match on web_name
  let match = players.find(p => p.web_name.toLowerCase() === lowerName);
  if (match) return match;
  
  // exact match on full name
  match = players.find(p => `${p.first_name} ${p.second_name}`.toLowerCase() === lowerName);
  if (match) return match;
  
  // partial match
  match = players.find(p => p.web_name.toLowerCase().includes(lowerName) || lowerName.includes(p.web_name.toLowerCase()));
  if (match) return match;
  
  return null;
}

export async function generateAndCacheNewsContext(players: FPLPlayer[]): Promise<FPLContext | null> {
  const db = getFirestore();
  const lockRef = db.collection('system').doc('news_lock');
  
  // Idempotency / Race-lock
  try {
    const lock = await lockRef.get();
    if (lock.exists && (Date.now() - lock.data()!.lockedAt < 5 * 60 * 1000)) {
      console.log('[NewsService] Update already in progress. Skipping.');
      return null;
    }
    await lockRef.set({ lockedAt: Date.now() });
  } catch(e) {
    console.warn('[NewsService] Failed to acquire lock, proceeding anyway');
  }

  const rawNews = await fetchRawNews();
  if (!rawNews || rawNews.trim() === '') {
    await lockRef.delete();
    return null;
  }

  const prompt = `
    Analyze the following recent FPL (Fantasy Premier League) news and press conferences.
    Extract the status of players. 
    
    Respond in strict JSON matching this structure:
    {
      "injuries": [{ "playerName": "string", "status": "string (e.g. Expected to miss GW5)", "confidence": number (0-100) }],
      "doubts": [{ "playerName": "string", "status": "string" }],
      "returns": [{ "playerName": "string", "status": "string" }],
      "rotationRisks": [{ "playerName": "string", "reason": "string" }],
      "opportunities": [{ "playerName": "string", "reason": "string" }]
    }
    
    If no data for a category, use empty array. Only extract Premier League players.
    
    RAW NEWS:
    ${rawNews.substring(0, 10000)}
  `;

  let parsed: any;
  try {
    const result = await callLLMWithFallback({ prompt, temperature: 0.1, jsonMode: true });
    parsed = safeParseJSON(result.text);
  } catch(e) {
    console.error("[NewsService] Failed to parse news JSON", e);
    await lockRef.delete();
    return null;
  }

  // Map to player IDs
  const mapPlayers = (arr: any[]) => {
    return (arr || []).map(item => {
      const p = findBestPlayerMatch(item.playerName, players);
      return { ...item, playerId: p ? p.id : 0, playerName: p ? p.web_name : item.playerName };
    }).filter(item => item.playerId !== 0); // only keep matched players
  };

  const fplContext: FPLContext = {
    generatedAt: new Date().toISOString(),
    injuries: mapPlayers(parsed.injuries),
    doubts: mapPlayers(parsed.doubts),
    returns: mapPlayers(parsed.returns),
    rotationRisks: mapPlayers(parsed.rotationRisks),
    opportunities: mapPlayers(parsed.opportunities)
  };

  await db.collection('system').doc('fpl_news_context').set(fplContext);
  await lockRef.delete();
  
  return fplContext;
}

export async function getNewsContextFromCache(): Promise<FPLContext | null> {
  const db = getFirestore();
  const doc = await db.collection('system').doc('fpl_news_context').get();
  if (doc.exists) {
    return doc.data() as FPLContext;
  }
  return null;
}
