const crypto = require('crypto');


class EncryptionService {
    constructor(encryptionKey = null, keyName = 'BOT_TOKEN_ENCRYPTION_KEY') {
        this.algorithm = 'aes-256-gcm';
        this.keyLength = 32;
        this.ivLength = 16;
        this.saltLength = 16;
        this.pbkdf2Iterations = 100000;
        this.pbkdf2Digest = 'sha256';

        // Get encryption key from parameter or environment
        this.encryptionKey = encryptionKey || process.env.BOT_TOKEN_ENCRYPTION_KEY;
        if (!this.encryptionKey) {
            throw new Error(`${keyName} is required in environment variables`);
        }
    }

    /**
     * Derive encryption key using PBKDF2
     * @param {Buffer} salt - Random salt
     * @returns {Buffer} - Derived 32-byte key
     */
    deriveKey(salt) {
        return crypto.pbkdf2Sync(
            this.encryptionKey,
            salt,
            this.pbkdf2Iterations,
            this.keyLength,
            this.pbkdf2Digest
        );
    }

    /**
     * Encrypt bot token
     * @param {string} plainText - Bot token to encrypt
     * @returns {string} - Encrypted token (format: salt:iv:encrypted:authTag in hex)
     */
    encrypt(plainText) {
        const salt = crypto.randomBytes(this.saltLength);
        const iv = crypto.randomBytes(this.ivLength);
        const key = this.deriveKey(salt);

        const cipher = crypto.createCipheriv(this.algorithm, key, iv);

        let encrypted = cipher.update(plainText, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag();

        // Return format: salt:iv:encrypted:authTag (all in hex)
        return `${salt.toString('hex')}:${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
    }

    /**
     * Decrypt bot token
     * @param {string} encryptedText - Encrypted token (format: salt:iv:encrypted:authTag)
     * @returns {string} - Decrypted bot token
     */
    decrypt(encryptedText) {
        const parts = encryptedText.split(':');
        if (parts.length !== 4) {
            throw new Error('Invalid encrypted token format. Expected format: salt:iv:encrypted:authTag');
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

    /**
     * Validate if a string is a valid bot token format
     * @param {string} token - Token to validate
     * @returns {boolean}
     */
    isValidTokenFormat(token) {
        // Telegram bot token format: number:alphanumeric
        const tokenRegex = /^\d+:[A-Za-z0-9_-]+$/;
        return tokenRegex.test(token);
    }
}

const defaultInstance = new EncryptionService();

/**
 * Factory method to create a new EncryptionService with a custom key
 * @param {string} key - Encryption key
 * @param {string} keyName - Key name for error messages
 * @returns {EncryptionService}
 */
defaultInstance.createInstance = function(key, keyName) {
    return new EncryptionService(key, keyName);
};

module.exports = defaultInstance;
