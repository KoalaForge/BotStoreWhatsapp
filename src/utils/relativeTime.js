/**
 * Convert a Date / timestamp into Indonesian relative-time string.
 * Returns null when input is missing (caller decides whether to render).
 *
 * Examples:
 *   < 1 min  → "baru saja"
 *   < 1 hr   → "5 menit lalu"
 *   < 1 day  → "3 jam lalu"
 *   < 1 wk   → "2 hari lalu"
 *   < 1 mth  → "3 minggu lalu"
 *   < 1 yr   → "5 bulan lalu"
 *   else     → "2 tahun lalu"
 */
function humanizeRelativeID(date) {
    if (!date) return null;
    const then = new Date(date).getTime();
    if (!Number.isFinite(then)) return null;
    const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));

    if (diffSec < 60) return 'baru saja';
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} menit lalu`;
    const jam = Math.floor(min / 60);
    if (jam < 24) return `${jam} jam lalu`;
    const hari = Math.floor(jam / 24);
    if (hari < 7) return `${hari} hari lalu`;
    if (hari < 30) return `${Math.floor(hari / 7)} minggu lalu`;
    if (hari < 365) return `${Math.floor(hari / 30)} bulan lalu`;
    return `${Math.floor(hari / 365)} tahun lalu`;
}

module.exports = { humanizeRelativeID };
