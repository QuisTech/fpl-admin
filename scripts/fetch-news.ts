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

  // 2. Fetch from RSS Scout and get full articles
  let scoutTexts = '';
  try {
    const res = await axios.get('https://www.fantasyfootballscout.co.uk/feed/', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000
    });
    const items = res.data.match(/<item>([\s\S]*?)<\/item>/g) || [];
    const topItems = items.slice(0, 5); // Fetch full text for top 5 articles
    const articleTexts: string[] = [];

    for (const item of topItems) {
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
      const title = titleMatch ? titleMatch[1] : '';
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      const link = linkMatch ? linkMatch[1] : '';

      if (link) {
        try {
          const articleRes = await axios.get(link, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
          const pTags = articleRes.data.match(/<p>([\s\S]*?)<\/p>/g) || [];
          const text = pTags.map((p: string) => p.replace(/<[^>]+>/g, '').trim()).filter((p: string) => p.length > 50).slice(0, 10).join('\n');
          articleTexts.push(`Title: ${title}\n${text}`);
        } catch (e) {
          console.warn(`[NewsFetcher] Failed to fetch article ${link}`);
        }
      }
    }
    scoutTexts = articleTexts.join('\n\n---\n\n');
    console.log('[NewsFetcher] Successfully fetched from RSS scout and parsed articles');
  } catch (e: any) {
    console.error('[NewsFetcher] Failed to fetch RSS', e.message);
  }

  const combinedTexts = [redditTexts, scoutTexts].filter(t => t.trim() !== '').join('\n\n=== FANTASY FOOTBALL SCOUT RSS ===\n\n');
  return combinedTexts;
}

function safeParseJSON(text: string): any {
  let cleaned = text.trim();
  // Remove <think> blocks
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
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
  console.log('[NewsFetcher] Fetching official FPL players and news...');
  const players = await getFPLPlayers();
  const officialNews = players
    .filter((p: any) => p.news && p.news.trim() !== '')
    .map((p: any) => `${p.web_name} (${p.first_name} ${p.second_name}): ${p.news}`)
    .join('\n');

  console.log('[NewsFetcher] Launching Headless Browser to fetch external FPL news...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const rawNewsFromWeb = await fetchAllNews(page);
  await browser.close();

  const rawNews = `=== OFFICIAL FPL INJURY NEWS ===\n${officialNews}\n\n${rawNewsFromWeb}`;

  if (!rawNews || rawNews.trim() === '') {
    console.log('[NewsFetcher] No news fetched, exiting.');
    process.exit(0);
  }

  console.log('[NewsFetcher] Processing news with LLM...');
  const prompt = `
    Analyze the following recent FPL (Fantasy Premier League) news and press conferences.
    Extract the status of players. 
    
    Respond in strict JSON matching exactly this format:
    {
      "injuries": [{ "playerName": "Bukayo Saka", "status": "Expected to miss GW5", "confidence": 80 }],
      "doubts": [{ "playerName": "Phil Foden", "status": "Minor knock" }],
      "returns": [{ "playerName": "Kevin De Bruyne", "status": "Back in training" }],
      "rotationRisks": [{ "playerName": "Darwin Nunez", "reason": "Played 90 mins midweek" }],
      "opportunities": [{ "playerName": "Kai Havertz", "reason": "Likely to start up top" }]
    }
    
    If no data for a category, use empty array []. Only extract Premier League players.
    
    RAW NEWS:
    ${rawNews.substring(0, 10000)}
  `;

  let parsed: any;
  try {
    const result = await callLLMWithFallback({ prompt, temperature: 0.1, jsonMode: false });
    parsed = safeParseJSON(result.text);
  } catch(e) {
    console.error("[NewsFetcher] Failed to parse news JSON", e);
    process.exit(1);
  }

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
