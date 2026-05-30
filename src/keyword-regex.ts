let cachedKeywordRegex: RegExp | null = null;
let cachedKeywordList: string | null = null;

export function getKeywordRegex(keywords: string[] | null | undefined): RegExp | null {
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

export function clearKeywordRegexCache(): void {
    cachedKeywordRegex = null;
    cachedKeywordList = null;
}

export function normalizeKeywordMatch(
    match: RegExpExecArray,
    keywords?: string[] | Map<string, string> | null
): string | null {
    if (match[0].length < 3) return null;
    if (!/[a-zA-Z]/.test(match[0])) return null;
    const lower = match[0].toLowerCase();
    if (keywords) {
        if (keywords instanceof Map) return keywords.get(lower) || lower;
        return keywords.find(k => k.toLowerCase() === lower) || lower;
    }
    return lower;
}
