const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { loadBaileys } = require('./baileysLoader');
const WaAuthState = require('../database/models/waAuthStateModel');
const { EncryptionService } = require('./authEncryption');
const clc = require('cli-color');

// Durable-write retry. A transient Mongo network blip (ENETUNREACH / timeout)
// must NOT silently drop a creds/keys write — that desyncs the persisted
// session from the live one and triggers a code 405 reconnect loop. Retry
// transient errors with jittered backoff; rethrow on exhaustion so the caller
// (WaConnection creds.update handler) can mark the session dirty + reflush.
const MONGO_WRITE_RETRIES = Number(process.env.WA_MONGO_WRITE_RETRIES) || 4;
const MONGO_RETRY_BASE = 500;

function isTransientMongoError(err) {
    const name = err?.name || '';
    const msg = (err?.message || '').toLowerCase();
    return /^Mongo(Network|ServerSelection|Network?Timeout|Timeout)/.test(name)
        || msg.includes('timed out') || msg.includes('enetunreach')
        || msg.includes('econnrefused') || msg.includes('econnreset')
        || msg.includes('server selection') || msg.includes('topology')
        || msg.includes('pool') || msg.includes('socket');
}

async function withMongoRetry(op, label) {
    let lastErr;
    for (let attempt = 0; attempt <= MONGO_WRITE_RETRIES; attempt++) {
        try { return await op(); }
        catch (err) {
            lastErr = err;
            if (!isTransientMongoError(err) || attempt === MONGO_WRITE_RETRIES) throw err;
            const delay = Math.round(MONGO_RETRY_BASE * 2 ** attempt * (0.7 + Math.random() * 0.6));
            console.error(clc.yellow(`[WA Auth] ${label} transient mongo error (try ${attempt + 1}/${MONGO_WRITE_RETRIES + 1}): ${err.message} — retry ${delay}ms`));
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastErr;
}

/**
 * Hybrid auth state for Baileys.
 *
 * Ephemeral libsignal keys (session-*, sender-key-*, sender-key-memory-*)
 * persist to the local filesystem under `${WA_AUTH_DIR}/<botId>/keys/` as
 * unencrypted JSON files. This avoids the per-write AES-256-GCM cost and
 * Mongo round-trip that was saturating the event loop during 1k-member
 * group sends and starving WS keepalive → 428 mid-USync.
 *
 * Durable keys (creds, pre-key, signed-pre-key, app-state-sync-key,
 * app-state-sync-version, lid-mapping, device-list, tctoken) stay in
 * MongoDB encrypted at rest — they're identity-critical and small in
 * volume, so the bulkWrite cost is negligible.
 *
 * Existing bots' Mongo session-* docs orphan harmlessly. Libsignal sees
 * an empty session, peer's next message triggers prekey re-exchange via
 * the existing `_recordDecryptFailure` path. No migration needed.
 *
 * @param {string} botId - Unique identifier for this bot instance
 * @returns {Promise<{ state: AuthenticationState, saveCreds: () => Promise<void>, clearAll: Function, purgePeerSession: Function }>}
 */
async function useMongoAuthState(botId) {
    const baileys = await loadBaileys();
    const { proto, initAuthCreds } = baileys;

    const encryption = EncryptionService.getInstance();

    const EPHEMERAL_CATEGORIES = new Set([
        'session',
        'sender-key',
        'sender-key-memory',
    ]);

    const authRoot = process.env.WA_AUTH_DIR || path.join(process.cwd(), 'data', 'auth');
    const botDir = path.join(authRoot, sanitizeSegment(botId || 'unknown'));
    const keysDir = path.join(botDir, 'keys');
    try {
        fs.mkdirSync(keysDir, { recursive: true });
    } catch (err) {
        const hint = err.code === 'EACCES'
            ? ` — set WA_AUTH_DIR to a writable path (e.g. /tmp/wa-auth) or chown the parent dir to the runtime user. In Docker, mount a named volume at /app/data/auth and rebuild so the Dockerfile's chown step runs.`
            : '';
        throw new Error(`[WA Auth] Cannot create keys dir '${keysDir}': ${err.message}${hint}`);
    }

    function sanitizeSegment(s) {
        return String(s).replace(/[/\\:]/g, '_');
    }

    function fsKeyPath(category, id) {
        return path.join(keysDir, `${category}-${sanitizeSegment(id)}.json`);
    }

    async function fsReadKey(category, id) {
        try {
            const raw = await fsp.readFile(fsKeyPath(category, id), 'utf8');
            return JSON.parse(raw, BufferJSON.reviver);
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            console.error(clc.red(`[WA Auth] fs read ${category}/${id} failed for bot ${botId}:`), err.message);
            return null;
        }
    }

    async function fsWriteKey(category, id, value) {
        const file = fsKeyPath(category, id);
        const serialized = JSON.stringify(value, BufferJSON.replacer);
        await fsp.writeFile(file, serialized).catch((err) => {
            console.error(clc.red(`[WA Auth] fs write ${category}/${id} failed for bot ${botId}:`), err.message);
        });
    }

    async function fsDeleteKey(category, id) {
        await fsp.unlink(fsKeyPath(category, id)).catch((err) => {
            if (err.code !== 'ENOENT') {
                console.error(clc.red(`[WA Auth] fs unlink ${category}/${id} failed for bot ${botId}:`), err.message);
            }
        });
    }

    async function writeData(dataType, dataKey, data) {
        const serialized = JSON.stringify(data, BufferJSON.replacer);
        const encrypted = encryption.encrypt(serialized);

        await withMongoRetry(() => WaAuthState.updateOne(
            { botId, dataType, dataKey },
            { $set: { data: encrypted } },
            { upsert: true }
        ), `writeData ${dataType}/${dataKey}`);
    }

    async function readData(dataType, dataKey) {
        const doc = await WaAuthState.findOne({ botId, dataType, dataKey }).lean();
        if (!doc) return null;

        try {
            const decrypted = encryption.decrypt(doc.data);
            return JSON.parse(decrypted, BufferJSON.reviver);
        } catch (err) {
            console.error(clc.red(`[WA Auth] Failed to decrypt ${dataType}/${dataKey} for bot ${botId}:`), err.message);
            return null;
        }
    }

    async function clearAll() {
        await WaAuthState.deleteMany({ botId });
        await fsp.rm(botDir, { recursive: true, force: true }).catch(() => {});
    }

    // Delete local filesystem session-* files matching a peer JID. Used by
    // WaConnection to auto-repair "Bad MAC" / counter-drift situations:
    // dropping the local session-{jid}* files forces a clean prekey bundle
    // exchange on the next inbound message from that peer. Also cleans any
    // legacy Mongo session-* docs from pre-hybrid bots.
    async function purgePeerSession(jid) {
        if (!jid || typeof jid !== 'string') return 0;
        const sanitized = sanitizeSegment(jid);
        let deleted = 0;
        try {
            const entries = await fsp.readdir(keysDir);
            for (const name of entries) {
                if (name.startsWith('session-') && name.includes(sanitized)) {
                    await fsp.unlink(path.join(keysDir, name)).catch(() => {});
                    deleted += 1;
                }
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error(clc.red(`[WA Auth] purgePeerSession fs scan failed for bot ${botId}:`), err.message);
            }
        }
        // Legacy Mongo cleanup — back-compat for bots that had session-* docs
        // before hybrid auth landed. Safe to ignore failures.
        try {
            const safe = jid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const result = await WaAuthState.deleteMany({
                botId,
                dataType: 'keys',
                dataKey: { $regex: `^session-.*${safe}` }
            });
            deleted += result?.deletedCount || 0;
        } catch (_) { /* best-effort */ }
        return deleted;
    }

    let creds = await readData('creds', 'main');
    if (!creds) {
        creds = initAuthCreds();
        await writeData('creds', 'main', creds);
    }

    const state = {
        creds,
        keys: {
            get: async (type, ids) => {
                const data = {};
                const isEphemeral = EPHEMERAL_CATEGORIES.has(type);
                await Promise.all(
                    ids.map(async (id) => {
                        let value;
                        if (isEphemeral) {
                            value = await fsReadKey(type, id);
                        } else {
                            value = await readData('keys', `${type}-${id}`);
                        }
                        // v7: proto API now exposes only .create / .encode / .decode.
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.create(value);
                        }
                        data[id] = value;
                    })
                );
                return data;
            },

            set: async (data) => {
                // Split mutations: ephemeral → filesystem (no AES, no Mongo
                // round-trip), durable → Mongo bulkWrite encrypted. Run both
                // pools in parallel so the slower one bounds wall time.
                const fsTasks = [];
                const mongoOps = [];
                for (const category in data) {
                    const isEphemeral = EPHEMERAL_CATEGORIES.has(category);
                    for (const id in data[category]) {
                        const value = data[category][id];
                        if (isEphemeral) {
                            if (value) {
                                fsTasks.push(fsWriteKey(category, id, value));
                            } else {
                                fsTasks.push(fsDeleteKey(category, id));
                            }
                        } else {
                            const dataKey = `${category}-${id}`;
                            if (value) {
                                const serialized = JSON.stringify(value, BufferJSON.replacer);
                                const encrypted = encryption.encrypt(serialized);
                                mongoOps.push({
                                    updateOne: {
                                        filter: { botId, dataType: 'keys', dataKey },
                                        update: { $set: { data: encrypted } },
                                        upsert: true,
                                    }
                                });
                            } else {
                                mongoOps.push({
                                    deleteOne: {
                                        filter: { botId, dataType: 'keys', dataKey }
                                    }
                                });
                            }
                        }
                    }
                }

                const mongoChain = (async () => {
                    if (!mongoOps.length) return;
                    const CHUNK = 500;
                    for (let i = 0; i < mongoOps.length; i += CHUNK) {
                        const slice = mongoOps.slice(i, i + CHUNK);
                        await withMongoRetry(() => WaAuthState.bulkWrite(slice, { ordered: false }), `keys bulkWrite[${i}]`);
                    }
                })();

                await Promise.all([
                    fsTasks.length ? Promise.all(fsTasks) : Promise.resolve(),
                    mongoChain,
                ]);
            }
        }
    };

    return {
        state,
        saveCreds: async () => {
            await writeData('creds', 'main', state.creds);
        },
        clearAll,
        purgePeerSession
    };
}

const BufferJSON = {
    replacer: (key, value) => {
        if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
            return { __buffer: true, data: Buffer.from(value.data).toString('base64') };
        }
        if (Buffer.isBuffer(value)) {
            return { __buffer: true, data: value.toString('base64') };
        }
        return value;
    },
    reviver: (key, value) => {
        if (value && value.__buffer) {
            return Buffer.from(value.data, 'base64');
        }
        return value;
    }
};

module.exports = { useMongoAuthState, BufferJSON };
