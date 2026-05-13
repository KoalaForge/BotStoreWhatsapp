const clc = require('cli-color');
const moment = require('moment-timezone');
const settingsService = require('../../services/settingsService');

/**
 * Build a full URL for display
 * @param {string} link - CS link (@username or any URL)
 * @returns {string} Full URL with protocol
 */
function buildUrl(link) {
    if (link.startsWith('@')) {
        return `https://t.me/${link.slice(1)}`;
    }
    if (/^https?:\/\//i.test(link)) {
        return link;
    }
    return `https://${link}`;
}

/**
 * Build CS content (message text) from normalized csLinks.
 * @param {Array} rawCsLinks - Raw csLinks array from settings
 * @returns {{ message: string }|null} null if no links
 */
function buildCSContent(rawCsLinks) {
    const csLinks = settingsService.normalizeCSLinks(rawCsLinks || []);
    if (csLinks.length === 0) return null;

    let message = `*Customer Service*\n\nHubungi CS kami:\n\n`;

    csLinks.forEach((cs, i) => {
        const url = buildUrl(cs.link);
        message += `${i + 1}. *${cs.label}*\n   ${url}\n\n`;
    });

    message += `_Klik link di atas untuk menghubungi CS._`;

    return { message };
}

const csCommand = async (ctx) => {
    try {
        const settings = await settingsService.getSettings(ctx);
        const content = buildCSContent(settings?.csLinks);

        if (!content) {
            return ctx.reply(
                `*Customer Service*\n\n_Belum ada kontak CS yang tersedia.\nSilakan hubungi admin._`
            );
        }

        return ctx.reply(content.message);

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold("[ ERROR ]") +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`Error in command/publicCommand/cs.js: ${err.message}`)
        );
    }
};

module.exports = csCommand;
module.exports.buildCSContent = buildCSContent;
