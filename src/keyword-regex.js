let cachedKeywordRegex = null;
let cachedKeywordList = null;

export function getKeywordRegex(keywords) {
    if (!keywords) return null;
    if (!Array.isArray(keywords)) return null;

    const keywordsJson = JSON.stringify(keywords);

    if (cachedKeywordRegex && cachedKeywordList === keywordsJson) {
        return cachedKeywordRegex;
    }

    if (keywords.length === 0) {
        cachedKeywordRegex = null;
        cachedKeywordList = keywordsJson;
        return cachedKeywordRegex;
    }

    const pattern = keywords
        .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

    cachedKeywordRegex = new RegExp(`\\b(${pattern})\\b`, 'gi');
    cachedKeywordList = keywordsJson;
    return cachedKeywordRegex;
}

export function clearKeywordRegexCache() {
    cachedKeywordRegex = null;
    cachedKeywordList = null;
}
