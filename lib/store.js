// Tiny JSON documents in a private Vercel Blob store: push subscriptions and alert state.

import { get, put } from '@vercel/blob';

export async function readJson(path, fallback) {
  const found = await get(path, { access: 'private', useCache: false });
  if (!found) return fallback;
  return JSON.parse(await new Response(found.stream).text());
}

export async function writeJson(path, value) {
  await put(path, JSON.stringify(value), {
    access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json',
  });
}

export const SUBS = 'alerts/subscriptions.json';
export const STATE = 'alerts/state.json';
