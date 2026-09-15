// Web push to every phone that turned alerts on. Dead subscriptions come back as `gone`.

import webpush from 'web-push';
import { config } from './config.js';

export function configured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export async function pushAll(subs, message) {
  webpush.setVapidDetails(config.siteUrl || 'https://github.com/eightclip/fantasy-football-gamer', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({ title: message.title, body: message.body, tag: message.key });
  const gone = [];
  let delivered = 0;
  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: 'high' });
      delivered++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) gone.push(sub.endpoint);
      else console.error('push:', err.statusCode, err.body || err.message);
    }
  }));
  return { delivered, gone };
}
