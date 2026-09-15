import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRss } from '../lib/nfl.js';

test('news feeds keep https links only', () => {
  const xml = `<rss><channel>
    <item><title>Player One: Limited in practice</title><link>https://example.com/one</link><pubDate>Mon, 14 Sep 2026 19:56:00 GMT</pubDate><description>&lt;p&gt;Short note&lt;/p&gt;</description></item>
    <item><title>Player Two: Sneaky</title><link>javascript:alert(1)</link></item>
    <item><title>Player Three: Plain http</title><link>http://example.com/three</link></item>
  </channel></rss>`;
  const items = parseRss(xml, 'Example');
  assert.equal(items.length, 3);
  assert.equal(items[0].link, 'https://example.com/one');
  assert.equal(items[0].summary, 'Short note');
  assert.equal(items[0].published, '2026-09-14T19:56:00.000Z');
  assert.equal(items[1].link, null);
  assert.equal(items[2].link, null);
});
