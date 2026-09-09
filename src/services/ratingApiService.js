const axios = require('axios');
const { createHash } = require('crypto');
const settingsService = require('./settingsService');

const REQUEST_TIMEOUT_MS = 5000;
const SUMMARY_FRESH_MS = 30_000;
const SUMMARY_RETAIN_MS = 60 * 60_000;
const MAX_SCOPES = 50;
const MAX_ENTRIES = 500;
const MAX_PENDING = 50;
const summaryScopes = new Map();
const normalize = value => String(value).trim().toLowerCase();

async function cachedSummaries({ ownerId, botId, productCodes, variants, enabled }) {
    const { baseUrl, apiKey } = getConfig();
    const scopeKey = JSON.stringify([ownerId, botId, baseUrl,
        createHash('sha256').update(apiKey).digest('hex')]);
    let scope = summaryScopes.get(scopeKey);
    const evict = reason => {
        if (scope) scope.invalidReason = reason;
        if (summaryScopes.get(scopeKey) === scope) summaryScopes.delete(scopeKey);
        return unavailable(reason);
    };
    if (!enabled) return evict('disabled');
    if (!baseUrl || !apiKey) return evict('not_configured');
    if (!scope) {
        scope = { entries: new Map(), pending: new Map() };
        summaryScopes.set(scopeKey, scope);
        if (summaryScopes.size > MAX_SCOPES) {
            const oldest = summaryScopes.keys().next().value;
            summaryScopes.get(oldest).invalidReason = 'cache_evicted';
            summaryScopes.delete(oldest);
        }
    }
    const requested = [
        ...productCodes.map(code => ['products', code, normalize(code)]),
        ...variants.map(({ productCode, variantCode }) => [
            'variants', `${productCode}|${variantCode}`, `${normalize(productCode)}|${normalize(variantCode)}`
        ])
    ];
    const readCache = maxAge => {
        const result = { products: {}, variants: {} };
        let hits = 0;
        for (const [kind, , code] of requested) {
            const entry = scope.entries.get(`${kind}:${code}`);
            if (entry && Date.now() - entry.time < maxAge) {
                Object.defineProperty(result[kind], code, { value: { ...entry.value }, enumerable: true });
                hits++;
            }
        }
        return { result, hits };
    };
    for (const [key, entry] of scope.entries) {
        if (Date.now() - entry.time >= SUMMARY_RETAIN_MS) scope.entries.delete(key);
    }
    const fresh = readCache(SUMMARY_FRESH_MS);
    if (fresh.hits === requested.length) return fresh.result;
    const requestKey = JSON.stringify([...new Set(requested.map(([kind, , code]) => `${kind}:${code}`))].sort());
    if (scope.pending.has(requestKey)) {
        const result = await scope.pending.get(requestKey);
        if (scope.invalidReason) return unavailable(scope.invalidReason);
        return result.available === false ? result : readCache(SUMMARY_RETAIN_MS).result;
    }
    if (scope.pending.size >= MAX_PENDING) return unavailable('busy');
    const pending = (async () => {
        try {
            const response = await post('/reviews/summaries', {
                owner_id: ownerId,
                bot_id: botId,
                product_codes: productCodes,
                variants: variants.map(({ productCode, variantCode }) => ({
                    product_code: productCode,
                    variant_code: variantCode
                }))
            });
            if (scope.invalidReason) return unavailable(scope.invalidReason);
            const data = response.data?.data || response.data;
            if (data?.available === false) return evict(data.reason || 'api_unavailable');
            if (!data?.products || !data?.variants) return unavailable('api_unavailable');
            for (const [kind, , code] of requested) scope.entries.delete(`${kind}:${code}`);
            for (const kind of ['products', 'variants']) {
                for (const [code, value] of Object.entries(data[kind])) {
                    if (!value || typeof value !== 'object') continue;
                    const key = `${kind}:${code.split('|').map(normalize).join('|')}`;
                    scope.entries.delete(key);
                    scope.entries.set(key, { value: { ...value }, time: Date.now() });
                    if (scope.entries.size > MAX_ENTRIES) scope.entries.delete(scope.entries.keys().next().value);
                }
            }
            return data;
        } catch (error) {
            if (scope.invalidReason) return unavailable(scope.invalidReason);
            const status = error.response?.status || null;
            // Only transport failures and server errors may reuse a last success.
            if ((!error.response && error.code !== 'RATING_API_NOT_CONFIGURED') || status >= 500) {
                const stale = readCache(SUMMARY_RETAIN_MS);
                if (stale.hits) return stale.result;
            } else {
                evict('api_unavailable');
            }
            return unavailable('api_unavailable', status);
        }
    })();
    scope.pending.set(requestKey, pending);
    try {
        return await pending;
    } finally {
        scope.pending.delete(requestKey);
    }
}

function getConfig() {
    const primaryUrl = (process.env.KOALABOTBE_API_URL || '').trim();
    const fallbackUrl = (process.env.LARAVEL_ADMIN_PANEL_URL || '').trim();
    const baseUrl = (primaryUrl || fallbackUrl).replace(/\/+$/, '');
    const apiKey = (process.env.INTERNAL_API_KEY || '').trim();
    return { baseUrl, apiKey };
}

function isConfigured() {
    const { baseUrl, apiKey } = getConfig();
    return Boolean(baseUrl && apiKey);
}

function unavailable(reason, status = null) {
    return {
        available: false,
        reason,
        ...(status ? { status } : {})
    };
}

function toSubmissionError(error) {
    const status = error.response?.status || null;
    const apiCode = error.response?.data?.code || error.response?.data?.error || null;
    const validationMessage = error.response?.data?.errors?.transaction_id?.[0] || null;
    const cleanError = new Error(
        status ? 'Permintaan rating tidak dapat diproses.' : 'Layanan rating sedang tidak tersedia.'
    );
    cleanError.name = 'RatingApiError';
    cleanError.status = status;
    cleanError.code = apiCode || (status ? `HTTP_${status}` : 'RATING_API_UNAVAILABLE');
    cleanError.reason = validationMessage;
    return cleanError;
}

async function post(path, body, timeout = REQUEST_TIMEOUT_MS) {
    const { baseUrl, apiKey } = getConfig();
    if (!baseUrl || !apiKey) {
        const error = new Error('Layanan rating belum dikonfigurasi.');
        error.name = 'RatingApiError';
        error.code = 'RATING_API_NOT_CONFIGURED';
        error.status = null;
        throw error;
    }

    return axios.post(`${baseUrl}/api/v1/internal${path}`, body, {
        timeout,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Internal-Api-Key': apiKey
        }
    });
}

async function getSummaries({ ownerId = null, botId = null, productCodes, variants }) {
    let enabled = true;
    try {
        const settings = await settingsService.getSettingsByBotId(botId);
        enabled = settings?.ratingEnabled !== false;
    } catch {
        // Match existing callers: a settings lookup failure does not disable ratings.
    }
    return cachedSummaries({ ownerId, botId, productCodes, variants, enabled });
}

async function submitRating({ transactionId, channelUserId, rating, comment }) {
    try {
        const response = await post('/reviews', {
            transaction_id: transactionId,
            channel_user_id: String(channelUserId),
            channel: 'whatsapp',
            rating,
            ...(comment ? { comment } : {})
        });
        return response.data;
    } catch (error) {
        if (error.name === 'RatingApiError') throw error;
        throw toSubmissionError(error);
    }
}

async function skipRating({ transactionId, channelUserId }) {
    try {
        const response = await post('/reviews/skip', {
            transaction_id: transactionId,
            channel_user_id: String(channelUserId),
            channel: 'whatsapp'
        });
        return response.data;
    } catch (error) {
        if (error.name === 'RatingApiError') throw error;
        throw toSubmissionError(error);
    }
}

async function claimPrompt({ transactionId, channelUserId }) {
    try {
        const response = await post('/reviews/prompt', {
            transaction_id: transactionId,
            channel_user_id: String(channelUserId),
            channel: 'whatsapp'
        });
        return response.data?.data?.should_prompt === true;
    } catch (error) {
        console.error(`[rating] Failed to claim prompt for ${transactionId}:`, error.message);
        return false;
    }
}

module.exports = {
    isConfigured,
    getSummaries,
    submitRating,
    skipRating,
    claimPrompt
};
