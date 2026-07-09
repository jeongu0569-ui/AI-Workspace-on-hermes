export class LLMRuntime {
  constructor({ chatRuntime }) {
    this.chatRuntime = chatRuntime;
  }

  async generateCodePatch(params) {
    const prompt = `Generate a code patch based on the following instruction:
Instruction: ${params.instruction}
Files:
${(params.files || []).map(f => `--- File: ${f.path} ---\n${f.content}`).join("\n\n")}

Respond ONLY with valid proposed patch changes as JSON. Example:
[{"path": "lib/foo.mjs", "action": "modify", "targetContent": "...", "replacementContent": "..."}]`;

    const res = await this.chatRuntime.submitPrompt({
      prompt,
      model: params.model,
      provider: params.provider
    });

    if (!res.ok) {
      throw new Error("Failed to generate patch from chat backend.");
    }

    const reply = res.reply || "";
    try {
      const jsonStart = reply.indexOf("[");
      const jsonEnd = reply.lastIndexOf("]") + 1;
      if (jsonStart !== -1 && jsonEnd !== -1) {
        return JSON.parse(reply.slice(jsonStart, jsonEnd));
      }
      return JSON.parse(reply);
    } catch {
      throw new Error(`Invalid JSON format returned by LLM: ${reply}`);
    }
  }
}
