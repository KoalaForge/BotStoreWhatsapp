const variantSearchService = require('./variantSearchService');
const groupSettingsService = require('./groupSettingsService');
const autoSuggestCooldown = require('../state/autoSuggestCooldown');
const { formatAutoSuggestReply } = require('../utils/autoSuggestReply');

const MAX_SUGGESTIONS = 5;

function _normalize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[?!.,;:]+$/g, '')
        .trim()
        .replace(/\s+/g, ' ');
}

async function detectIntent(ctx, text) {
    const norm = _normalize(text);
    console.log('[ AUTOSUGGEST ] normalized', norm);
    if (!norm) return null;

    let matches;
    try {
        matches = await variantSearchService.findExactMatch(ctx, norm);
    } catch (err) {
        console.log('[ AUTOSUGGEST ] findExactMatch error', err.message);
        return null;
    }
    console.log('[ AUTOSUGGEST ] exact matches', matches.length, matches.slice(0, 3).map(m => m.codeVariant));

    if (matches.length === 0) return null;

    return {
        variants: matches.slice(0, MAX_SUGGESTIONS),
        primaryKeyword: norm
    };
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

        const canTrigger = autoSuggestCooldown.canTrigger(groupJid, senderJid, intent.primaryKeyword);
        console.log('[ AUTOSUGGEST ] cooldown.canTrigger', canTrigger, 'key=', `${groupJid}::${senderJid}::${intent.primaryKeyword}`);
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

        autoSuggestCooldown.markTriggered(groupJid, senderJid, intent.primaryKeyword);
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

module.exports = { detectIntent, maybeReply, _normalize };
