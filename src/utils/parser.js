const {containsURL, extractURLs} = require("./url");

/**
 * Clean problematic control characters that cause UTF-8 errors
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
 */
function cleanControlChars(text) {
    if (!text || typeof text !== 'string') return text;
    // Remove control characters (except \n, \r, \t)
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function parseOrderData(data) {
    // Clean control characters first
    data = cleanControlChars(data);
    function containsComma(teks) {
        const totalCommas = (teks.match(/,/g) || []).length;
        return totalCommas > 0;
    }

    data = containsURL(data)
        ? extractURLs(data)
        : data

    if(containsComma(data)) {
        const splitData = data.split("\n").filter(data => data.length > 0);
        let boundedOfData = '';
        let index = 1;

        for (let individualData of splitData) {
            boundedOfData += `${index !== 1 ? '\n' : ''}`
            boundedOfData += `${splitData.length > 1 ? `<b>Data ${index}</b>\n` : ''}`
            boundedOfData += `${individualData.replaceAll(',', '\n')}\n`

            index++
        }

        return boundedOfData
    }

    return data;
}

module.exports = {
    parseOrderData,
}