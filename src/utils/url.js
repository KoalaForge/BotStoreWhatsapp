function containsURL(text) {
    if (!text) {
        return false; // Handle empty or null input
    }

    const urlRegex = /https?:\/\/\S+/gi;

    return urlRegex.test(text);
}

function extractURLs(text) {
    if (!text) {
        return ""; // Returns an empty string to handle null or undefined input
    }
    // const urlRegex = /https?:\/\/\S+/gi;
    const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/gi;
    return text.replace(urlRegex, (url) => url);
}

module.exports = {
    containsURL,
    extractURLs,
}