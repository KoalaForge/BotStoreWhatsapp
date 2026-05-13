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
    }

    deriveKey(salt) {
        return crypto.pbkdf2Sync(
            this.encryptionKey,
            salt,
            this.pbkdf2Iterations,
            this.keyLength,
            this.pbkdf2Digest
        );
    }

    encrypt(plainText) {
        const salt = crypto.randomBytes(this.saltLength);
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
