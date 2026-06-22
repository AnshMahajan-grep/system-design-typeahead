// =============================================================================
// consistentHash.js — Consistent Hashing ring
// =============================================================================
// PROBLEM this solves:
//   We have N cache nodes (3 Redis containers). For any cache key (a prefix
//   like "iph") we must pick ONE node to own it. The naive approach is
//   `node = hash(key) % N`. That works until N changes: add or remove a node
//   and `% N` reshuffles almost EVERY key, so the whole cache is invalidated
//   at once (a "cache stampede" onto the database).
//
// CONSISTENT HASHING fixes this:
//   - Map both the NODES and the KEYS onto the same circular hash space
//     (0 .. 2^32-1), the "ring".
//   - A key is owned by the first node found walking CLOCKWISE from the key's
//     position on the ring.
//   - When a node is added/removed, only the keys in the arc next to that node
//     move. On average just K/N keys relocate instead of all of them.
//
// VIRTUAL NODES (vnodes):
//   If each physical node mapped to a single point, the arcs would be uneven
//   and load would be lopsided. So we place each physical node at MANY points
//   on the ring (replicas). More vnodes => smoother, more uniform distribution.
// =============================================================================

import { createHash } from 'node:crypto';

// Hash an arbitrary string to a 32-bit unsigned integer position on the ring.
// We use the first 8 hex chars (32 bits) of an MD5 digest. MD5 is fine here:
// we only need a fast, well-distributed hash, not cryptographic security.
function hash32(str) {
  const hex = createHash('md5').update(str).digest('hex').slice(0, 8);
  return parseInt(hex, 16); // 0 .. 4294967295
}

export class ConsistentHashRing {
  /**
   * @param {string[]} nodeIds  identifiers for each physical node, e.g.
   *                            ["redis-0:6379", "redis-1:6379", ...]
   * @param {number}   vnodes   replicas per physical node (default 150)
   */
  constructor(nodeIds = [], vnodes = 150) {
    this.vnodes = vnodes;
    this.nodeIds = [];
    // ring: sorted array of { position, nodeId }. Sorted so we can binary-search
    // for the next node clockwise from a key's position.
    this.ring = [];
    for (const id of nodeIds) this.addNode(id);
  }

  // Place a physical node onto the ring as `vnodes` separate points.
  addNode(nodeId) {
    if (this.nodeIds.includes(nodeId)) return;
    this.nodeIds.push(nodeId);
    for (let i = 0; i < this.vnodes; i++) {
      // Each vnode gets a distinct ring position derived from "nodeId#i".
      this.ring.push({ position: hash32(`${nodeId}#${i}`), nodeId });
    }
    this.ring.sort((a, b) => a.position - b.position);
  }

  // Remove a physical node and all of its vnodes. Only keys that hashed into
  // this node's arcs are affected; everything else keeps its owner.
  removeNode(nodeId) {
    this.nodeIds = this.nodeIds.filter((id) => id !== nodeId);
    this.ring = this.ring.filter((entry) => entry.nodeId !== nodeId);
  }

  // The core lookup: which node owns this key?
  // Walk CLOCKWISE from the key's position to the first vnode at or after it;
  // wrap around to the start if we run off the end (it's a circle).
  getNode(key) {
    if (this.ring.length === 0) return null;
    const pos = hash32(key);

    // Binary search for the first ring entry with position >= pos.
    let lo = 0;
    let hi = this.ring.length - 1;
    let ans = 0; // default: wrap to the first vnode
    if (pos > this.ring[hi].position) {
      ans = 0; // past the last point -> wrap around to the first
    } else {
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.ring[mid].position >= pos) {
          ans = mid;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
    }
    return this.ring[ans].nodeId;
  }

  // Helper used by the /cache/debug endpoint to explain a routing decision.
  describe(key) {
    return {
      key,
      keyPosition: hash32(key),
      ownerNode: this.getNode(key),
      totalPhysicalNodes: this.nodeIds.length,
      vnodesPerNode: this.vnodes,
      totalVnodesOnRing: this.ring.length,
    };
  }
}
