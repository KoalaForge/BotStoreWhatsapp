const moment = require('moment-timezone');

function buildGreeting(now = moment().tz('Asia/Jakarta')) {
    const h = now.hour();
    if (h >= 4 && h < 11)  return { text: 'Selamat Pagi', emoji: '🌅' };
    if (h >= 11 && h < 15) return { text: 'Selamat Siang', emoji: '☀️' };
    if (h >= 15 && h < 18) return { text: 'Selamat Sore', emoji: '🌇' };
    return { text: 'Selamat Malam', emoji: '🌙' };
}

module.exports = { buildGreeting };
