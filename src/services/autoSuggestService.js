const variantSearchService = require('./variantSearchService');
const groupSettingsService = require('./groupSettingsService');
const autoSuggestCooldown = require('../state/autoSuggestCooldown');
const { formatAutoSuggestReply } = require('../utils/autoSuggestReply');

const MIN_TOKEN_LENGTH = 3;
const SHORT_TOKEN_THRESHOLD = 4;
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
    console.log('[ AUTOSUGGEST ] tokens', tokens);
    if (tokens.length === 0) return null;

    const aggregate = new Map();

    for (const token of tokens) {
        let hits;
        try {
            hits = await variantSearchService.findSimilarScored(ctx, token, PER_TOKEN_SCAN_LIMIT);
        } catch (err) {
            console.log('[ AUTOSUGGEST ] findSimilarScored error', token, err.message);
            continue;
        }

        if (token.length < SHORT_TOKEN_THRESHOLD) {
            hits = hits.filter(h => {
                const code = String(h.variant.codeVariant || '').toLowerCase();
                const name = String(h.variant.name || '').toLowerCase();
                const pName = String(h.variant.productName || '').toLowerCase();
                return code.startsWith(token)
                    || name.startsWith(token)
                    || pName.startsWith(token);
            });
        }

        console.log('[ AUTOSUGGEST ] hits', {
            token,
            len: token.length,
            count: hits.length,
            top: hits.slice(0, 3).map(h => ({ code: h.variant.codeVariant, score: h.score }))
        });
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

        console.log('[ AUTOSUGGEST ] enter', {
            chat: ctx.chat,
            text: String(text || '').slice(0, 80),
            hasRepoCtx: !!ctx.repositoryContext,
            ownerId: ctx.repositoryContext?.ownerId,
            botId: ctx.state?.botId,
            mode: ctx.repositoryContext?.mode
        });

        if (!ctx.repositoryContext) {
            console.log('[ AUTOSUGGEST ] skip: repositoryContext null (botContext/contextInjection middleware gagal)');
            return;
        }

        const groupJid = ctx.chat;
        const enabled = await groupSettingsService.isAutoSuggestEnabled(ctx, groupJid);
        console.log('[ AUTOSUGGEST ] enabled?', enabled);
        if (!enabled) return;

        const key = ctx.rawMessage?.key || {};
        let senderJid = key.participant || ctx.jid;
        if (senderJid && String(senderJid).endsWith('@lid') && key.participantAlt) {
            senderJid = key.participantAlt;
        }
        console.log('[ AUTOSUGGEST ] senderJid', senderJid);
        if (!senderJid) return;

        const intent = await detectIntent(ctx, text);
        console.log('[ AUTOSUGGEST ] intent', intent
            ? { keyword: intent.primaryKeyword, codes: intent.variants.map(v => v.codeVariant) }
            : null);
        if (!intent) return;

        const canTrigger = autoSuggestCooldown.canTrigger(senderJid, intent.primaryKeyword);
        console.log('[ AUTOSUGGEST ] cooldown.canTrigger', canTrigger, 'key=', `${senderJid}::${intent.primaryKeyword}`);
        if (!canTrigger) return;

        const enriched = await variantSearchService.enrichPrices(ctx, intent.variants);
        console.log('[ AUTOSUGGEST ] enriched', enriched.length);
        if (enriched.length === 0) return;

        const phone = String(senderJid).split('@')[0].split(':')[0];
        const body = formatAutoSuggestReply(enriched, { mentionPhone: phone });
        if (!body) return;

        console.log('[ AUTOSUGGEST ] sending to', ctx.chat, 'mentions=', [senderJid]);
        await ctx.sock.sendMessage(
            ctx.chat,
            { text: body, mentions: [senderJid] },
            { quoted: ctx.rawMessage }
        ).catch(err => {
            console.log('[ AUTOSUGGEST ] sendMessage failed', err.message, err.stack);
            throw err;
        });
        console.log('[ AUTOSUGGEST ] reply sent');

        autoSuggestCooldown.markTriggered(senderJid, intent.primaryKeyword);
    } catch (err) {
        const clc = require('cli-color');
        const moment = require('moment-timezone');
        console.log(
            clc.red.bold('[ ERROR ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`autoSuggestService.maybeReply: ${err.message}`)
        );
        console.log('[ AUTOSUGGEST ] error stack', err.stack);
    }
}

module.exports = { detectIntent, maybeReply, _tokenize };
