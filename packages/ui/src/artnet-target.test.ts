/**
 * The three Art-Net addresses that run clean and light nothing.
 */

import { describe, it, expect } from 'vitest';

import { artnetTargetProblem, isLoopbackHost } from './artnet-target.js';

const HOME = { address: '192.168.1.23', netmask: '255.255.255.0', broadcast: '192.168.1.255' };
const RIG = { address: '2.0.0.10', netmask: '255.0.0.0', broadcast: '2.255.255.255' };

describe('where Art-Net goes', () => {
  it('says when it only reaches this computer', () => {
    expect(artnetTargetProblem('127.0.0.1', [HOME])).toContain('this computer only');
    expect(artnetTargetProblem('localhost', [])).toContain('this computer only');
  });

  it("says when it is this computer's own address", () => {
    expect(artnetTargetProblem('192.168.1.23', [HOME])).toContain("this computer's own address");
  });

  it('says when this computer is not on that network, and which it is on', () => {
    const problem = artnetTargetProblem('10.0.0.50', [HOME, RIG]);
    expect(problem).toContain('not on the same network as 10.0.0.50');
    expect(problem).toContain('192.168.1.23 and 2.0.0.10');
  });

  it('is happy with a node, or a broadcast, on a network this computer is on', () => {
    expect(artnetTargetProblem('192.168.1.50', [HOME])).toBeNull();
    expect(artnetTargetProblem('2.255.255.255', [HOME, RIG])).toBeNull();
    expect(artnetTargetProblem('255.255.255.255', [HOME])).toBeNull();
  });

  it('says nothing it cannot know: no networks reported, or a host name', () => {
    expect(artnetTargetProblem('10.0.0.50', [])).toBeNull();
    expect(artnetTargetProblem('node.local', [HOME])).toBeNull();
  });

  it('knows the names for this computer', () => {
    expect(isLoopbackHost('127.1.2.3')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('128.0.0.1')).toBe(false);
  });
});
