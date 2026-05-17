import { getSecret } from '../storage/secrets';
import { logger } from '../logger';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  ok: boolean;
  engine: 'tavily' | 'duckduckgo' | 'none';
  query: string;
  results: WebSearchResult[];
  error?: string;
  answer?: string;
}

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

async function searchTavily(query: string, apiKey: string): Promise<WebSearchResponse> {
  const res = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 5,
      search_depth: 'basic',
      include_answer: true,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return {
      ok: false, engine: 'tavily', query, results: [],
      error: `Tavily ${res.status}: ${txt.slice(0, 200)}`,
    };
  }
  const data = (await res.json()) as {
    answer?: string;
    results?: Array<{ title: string; url: string; content: string }>;
  };
  return {
    ok: true, engine: 'tavily', query,
    ...(data.answer ? { answer: data.answer } : {}),
    results: (data.results ?? []).slice(0, 5).map((r) => ({
      title: r.title, url: r.url, snippet: r.content?.slice(0, 280) ?? '',
    })),
  };
}

// DuckDuckGo Instant Answer API — free, no key. Limited to instant answers
// (definitions, related topics) — not full web results, but works as a fallback.
async function searchDuckDuckGo(query: string): Promise<WebSearchResponse> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url);
  if (!res.ok) {
    return {
      ok: false, engine: 'duckduckgo', query, results: [],
      error: `DuckDuckGo ${res.status}`,
    };
  }
  const data = (await res.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };
  const results: WebSearchResult[] = [];
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      snippet: data.AbstractText.slice(0, 280),
    });
  }
  for (const t of data.RelatedTopics ?? []) {
    if (!t.Text || !t.FirstURL) continue;
    results.push({
      title: t.Text.split(' - ')[0] || t.Text.slice(0, 60),
      url: t.FirstURL,
      snippet: t.Text.slice(0, 280),
    });
    if (results.length >= 5) break;
  }
  return {
    ok: true, engine: 'duckduckgo', query,
    ...(data.AbstractText ? { answer: data.AbstractText } : {}),
    results,
  };
}

export async function webSearch(query: string): Promise<WebSearchResponse> {
  const q = query.trim();
  if (!q) {
    return { ok: false, engine: 'none', query: '', results: [], error: 'empty query' };
  }
  try {
    const tavilyKey = await getSecret('tavily_api_key');
    if (tavilyKey) return await searchTavily(q, tavilyKey);
    return await searchDuckDuckGo(q);
  } catch (err) {
    logger.warn('webSearch failed', err);
    return {
      ok: false, engine: 'none', query: q, results: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
