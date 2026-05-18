const { loadBaileys } = require('./baileysLoader');
const WaAuthState = require('../database/models/waAuthStateModel');
const { EncryptionService } = require('./authEncryption');
const clc = require('cli-color');

/**
 * Creates a Baileys-compatible auth state backed by MongoDB.
 * Each bot has its own isolated auth data identified by botId.
 * All data is encrypted at rest using AES-256-GCM.
 *
 * Hot signal sessions are wrapped with `makeCacheableSignalKeyStore` so that
 * encrypting a fan-out message (e.g. group with 1k participants) doesn't
 * fire ~2k MongoDB roundtrips per send. Writes still persist to MongoDB
 * synchronously — cache is read-through + write-through, no durability loss.
 *
 * v7 NOTE: auth-state schema gained `lid-mapping`, `device-list`, `tctoken`
 * key categories. They flow through the same dynamic `keys.set/get` API and
 * persist via the existing `keys-{type}-{id}` document layout — no schema change.
 *
 * @param {string} botId - Unique identifier for this bot instance
 * @param {Object} [logger] - Optional pino logger; passed to makeCacheableSignalKeyStore
 * @returns {Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }>}
 */
async function useMongoAuthState(botId, logger) {
    const baileys = await loadBaileys();
    const { proto, initAuthCreds, makeCacheableSignalKeyStore } = baileys;

    const encryption = EncryptionService.getInstance();

    async function writeData(dataType, dataKey, data) {
        const serialized = JSON.stringify(data, BufferJSON.replacer);
        const encrypted = encryption.encrypt(serialized);

        await WaAuthState.updateOne(
            { botId, dataType, dataKey },
            { $set: { data: encrypted } },
            { upsert: true }
        );
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

    async function removeData(dataType, dataKey) {
        await WaAuthState.deleteOne({ botId, dataType, dataKey });
    }

    async function clearAll() {
        await WaAuthState.deleteMany({ botId });
    }

    // Delete all signal session docs for a single peer JID. Used by
    // WaConnection to auto-repair "Bad MAC" / counter-drift situations:
    // dropping the local session-{jid}* docs forces a clean prekey bundle
    // exchange on the next inbound message from that peer. No re-pair needed.
    async function purgePeerSession(jid) {
        if (!jid || typeof jid !== 'string') return 0;
        const safe = jid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const result = await WaAuthState.deleteMany({
            botId,
            dataType: 'keys',
            dataKey: { $regex: `^session-.*${safe}` }
        });
        return result?.deletedCount || 0;
    }

    let creds = await readData('creds', 'main');
    if (!creds) {
        creds = initAuthCreds();
        await writeData('creds', 'main', creds);
    }

    const rawKeys = {
            get: async (type, ids) => {
                const data = {};
                await Promise.all(
                    ids.map(async (id) => {
                        const key = `${type}-${id}`;
                        let value = await readData('keys', key);
                        // v7: proto API now exposes only .create / .encode / .decode.
                        // .fromObject removed → use .create for app-state-sync-key hydration.
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.create(value);
                        }
                        data[id] = value;
                    })
                );
                return data;
            },

            set: async (data) => {
                const tasks = [];
                for (const category in data) {
                    for (const id in data[category]) {
                        const value = data[category][id];
                        const key = `${category}-${id}`;
                        if (value) {
                            tasks.push(writeData('keys', key, value));
                        } else {
                            tasks.push(removeData('keys', key));
                        }
                    }
                }
                await Promise.all(tasks);
            }
    };

    const state = {
        creds,
        keys: makeCacheableSignalKeyStore(rawKeys, logger)
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
