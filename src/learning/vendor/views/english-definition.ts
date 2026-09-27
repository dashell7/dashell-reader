type DefinitionRequest = (options: { url: string }) => Promise<{ json: any }>;

export async function fetchEnglishDefinitions(word: string, request: DefinitionRequest): Promise<string[]> {
    const encoded = encodeURIComponent(word);
    try {
        const response = await request({ url: `https://api.datamuse.com/words?sp=${encoded}&md=d&max=3` });
        const entry = Array.isArray(response.json)
            ? response.json.find((item: any) => item.word?.toLowerCase() === word.toLowerCase())
            : null;
        const definitions = (entry?.defs || []).filter((item: unknown) => typeof item === 'string')
            .map((item: string) => {
                const [part, ...description] = item.split('\t');
                const meaning = description.join('\t').trim();
                return meaning && meaning.toLowerCase() !== word.toLowerCase()
                    ? `${part}. ${meaning}` : '';
            }).filter(Boolean);
        if (definitions.length) return definitions.slice(0, 3);
    } catch { /* Try the second dictionary service. */ }

    try {
        const response = await request({ url: `https://api.dictionaryapi.dev/api/v2/entries/en/${encoded}` });
        const entries = Array.isArray(response.json) ? response.json : [];
        return entries.flatMap((entry: any) => (entry.meanings || [])
            .flatMap((meaning: any) => (meaning.definitions || []).map((item: any) => item.definition)))
            .filter((definition: unknown) => typeof definition === 'string'
                && !!definition.trim() && definition.trim().toLowerCase() !== word.toLowerCase())
            .slice(0, 3);
    } catch {
        return [];
    }
}
