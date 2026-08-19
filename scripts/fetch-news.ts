import 'dotenv/config';
import { chromium } from 'playwright';
import { callLLMWithFallback } from '../lib/llm-client.js';
import { getFirestore } from '../lib/firestore.js';
import axios from 'axios';

interface FPLPlayer {
  id: number;
  web_name: string;
  first_name: string;
  second_name: string;
}

// 1. Fetch from Reddit using Playwright
async function fetchAllNews(page: any): Promise<string> {
  let redditTexts = '';
  try {
    await page.goto('https://www.reddit.com/r/FantasyPL/search.json?q=flair_name%3A%22News%22%20OR%20flair_name%3A%22Press%20Conference%22&restrict_sr=1&sort=new&limit=10', { waitUntil: 'networkidle' });
    const jsonContent = await page.evaluate(() => document.body.innerText);
    const data = JSON.parse(jsonContent);
    const posts = data?.data?.children || [];
    redditTexts = posts.map((p: any) => `Title: ${p.data.title}\n${p.data.selftext}`).join('\n\n---\n\n');
    console.log('[NewsFetcher] Successfully fetched from Reddit via Playwright');
  } catch (err: any) {
    console.warn('[NewsFetcher] Failed to fetch reddit', err.message);
  }

  // 2. Fetch from RSS Scout
  let scoutTexts = '';
  try {
    const res = await axios.get('https://www.fantasyfootballscout.co.uk/feed/', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000
    });
    const items = res.data.match(/<item>([\s\S]*?)<\/item>/g) || [];
    scoutTexts = items.slice(0, 15).map((item: string) => {
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
      const title = titleMatch ? titleMatch[1] : '';
      const descMatch = item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) || item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || item.match(/<description>([\s\S]*?)<\/description>/);
      let desc = descMatch ? descMatch[1] : '';
      desc = desc.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
      return `Title: ${title}\n${desc}`;
    }).join('\n\n---\n\n');
    console.log('[NewsFetcher] Successfully fetched from RSS scout');
  } catch (e: any) {
    console.error('[NewsFetcher] Failed to fetch RSS', e.message);
  }

  const combinedTexts = [redditTexts, scoutTexts].filter(t => t.trim() !== '').join('\n\n=== FANTASY FOOTBALL SCOUT RSS ===\n\n');
  return combinedTexts;
}

function safeParseJSON(text: string): any {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return JSON.parse(cleaned);
}

function findBestPlayerMatch(name: string, players: FPLPlayer[]): FPLPlayer | null {
  if (!name) return null;
  const lowerName = name.toLowerCase().trim();
  let match = players.find(p => p.web_name.toLowerCase() === lowerName);
  if (match) return match;
  match = players.find(p => `${p.first_name} ${p.second_name}`.toLowerCase() === lowerName);
  if (match) return match;
  match = players.find(p => p.web_name.toLowerCase().includes(lowerName) || lowerName.includes(p.web_name.toLowerCase()));
  if (match) return match;
  return null;
}

async function getFPLPlayers(): Promise<FPLPlayer[]> {
  const res = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/');
  return res.data.elements;
}

(async () => {
  console.log('[NewsFetcher] Launching Headless Browser to fetch FPL news...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const rawNews = await fetchAllNews(page);
  await browser.close();

  if (!rawNews || rawNews.trim() === '') {
    console.log('[NewsFetcher] No news fetched, exiting.');
    process.exit(0);
  }

  console.log('[NewsFetcher] Processing news with LLM...');
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
    console.error("[NewsFetcher] Failed to parse news JSON", e);
    process.exit(1);
  }

  const players = await getFPLPlayers();

  const mapPlayers = (arr: any[]) => {
    return (arr || []).map(item => {
      const p = findBestPlayerMatch(item.playerName, players);
      return { ...item, playerId: p ? p.id : 0, playerName: p ? p.web_name : item.playerName };
    }).filter(item => item.playerId !== 0);
  };

  const fplContext = {
    generatedAt: new Date().toISOString(),
    injuries: mapPlayers(parsed.injuries),
    doubts: mapPlayers(parsed.doubts),
    returns: mapPlayers(parsed.returns),
    rotationRisks: mapPlayers(parsed.rotationRisks),
    opportunities: mapPlayers(parsed.opportunities)
  };

  console.log('[NewsFetcher] Saving to Firestore...');
  const db = getFirestore();
  await db.collection('system').doc('fpl_news_context').set(fplContext);
  
  console.log('[NewsFetcher] ✅ News context updated successfully!');
})();
