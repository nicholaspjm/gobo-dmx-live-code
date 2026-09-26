/**
 * The desktop app's "a newer version is out" link.
 *
 * What matters is that it never nags: nothing when this is the latest, nothing
 * once the link has been followed, and at most two questions to GitHub a day.
 */

import { describe, it, expect } from 'vitest';

import { CHECK_EVERY_MS, isStale, latestVersionOf, versionToOffer } from './app-update.js';

describe("reading GitHub's answer", () => {
  it('takes the version from the tag', () => {
    expect(latestVersionOf({ tag_name: 'v0.5.4' })).toBe('0.5.4');
    expect(latestVersionOf({ tag_name: '0.6.0' })).toBe('0.6.0');
  });

  it('refuses a prerelease, a draft, and anything that is not a release', () => {
    expect(latestVersionOf({ tag_name: 'v0.6.0', prerelease: true })).toBeNull();
    expect(latestVersionOf({ tag_name: 'v0.6.0', draft: true })).toBeNull();
    expect(latestVersionOf({ tag_name: 'v0.6.0-rc.1' })).toBeNull();
    expect(latestVersionOf({ message: 'API rate limit exceeded' })).toBeNull();
    expect(latestVersionOf(null)).toBeNull();
  });
});

describe('what to offer', () => {
  it('offers a newer version', () => {
    expect(versionToOffer('0.5.3', { checkedAt: 0, latest: '0.5.4' })).toBe('0.5.4');
    expect(versionToOffer('0.9.9', { checkedAt: 0, latest: '0.10.0' })).toBe('0.10.0');
  });

  it('offers nothing when this is the latest, or newer', () => {
    expect(versionToOffer('0.5.3', { checkedAt: 0, latest: '0.5.3' })).toBeNull();
    expect(versionToOffer('0.6.0', { checkedAt: 0, latest: '0.5.3' })).toBeNull();
  });

  it('offers nothing twice once the link was followed', () => {
    expect(versionToOffer('0.5.3', { checkedAt: 0, latest: '0.5.4', seen: '0.5.4' })).toBeNull();
    // A later release is offered again.
    expect(versionToOffer('0.5.3', { checkedAt: 0, latest: '0.5.5', seen: '0.5.4' })).toBe('0.5.5');
  });

  it('offers nothing without an answer', () => {
    expect(versionToOffer('0.5.3', null)).toBeNull();
    expect(versionToOffer('0.5.3', { checkedAt: 0, latest: null })).toBeNull();
    expect(versionToOffer('unknown', { checkedAt: 0, latest: '0.5.4' })).toBeNull();
  });
});

describe('when to ask', () => {
  it('asks when nothing is cached, or the answer is half a day old', () => {
    expect(isStale(null, 1000)).toBe(true);
    expect(isStale({ checkedAt: 1000, latest: '0.5.3' }, 1000 + CHECK_EVERY_MS - 1)).toBe(false);
    expect(isStale({ checkedAt: 1000, latest: '0.5.3' }, 1000 + CHECK_EVERY_MS)).toBe(true);
  });

  it('asks again if the clock went backwards', () => {
    expect(isStale({ checkedAt: 5000, latest: '0.5.3' }, 1000)).toBe(true);
  });
});
