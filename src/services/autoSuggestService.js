const variantSearchService = require('./variantSearchService');
const groupSettingsService = require('./groupSettingsService');
const autoSuggestCooldown = require('../state/autoSuggestCooldown');
const { formatAutoSuggestReply } = require('../utils/autoSuggestReply');

const MIN_TOKEN_LENGTH = 4;
const MIN_SCORE_THRESHOLD = 150;
const MAX_SUGGESTIONS = 5;
const PER_TOKEN_SCAN_LIMIT = 10;
const MAX_TOKENS_PER_MESSAGE = 8;

function _tokenize(text) {
    if (!text) return [];
    const raw = String(text).toLowerCase().split(/\s+/);
    const seen = new Set();
    const tokens = [];
    for (const w of raw) {
        const clean = w.replace(/[^\p{L}\p{N}_-]/gu, '');
        if (clean.length < MIN_TOKEN_LENGTH) continue;
        if (seen.has(clean)) continue;
        seen.add(clean);
        tokens.push(clean);
        if (tokens.length >= MAX_TOKENS_PER_MESSAGE) break;
    }
    return tokens;
}

async function detectIntent(ctx, text) {
    const tokens = _tokenize(text);
    if (tokens.length === 0) return null;

    const aggregate = new Map();

    for (const token of tokens) {
        let hits;
        try {
            hits = await variantSearchService.findSimilarScored(ctx, token, PER_TOKEN_SCAN_LIMIT);
        } catch (_) {
            continue;
        }
        for (const { variant, score } of hits) {
            if (score < MIN_SCORE_THRESHOLD) continue;
            const key = variant.codeVariant;
            const existing = aggregate.get(key);
            if (existing) {
                existing.totalScore += score;
                if (score > existing.topTokenScore) {
                    existing.topTokenScore = score;
                    existing.topToken = token;
                }
            } else {
                aggregate.set(key, {
                    variant,
                    totalScore: score,
                    topTokenScore: score,
                    topToken: token
                });
            }
        }
    }

    if (aggregate.size === 0) return null;

    const ranked = [...aggregate.values()].sort((a, b) => b.totalScore - a.totalScore);
    const topVariants = ranked.slice(0, MAX_SUGGESTIONS).map(r => r.variant);
    const primaryKeyword = ranked[0].topToken;

    return { variants: topVariants, primaryKeyword };
}

async function maybeReply(ctx, text) {
    try {
        if (!ctx.isGroup) return;

        const groupJid = ctx.chat;
        const enabled = await groupSettingsService.isAutoSuggestEnabled(ctx, groupJid);
        if (!enabled) return;

        const key = ctx.rawMessage?.key || {};
        const senderJid = key.participant || ctx.jid;
        if (!senderJid) return;

        const intent = await detectIntent(ctx, text);
        if (!intent) return;

        if (!autoSuggestCooldown.canTrigger(senderJid, intent.primaryKeyword)) return;

        const enriched = await variantSearchService.enrichPrices(ctx, intent.variants);
        if (enriched.length === 0) return;

        const phone = String(senderJid).split('@')[0].split(':')[0];
        const body = formatAutoSuggestReply(enriched, { mentionPhone: phone });
        if (!body) return;

        await ctx.sock.sendMessage(
            ctx.chat,
            { text: body, mentions: [senderJid] },
            { quoted: ctx.rawMessage }
        );

        autoSuggestCooldown.markTriggered(senderJid, intent.primaryKeyword);
    } catch (err) {
        const clc = require('cli-color');
        const moment = require('moment-timezone');
        console.log(
            clc.red.bold('[ ERROR ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`autoSuggestService.maybeReply: ${err.message}`)
        );
    }
}

module.exports = { detectIntent, maybeReply, _tokenize };
