const clc = require('cli-color');
const settingsService = require('../services/settingsService');
const modeService = require('../services/modeService');

const DEFAULT_POSTER = 'src/img/poster.png';
const CDN_BASE = 'https://images.koalastore.digital';

function resolveBanner(setting) {
    if (modeService.isMultiMode() && !setting?.imageIntro) return null;
    if (setting?.imageIntro) return `${CDN_BASE}/${setting.imageIntro}`;
    return DEFAULT_POSTER;
}

async function resolveFromCtx(ctx) {
    const setting = await settingsService.getSettings(ctx).catch(() => null);
    return resolveBanner(setting);
}

async function sendWithBanner(ctx, text, bannerSource) {
    if (!bannerSource) return ctx.reply(text);
    try {
        return await ctx.sendImage(bannerSource, text);
    } catch (err) {
        console.log(clc.yellow('[ WARNING ]') + ` banner send fail: ${err.message}`);
        return ctx.reply(text);
    }
}

module.exports = { resolveBanner, resolveFromCtx, sendWithBanner };
