const DEFAULT_DEFINITION_PROMPT = "You are a helpful English learning assistant. Explain the meaning of words clearly and provide examples.";
const DEFAULT_TRANSLATION_PROMPT = "Translate the following sentence into Chinese accurately and naturally: {sentence}";

/** Keep the learning task separate from Qiaomu's book-chat history and credentials. */
export function englishLearningAiRequest(kind, text, prompt) {
  const input = String(text || "").trim();
  if (!input || input.length > 4000) throw new Error("English learning AI input is empty or too long");
  if (kind === "definition") {
    return {
      systemPrompt: String(prompt || "").trim() || DEFAULT_DEFINITION_PROMPT,
      userPrompt: input,
    };
  }
  if (kind === "translation") {
    const template = String(prompt || "").trim() || DEFAULT_TRANSLATION_PROMPT;
    return {
      systemPrompt: "Translate the supplied sentence accurately. Follow the requested target language and return only the translation.",
      userPrompt: template.includes("{sentence}")
        ? template.replace("{sentence}", input)
        : `${template}\n\n${input}`,
    };
  }
  throw new Error("Unknown English learning AI task");
}
