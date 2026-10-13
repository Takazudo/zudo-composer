// @ts-check
import { randomUUID } from "node:crypto";

/** @param {string} code @param {string} message */
const refusal = (code, message) => Object.assign(new Error(message), { code });

/** One admission/revision owner for every filesystem and operator path. */
export function createBrowserCoordinator({ challengeMs = 10_000 } = {}) {
  /** @typedef {{send(data: {challenge: string, epoch: number, phase: string}): void, resume(data: {epoch: number}): void}} Peer */
  /** @type {Map<string, {peer: Peer, epoch: number}>} */
  const clients = new Map();
  /** @type {Set<Promise<unknown>>} */
  const work = new Set();
  let epoch = 0, exclusive = false, preparing = false, closing = false;
  /** @type {{challenge: string, pending: Map<string, (clean: boolean) => void>, failed: boolean} | undefined} */
  let round;
  const invalidate = () => { if (round) { round.failed = true; for (const finish of round.pending.values()) finish(false); } };
  return {
    get epoch() { return epoch; },
    /** @param {string} id @param {Peer} peer @param {number | null} [previousEpoch] */
    bind(id, peer, previousEpoch = null) {
      if (closing || exclusive || preparing || (previousEpoch !== null && previousEpoch !== epoch) || clients.size >= 16 || clients.has(id)) throw refusal("authoring-busy", "Authoring coordination is busy. Reconnect after it settles.");
      clients.set(id, { peer, epoch });
      return epoch;
    },
    /** @param {string} id @param {unknown} peer */
    disconnect(id, peer) {
      if (clients.get(id)?.peer !== peer) return;
      clients.delete(id);
      invalidate();
    },
    /** @param {string} id @param {unknown} peer @param {string} challenge @param {number} revision @param {boolean} clean */
    answer(id, peer, challenge, revision, clean) {
      if (!round || round.challenge !== challenge || clients.get(id)?.peer !== peer || revision !== epoch) return;
      round.pending.get(id)?.(clean === true);
    },
    /** @template T @param {string} id @param {number} revision @param {() => T | Promise<T>} action @returns {Promise<T>} */
    async provider(id, revision, action) {
      if (closing || exclusive) throw refusal("authoring-busy", "Native editing is reconciling browser state. Input is retained; retry after it settles.");
      const client = clients.get(id);
      if (!client || client.epoch !== epoch || revision !== epoch) throw refusal("stale-browser", "This tab holds an old draft revision. Save recovery data and reopen the workspace before further writes.");
      const pending = Promise.resolve().then(action);
      work.add(pending);
      try { return await pending; } finally { work.delete(pending); }
    },
    /** @template T @param {string} id @param {() => Promise<T>} action @param {boolean} [mutates] @returns {Promise<T>} */
    async run(id, action, mutates = false) {
      if (closing || exclusive || preparing || !clients.has(id) || clients.get(id)?.epoch !== epoch) throw refusal("authoring-busy", "A current connected authoring tab is required.");
      preparing = true;
      let attempted = false;
      const peers = [...clients];
      /** @param {string} phase */
      const challenge = async phase => {
        round = { challenge: randomUUID(), pending: new Map(), failed: false };
        const current = round;
        const answers = peers.map(([clientId, { peer }]) => new Promise(/** @param {(value: boolean) => void} resolve */ resolve => {
          const timer = setTimeout(() => finish(false), challengeMs);
          /** @param {boolean} clean */
          const finish = clean => { if (!current.pending.delete(clientId)) return; clearTimeout(timer); resolve(clean); };
          current.pending.set(clientId, finish);
          try { peer.send({ challenge: current.challenge, epoch, phase }); } catch { finish(false); }
        }));
        if (!(await Promise.all(answers)).every(Boolean) || current.failed || closing) throw refusal("browser-dirty", "Another tab is dirty, saving, disconnected or unresponsive. Finish saving in every authoring tab, then retry. Pending input is retained.");
      };
      try {
        // Flush while normal provider admission is still open, then freeze and
        // verify quiescence after all actual storage work has drained.
        await challenge("prepare");
        exclusive = true;
        await Promise.allSettled([...work]);
        if (closing) throw refusal("browser-unavailable", "Authoring is closing.");
        await challenge("freeze");
        attempted = true;
        return await action();
      } finally {
        round = undefined;
        // Invalidates delayed requests even when an operation failed or lost its ack.
        if (mutates && attempted) epoch++;
        exclusive = false; preparing = false;
        for (const [, { peer }] of clients) peer.resume({ epoch });
      }
    },
    /** @param {string} id @param {unknown} peer @param {number} revision */
    reconcile(id, peer, revision) {
      const client = clients.get(id);
      if (closing || exclusive || !client || client.peer !== peer || revision !== epoch) return false;
      client.epoch = epoch;
      return true;
    },
    close() { closing = true; invalidate(); },
    async drain() { await Promise.allSettled([...work]); },
  };
}
