const PQueue = require('p-queue').default;

// Isolated FIFO queue per chat JID so one slow handler (large group send,
// long DB aggregation, attachment download) can't stall sends for any
// other chat. Baileys' auth-utils.transaction() mutex still serializes
// signal-key writes process-wide, but the cached signal store keeps that
// fast enough that per-jid is the right granularity for handler dispatch.
//
// Queues are evicted ~5 min after they go idle so a long-running bot
// doesn't accrete a queue object per ever-seen JID.
const queues = new Map(); // jid -> { q: PQueue, lastUsedAt: number }
const IDLE_MS = 5 * 60_000;
const BACKLOG_WARN = 5;

function getQueue(jid) {
    let entry = queues.get(jid);
    if (!entry) {
        entry = { q: new PQueue({ concurrency: 1 }), lastUsedAt: Date.now() };
        queues.set(jid, entry);
    }
    entry.lastUsedAt = Date.now();
    return entry;
}

setInterval(() => {
    const now = Date.now();
    for (const [jid, entry] of queues) {
        if (entry.q.size === 0
            && entry.q.pending === 0
            && now - entry.lastUsedAt > IDLE_MS) {
            queues.delete(jid);
        }
    }
}, 60_000).unref();

async function runOnJidQueue(jid, task) {
    if (!jid) return task();
    const entry = getQueue(jid);
    if (entry.q.size + entry.q.pending >= BACKLOG_WARN) {
        const clc = require('cli-color');
        const moment = require('moment-timezone');
        console.log(
            clc.yellow('[ QUEUE ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`backlog=${entry.q.size + entry.q.pending} jid=${jid}`)
        );
    }
    return entry.q.add(task);
}

function _stats() {
    const out = [];
    for (const [jid, entry] of queues) {
        out.push({ jid, size: entry.q.size, pending: entry.q.pending, lastUsedAt: entry.lastUsedAt });
    }
    return out;
}

module.exports = { runOnJidQueue, _stats };
