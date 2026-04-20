import { fetch } from 'undici';
import * as cheerio from 'cheerio';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL, EVENT_LIST_URL } from './constants.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchHtml(url) {
  const attempt = async () => {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  };
  try {
    return await attempt();
  } catch (err) {
    await sleep(1000);
    return await attempt();
  }
}

export function toIsoDate(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/(\d{2})[-./](\d{2})[-./](\d{2})/);
  if (!m) return null;
  const [, yy, mm, dd] = m;
  const monthN = Number(mm);
  const dayN = Number(dd);
  if (monthN < 1 || monthN > 12 || dayN < 1 || dayN > 31) return null;
  return `20${yy}-${mm}-${dd}`;
}

function absUrl(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function extractBgImage(styleAttr) {
  if (!styleAttr) return null;
  const m = styleAttr.match(/background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
  return m ? m[1] : null;
}

export function parseCard($, el, baseUrl) {
  try {
    const $el = $(el);
    const $a = $el.is('a') ? $el : $el.find('a').first();
    const href = $a.attr('href');
    const absHref = absUrl(href, baseUrl);
    if (!absHref) return null;

    const idMatch = absHref.match(/\/view\/(\d+)/) || absHref.match(/idx=(\d+)/);
    const id = idMatch ? idMatch[1] : absHref;

    const title = $a.find('.title .txt').first().text().trim() ||
      $a.find('.title').first().text().trim();
    if (!title) return null;

    const dateText = $a.find('.date').first().text().trim();
    const [startRaw, endRaw] = dateText.split('~').map((s) => s && s.trim());
    const start_date = toIsoDate(startRaw || '');
    const end_date = toIsoDate(endRaw || startRaw || '');
    if (!start_date || !end_date) return null;

    const description = $a.find('.summary').first().text().trim() || '';

    let imageSrc = null;
    const $img = $a.find('img').first();
    if ($img.length) {
      imageSrc = $img.attr('src') || null;
    }
    if (!imageSrc) {
      const style = $a.find('.banner_img').first().attr('style') || '';
      imageSrc = extractBgImage(style);
    }
    const image_url = imageSrc ? absUrl(imageSrc, baseUrl) : null;

    return { id, title, description, start_date, end_date, url: absHref, image_url };
  } catch (err) {
    console.warn('[scraper] parseCard error:', err?.message || err);
    return null;
  }
}

export function parsePage(html, baseUrl) {
  const $ = cheerio.load(html);
  const cards = $('ul.banner_list.event > li');
  const results = [];
  cards.each((_, el) => {
    try {
      const obj = parseCard($, el, baseUrl);
      if (obj) results.push(obj);
    } catch (err) {
      console.warn('[scraper] card parse fail:', err?.message || err);
    }
  });
  return results;
}

export async function scrapeEvents() {
  const all = [];
  const seen = new Set();
  for (const page of [1, 2, 3]) {
    const url = `${EVENT_LIST_URL}&page=${page}`;
    try {
      const html = await fetchHtml(url);
      const events = parsePage(html, BASE_URL);
      for (const ev of events) {
        if (!seen.has(ev.id)) {
          seen.add(ev.id);
          all.push(ev);
        }
      }
    } catch (err) {
      console.warn(`[scraper] page ${page} failed:`, err?.message || err);
    }
  }
  return all;
}

// ---------- ESM 단독 실행 블록 / self-test ----------

if (import.meta.url === `file://${process.argv[1]}`) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const fixturePath = resolve(__dirname, '..', 'tests', 'fixtures', 'event-page.html');

  const results = [];
  const record = (name, pass, detail = '') => {
    results.push({ name, pass, detail });
    const tag = pass ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // S-T1: toIsoDate
  {
    const a = toIsoDate('26-04-13');
    const b = toIsoDate('');
    const c = toIsoDate('abc');
    const d = toIsoDate('  26-04-27 ');
    const ok =
      a === '2026-04-13' && b === null && c === null && d === '2026-04-27';
    record('S-T1 toIsoDate', ok, `a=${a} b=${b} c=${c} d=${d}`);
  }

  // Ensure fixture exists (download if missing)
  if (!existsSync(fixturePath)) {
    try {
      await mkdir(dirname(fixturePath), { recursive: true });
      const html = await fetchHtml(`${EVENT_LIST_URL}&page=1`);
      await writeFile(fixturePath, html, 'utf8');
      console.log(`[info] fixture downloaded → ${fixturePath}`);
    } catch (err) {
      console.warn('[info] fixture download failed:', err?.message || err);
    }
  }

  let fixtureHtml = null;
  try {
    fixtureHtml = await readFile(fixturePath, 'utf8');
  } catch {
    console.warn('[info] fixture not available; skipping S-T2~4,7');
  }

  // S-T2: parseCard (first card, with image)
  if (fixtureHtml) {
    const $ = cheerio.load(fixtureHtml);
    const firstLi = $('ul.banner_list.event > li').first();
    const card = parseCard($, firstLi[0], BASE_URL);
    const ok =
      card &&
      typeof card.id === 'string' && card.id.length > 0 &&
      typeof card.title === 'string' && card.title.length > 0 &&
      typeof card.description === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(card.start_date) &&
      /^\d{4}-\d{2}-\d{2}$/.test(card.end_date) &&
      card.url.startsWith('http') &&
      (card.image_url === null || card.image_url.startsWith('http'));
    record('S-T2 parseCard (first card)', !!ok, card ? JSON.stringify(card) : 'null');
  }

  // S-T3: parseCard with image missing
  if (fixtureHtml) {
    const $ = cheerio.load(fixtureHtml);
    const items = $('ul.banner_list.event > li').toArray();
    const parsed = items.map((el) => parseCard($, el, BASE_URL)).filter(Boolean);
    const noImg = parsed.find((c) => c.image_url === null);
    record(
      'S-T3 parseCard image_url=null case exists',
      !!noImg,
      noImg ? `id=${noImg.id} title=${noImg.title}` : 'no card without image found'
    );
  }

  // S-T4: parsePage
  if (fixtureHtml) {
    const events = parsePage(fixtureHtml, BASE_URL);
    const allShape = events.every(
      (e) =>
        e && e.id && e.title && e.url && e.start_date && e.end_date &&
        (e.image_url === null || typeof e.image_url === 'string') &&
        typeof e.description === 'string'
    );
    record('S-T4 parsePage', events.length >= 3 && allShape, `count=${events.length}`);
  }

  // S-T5: fetchHtml retry on unreachable URL (measure elapsed)
  {
    const t0 = Date.now();
    let threw = false;
    try {
      await fetchHtml('http://127.0.0.1:1/nope');
    } catch {
      threw = true;
    }
    const elapsed = Date.now() - t0;
    record('S-T5 fetchHtml retry', threw && elapsed >= 1000, `threw=${threw} elapsed=${elapsed}ms`);
  }

  // S-T7: relative URL absolutization
  {
    const synthetic = `
      <ul class="banner_list event">
        <li>
          <a href="/news/event/view/999?category=1">
            <span class="banner_img_wrap">
              <span class="banner_img" style="background-image:url('/img/a.png');"></span>
            </span>
            <span class="txt_box">
              <span class="title"><span class="txt">Synthetic</span></span>
              <span class="date">26-04-01 ~ 26-04-30</span>
              <span class="summary">syn</span>
            </span>
          </a>
        </li>
      </ul>`;
    const events = parsePage(synthetic, BASE_URL);
    const ev = events[0];
    const ok =
      ev &&
      ev.url === `${BASE_URL}/news/event/view/999?category=1` &&
      ev.image_url === `${BASE_URL}/img/a.png`;
    record(
      'S-T7 relative URL absolutization',
      !!ok,
      ev ? `url=${ev.url} image_url=${ev.image_url}` : 'no event parsed'
    );
  }

  // S-T6: real-network end-to-end (best-effort)
  console.log('\n[info] S-T6 fetching live FF14 pages…');
  try {
    const events = await scrapeEvents();
    const withImg = events.filter((e) => e.image_url).length;
    console.log(`\n총 ${events.length}건, image_url 있음 ${withImg}건`);
    if (events.length > 0) {
      console.table(
        events.slice(0, 3).map((e) => ({
          id: e.id,
          title: e.title.slice(0, 30),
          start: e.start_date,
          end: e.end_date,
          hasImg: !!e.image_url,
        }))
      );
    }
    record('S-T6 scrapeEvents (live)', events.length > 0, `count=${events.length}`);
  } catch (err) {
    record('S-T6 scrapeEvents (live)', false, err?.message || String(err));
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}
