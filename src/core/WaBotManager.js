const clc = require('cli-color');
const moment = require('moment-timezone');
const WaConnection = require('./WaConnection');
const userWhatsappBotModel = require('../database/models/userWhatsappBotModels');
const WaAuthState = require('../database/models/waAuthStateModel');
const settingsService = require('../services/settingsService');
const { NotFoundException, ConflictException, BadRequestException } = require('../exceptions');

const log = (level, msg) => {
    const colors = { INFO: clc.green.bold, WARN: clc.yellow.bold, ERROR: clc.red.bold, CYAN: clc.cyan.bold };
    const prefix = (colors[level] || clc.white)(`[ ${level} ]`);
    console.log(`${prefix} [${moment().format('HH:mm:ss')}]: ${clc.blueBright(msg)}`);
};

const webhookConfigFromDoc = (botDoc) => {
    if (!botDoc?.webhook_url) return null;
    return {
        url: botDoc.webhook_url,
        events: Array.isArray(botDoc.webhook_events) && botDoc.webhook_events.length
            ? botDoc.webhook_events
            : ['*'],
        secret: botDoc.webhook_secret || null
    };
};

/**
 * WaBotManager - Orchestrates multiple WhatsApp bot connections.
 * Singleton pattern, equivalent of BotManager in Telegram project.
 */
class WaBotManager {
    constructor() {
        this.bots = new Map(); // Map<botId, WaConnection>
        this.isInitialized = false;
        this._messageHandler = null; // Set via setMessageHandler()
    }

    /**
     * Set the global message handler callback.
     * Called for every incoming message across all bots.
     * @param {Function} handler - (sock, message, botId) => Promise<void>
     */
    setMessageHandler(handler) {
        this._messageHandler = handler;
    }

    /**
     * Initialize and load all active bots from database.
     * @param {number} batchSize - Parallel init batch size
     */
    async initialize(batchSize = 10) {
        if (this.isInitialized) {
            log('WARN', 'WaBotManager already initialized');
            return;
        }

        const activeBots = await userWhatsappBotModel.find({
            isActive: true,
            isSuspended: false
        });

        log('INFO', `Loading ${activeBots.length} active WhatsApp bots in batches of ${batchSize}...`);

        let successCount = 0;
        let failureCount = 0;

        for (let i = 0; i < activeBots.length; i += batchSize) {
            const batch = activeBots.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(activeBots.length / batchSize);

            log('CYAN', `Processing batch ${batchNum}/${totalBatches} (${batch.length} bots)...`);

            const results = await Promise.allSettled(
                batch.map(async (botDoc) => {
                    await this.startBot(botDoc);
                    await settingsService.initializeSettings(botDoc._id.toString());
                    return botDoc._id.toString();
                })
            );

            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    successCount++;
                } else {
                    failureCount++;
                    const botId = batch[index]._id;
                    log('ERROR', `Failed to start bot ${botId}: ${result.reason.message}`);
                }
            });
        }

        this.isInitialized = true;
        log('INFO', `WaBotManager initialized: ${successCount} running, ${failureCount} failed`);
    }

    /**
     * Start a bot instance from database document.
     * @param {Object} botDoc - UserWhatsappBot document
     * @returns {Promise<WaConnection>}
     */
    async startBot(botDoc) {
        const botId = botDoc._id.toString();

        if (this.bots.has(botId)) {
            throw new Error(`Bot ${botId} is already running`);
        }

        const connection = new WaConnection({
            botId,
            userId: botDoc.userId,
            phoneNumber: botDoc.phoneNumber,
            onMessage: this._messageHandler,
            webhookConfig: webhookConfigFromDoc(botDoc),
            browserProfile: botDoc.browser_profile
        });

        // Persist the device fingerprint on first start so future restarts
        // reuse the same identity that paired with WhatsApp.
        if (!Array.isArray(botDoc.browser_profile) || botDoc.browser_profile.length !== 3) {
            await userWhatsappBotModel.updateOne(
                { _id: botId },
                { $set: { browser_profile: connection.getBrowserProfile() } }
            ).catch(err => log('WARN', `Failed to persist browser_profile for ${botId}: ${err.message}`));
        }

        // Persist live connection_state on every transition.
        connection.setStatePersister((state) => userWhatsappBotModel.updateOne(
            { _id: botId },
            { $set: { connection_state: state, last_state_change_at: new Date() } }
        ));

        // Handle logged out event: mark as suspended
        connection.on('loggedOut', async () => {
            await userWhatsappBotModel.updateOne(
                { _id: botId },
                { $set: { isSuspended: true } }
            );
            this.bots.delete(botId);
            log('WARN', `Bot ${botId} suspended due to logout`);
        });

        // Handle connection: update lastConnectedAt
        connection.on('connected', async () => {
            await userWhatsappBotModel.updateOne(
                { _id: botId },
                { $set: { lastConnectedAt: new Date() } }
            );
        });

        await connection.start();
        this.bots.set(botId, connection);

        return connection;
    }

    /**
     * Create a new WhatsApp bot.
     * Initiates the pairing flow (QR or code).
     * @param {Object} params
     * @param {string} params.userId - Owner user ID
     * @param {string} params.phoneNumber - WhatsApp number (international, no +)
     * @param {string} [params.botName] - Display name
     * @param {string} [params.pairingMethod='qr'] - 'qr' or 'code'
     * @returns {Promise<{ botDoc: Object, connection: WaConnection }>}
     */
    async createBot({ userId, phoneNumber, botName, pairingMethod = 'qr', webhookUrl = null, webhookEvents = null, webhookSecret = null }) {
        // Validate phone number format
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (cleanNumber.length < 10 || cleanNumber.length > 15) {
            throw new BadRequestException('Invalid phone number format. Use international format without +, e.g. 6281234567890');
        }

        // Check for duplicate phone number
        const existingBot = await userWhatsappBotModel.findOne({ phoneNumber: cleanNumber });
        if (existingBot) {
            throw new ConflictException(`WhatsApp number ${cleanNumber} sudah terdaftar`);
        }

        // Create database record
        const botDoc = new userWhatsappBotModel({
            userId,
            phoneNumber: cleanNumber,
            botName: botName || null,
            pairingMethod,
            isActive: true,
            isSuspended: false,
            webhook_url: webhookUrl || null,
            webhook_events: Array.isArray(webhookEvents) && webhookEvents.length ? webhookEvents : ['*'],
            webhook_secret: webhookSecret || null
        });
        await botDoc.save();

        // Create and start connection (will emit QR or pairing code)
        const connection = new WaConnection({
            botId: botDoc._id.toString(),
            userId,
            phoneNumber: cleanNumber,
            onMessage: this._messageHandler,
            webhookConfig: webhookConfigFromDoc(botDoc),
            browserProfile: null   // freshly generated; persisted below
        });

        // Persist the freshly-generated device fingerprint so future restarts
        // reuse the same identity that pairs with WhatsApp.
        await userWhatsappBotModel.updateOne(
            { _id: botDoc._id },
            { $set: { browser_profile: connection.getBrowserProfile() } }
        ).catch(err => log('WARN', `Failed to persist browser_profile for ${botDoc._id}: ${err.message}`));

        // Persist live connection_state on every transition.
        connection.setStatePersister((state) => userWhatsappBotModel.updateOne(
            { _id: botDoc._id },
            { $set: { connection_state: state, last_state_change_at: new Date() } }
        ));

        // Handle events
        connection.on('loggedOut', async () => {
            await userWhatsappBotModel.updateOne(
                { _id: botDoc._id },
                { $set: { isSuspended: true } }
            );
            this.bots.delete(botDoc._id.toString());
        });

        connection.on('connected', async () => {
            await userWhatsappBotModel.updateOne(
                { _id: botDoc._id },
                { $set: { lastConnectedAt: new Date() } }
            );
            await settingsService.initializeSettings(botDoc._id.toString());
        });

        await connection.start({ pairingCode: pairingMethod === 'code' });
        this.bots.set(botDoc._id.toString(), connection);

        return { botDoc, connection };
    }

    /**
     * Delete a bot: stop connection, delete auth state, delete record.
     */
    async deleteBot(botId) {
        const botDoc = await userWhatsappBotModel.findById(botId);
        if (!botDoc) {
            throw new NotFoundException('Bot tidak ditemukan');
        }

        // Stop if running. Clear webhook BEFORE disconnect so the dying
        // socket doesn't emit a bot_disconnected event for a bot the
        // integrator has already deleted (would be undeliverable noise).
        if (this.bots.has(botId)) {
            const conn = this.bots.get(botId);
            conn.setWebhookConfig(null);
            await conn.disconnect();
            this.bots.delete(botId);
        }

        // Clean up auth state
        await WaAuthState.deleteMany({ botId });

        // Delete record
        await userWhatsappBotModel.deleteOne({ _id: botId });

        log('INFO', `Bot ${botId} deleted (including auth state)`);
    }

    /**
     * Stop a bot connection (preserves session for restart).
     */
    async stopBot(botId) {
        const conn = this.bots.get(botId);
        if (!conn) {
            throw new Error(`Bot ${botId} is not running`);
        }

        await conn.disconnect();
        this.bots.delete(botId);
    }

    /**
     * Deactivate a bot: disconnect and mark inactive.
     */
    async deactivateBot(botId) {
        const botDoc = await userWhatsappBotModel.findById(botId);
        if (!botDoc) {
            throw new NotFoundException('Bot tidak ditemukan');
        }

        if (this.bots.has(botId)) {
            await this.stopBot(botId);
        }

        await userWhatsappBotModel.updateOne(
            { _id: botId },
            { $set: { isActive: false } }
        );

        log('INFO', `Bot ${botId} deactivated`);
    }

    /**
     * Reactivate a bot: mark active and reconnect.
     */
    async reactivateBot(botId) {
        const botDoc = await userWhatsappBotModel.findById(botId);
        if (!botDoc) {
            throw new NotFoundException('Bot tidak ditemukan');
        }

        await userWhatsappBotModel.updateOne(
            { _id: botId },
            { $set: { isActive: true, isSuspended: false } }
        );

        // Reload doc to get updated fields
        const updatedDoc = await userWhatsappBotModel.findById(botId);
        await this.startBot(updatedDoc);

        log('INFO', `Bot ${botId} reactivated`);
    }

    /**
     * Update bot configuration.
     * @param {Object} params
     * @param {string} params.botId
     * @param {string} [params.botName]
     * @returns {Promise<Object>} Updated document
     */
    async updateBot({ botId, botName, webhookUrl, webhookEvents, webhookSecret }) {
        const botDoc = await userWhatsappBotModel.findById(botId);
        if (!botDoc) {
            throw new NotFoundException('Bot tidak ditemukan');
        }

        const updates = {};
        if (botName !== undefined && botName !== botDoc.botName) {
            updates.botName = botName;
        }
        if (webhookUrl !== undefined && webhookUrl !== botDoc.webhook_url) {
            updates.webhook_url = webhookUrl;
        }
        if (webhookEvents !== undefined) {
            updates.webhook_events = Array.isArray(webhookEvents) && webhookEvents.length
                ? webhookEvents
                : ['*'];
        }
        if (webhookSecret !== undefined && webhookSecret !== botDoc.webhook_secret) {
            updates.webhook_secret = webhookSecret;
        }

        if (Object.keys(updates).length === 0) {
            return botDoc;
        }

        await userWhatsappBotModel.updateOne({ _id: botId }, { $set: updates });

        const updatedDoc = await userWhatsappBotModel.findById(botId);

        // Push the new webhook config to a running connection without restart.
        const webhookFieldChanged =
            updates.webhook_url !== undefined ||
            updates.webhook_events !== undefined ||
            updates.webhook_secret !== undefined;
        if (webhookFieldChanged && this.bots.has(botId)) {
            this.bots.get(botId).setWebhookConfig(webhookConfigFromDoc(updatedDoc));
        }

        return updatedDoc;
    }

    /**
     * Wait for pending transactions for a specific bot.
     */
    async _waitForPendingTransactions(botId) {
        const transactionModel = require('../database/models/transactionModels');
        const maxWaitTime = 360000;
        const checkInterval = 3000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            const pendingCount = await transactionModel.countDocuments({
                botId,
                isSuccess: false,
                isCanceled: false
            });

            if (pendingCount === 0) return;

            log('CYAN', `Waiting for ${pendingCount} pending transaction(s) for bot ${botId}...`);
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        log('WARN', `Max wait time exceeded for bot ${botId}, proceeding...`);
    }

    /**
     * Get a bot connection by ID.
     * @param {string} botId
     * @returns {WaConnection|null}
     */
    getBotInstance(botId) {
        return this.bots.get(botId) || null;
    }

    /**
     * Get all running bot connections.
     */
    getAllBots() {
        return Array.from(this.bots.values());
    }

    /**
     * Get bots by user ID.
     */
    getBotsByUserId(userId) {
        return this.getAllBots().filter(bot => bot.userId === userId);
    }

    /**
     * Graceful shutdown of all bots, in parallel batches so we don't open
     * thousands of socket-close requests at once but still finish quickly
     * even with hundreds of bots.
     * @param {number} batchSize
     */
    async shutdown(batchSize = 25) {
        const total = this.bots.size;
        log('INFO', `Shutting down ${total} WhatsApp bots in batches of ${batchSize}...`);

        const entries = [...this.bots.entries()];
        let stopped = 0;

        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize);
            await Promise.all(batch.map(([botId, conn]) =>
                conn.disconnect().catch(err =>
                    log('ERROR', `Error stopping bot ${botId}: ${err.message}`)
                )
            ));
            stopped += batch.length;
            if (total > batchSize) {
                log('INFO', `Stopped ${stopped}/${total} bots`);
            }
        }

        this.bots.clear();
        this.isInitialized = false;

        log('INFO', 'All WhatsApp bots stopped');
    }
}

module.exports = new WaBotManager();
