const crypto = require('crypto');

/**
 * Encryption service for WhatsApp auth state data.
 * Uses AES-256-GCM with PBKDF2 key derivation.
 * Singleton pattern - initialized once with WA_AUTH_ENCRYPTION_KEY.
 */
class AuthEncryptionService {
    constructor(encryptionKey) {
        this.algorithm = 'aes-256-gcm';
        this.keyLength = 32;
        this.ivLength = 16;
        this.saltLength = 16;
        this.pbkdf2Iterations = 100000;
        this.pbkdf2Digest = 'sha256';
        this.encryptionKey = encryptionKey;

        // PBKDF2(100k) costs ~50-90ms and is SYNCHRONOUS — it blocks the event
        // loop. The old code derived a fresh key per encrypt/decrypt with a
        // random per-call salt. Baileys 7.x uploads INITIAL_PREKEY_COUNT=812
        // pre-keys on a fresh pair; encrypting them one-by-one = 812 × pbkdf2
        // ≈ 74s of blocked loop → WS keepalive starves → "Connection was lost"
        // → reconnect → regenerate 812 → infinite loop (single bot never comes
        // online). Fix: derive ONCE and cache. New writes use a deterministic
        // fixed salt so they all share one cached key; decrypt caches by the
        // salt embedded in each record, so legacy random-salt data still
        // decrypts (one pbkdf2 per distinct legacy salt, then cached). GCM
        // stays secure via a random IV per encrypt.
        this._keyCache = new Map();
        this._fixedSalt = crypto
            .createHash('sha256')
            .update(`wa-auth-kdf-salt-v1:${encryptionKey}`)
            .digest()
            .subarray(0, this.saltLength);
    }

    deriveKey(salt) {
        const cacheKey = salt.toString('hex');
        let key = this._keyCache.get(cacheKey);
        if (!key) {
            key = crypto.pbkdf2Sync(
                this.encryptionKey,
                salt,
                this.pbkdf2Iterations,
                this.keyLength,
                this.pbkdf2Digest
            );
            this._keyCache.set(cacheKey, key);
        }
        return key;
    }

    encrypt(plainText) {
        // Fixed salt → cached derived key (no per-call PBKDF2). IV stays random.
        const salt = this._fixedSalt;
        const iv = crypto.randomBytes(this.ivLength);
        const key = this.deriveKey(salt);

        const cipher = crypto.createCipheriv(this.algorithm, key, iv);
        let encrypted = cipher.update(plainText, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();

        return `${salt.toString('hex')}:${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
    }

    decrypt(encryptedText) {
        const parts = encryptedText.split(':');
        if (parts.length !== 4) {
            throw new Error('Invalid encrypted auth data format');
        }

        const salt = Buffer.from(parts[0], 'hex');
        const iv = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        const authTag = Buffer.from(parts[3], 'hex');

        const key = this.deriveKey(salt);
        const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}

let _instance = null;

const EncryptionService = {
    /**
     * Initialize the singleton with the encryption key.
     * Called once at startup.
     */
    initialize(key) {
        if (!key) {
            throw new Error('WA_AUTH_ENCRYPTION_KEY is required');
        }
        _instance = new AuthEncryptionService(key);
    },

    /**
     * Get the singleton instance.
     * Falls back to env var if not explicitly initialized.
     */
    getInstance() {
        if (!_instance) {
            const key = process.env.WA_AUTH_ENCRYPTION_KEY;
            if (!key) {
                throw new Error('WA_AUTH_ENCRYPTION_KEY is not set. Call EncryptionService.initialize() or set env var.');
            }
            _instance = new AuthEncryptionService(key);
        }
        return _instance;
    }
};

module.exports = { EncryptionService };
