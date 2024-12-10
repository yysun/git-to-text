// Configuration
export const CONFIG = {
  endpoint: 'http://localhost:11434/api/generate',
  model: 'llama3.2:3b',
  temperature: 0.3,
  retryAttempts: 3,
  retryDelay: 1000,
  maxTokens: 4096,
  language: 'English',
  streaming: true
};

// ANSI escape codes
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

class OllamaClient {
  constructor(config = CONFIG) {
    this.config = config;
  }

  // Core API method
  async query(prompt, maxTokens = this.config.maxTokens) {
    return this._retryWithDelay(async () => {
      try {
        const response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.model,
            prompt: this._sanitizePrompt(prompt),
            stream: this.config.streaming,
            temperature: this.config.temperature,
            max_tokens: maxTokens
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await this._processStream(response);
      } catch (error) {
        console.error('Error querying Ollama:', error);
        throw error;
      }
    });
  }

  // Stream handling
  async _processStream(response) {
    const reader = response.body.getReader();
    let fullText = '';
    let buffer = '';
    if (this.config.streaming) {
      process.stdout.write('\n');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        buffer += chunk;

        // Process complete JSON objects from buffer
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.response) {
                if (this.config.streaming) {
                  process.stdout.write(DIM + parsed.response + RESET);
                }
                fullText += parsed.response;
              }
            } catch (e) {
              // Log problematic chunk for debugging
              console.error('Error parsing JSON:', e.message);
              console.error('Problematic chunk:', line);
              
              // Try to recover by clearing buffer if it gets too large
              if (buffer.length > 10000) {
                console.error('Buffer overflow, clearing buffer');
                buffer = '';
              }
            }
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (parsed.response) {
            if (this.config.streaming) {
              process.stdout.write(DIM + parsed.response + RESET);
            }
            fullText += parsed.response;
          }
        } catch (e) {
          console.error('Error parsing final buffer:', e.message);
        }
      }
    } finally {
      reader.releaseLock();
    }
    
    if (this.config.streaming) {
      process.stdout.write('\n');
    }
    return fullText;
  }

  // Utility methods
  _sanitizePrompt(text) {
    if (!text) return '';
    
    const sanitized = text
      .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      .replace(/\\(?!["\\/bfnrt])/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');

    return sanitized.slice(0, 100000);
  }

  async _retryWithDelay(fn, retries = this.config.retryAttempts) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * (i + 1)));
      }
    }
  }

  // Git analysis methods
  async analyzeGitDiff(diff) {
    try {
      const processedDiff = diff.trim();
      const prompt = `You are a business analyst. You have a git diff, not a code sinppet:
${processedDiff}

Please describe features implemented in each change following rules below:
1. Describe features as if how you would implement it again in a list.
2. Describe implementation and parameters details in a sublist if any.
3. Do NOT review, fix, refactor or improve the code or implementation details. 
4. Do NOT include code snippets.
5. ONLY return a clear and concise bullet list.
6. Do NOT offer further help or provide any additional information or context.
7. Must respond in ${this.config.language}.

Here is a list of features implemented in each change:
`;

      return (await this.query(prompt)).trim();
    } catch (error) {
      console.error('Failed to analyze git diff:', error);
      throw error;
    }
  }

  async consolidateFeaturesList(features) {
    try {
      const validFeatures = features.filter(f => f && f.trim());
      
      if (validFeatures.length === 0) {
        return 'No features to consolidate';
      }
      
      const prompt = `You are a business analyst. You have features: 
${validFeatures.join('\n')}

Please consolidate these features following rules below:
1. First, Describe overall system structure and functionalities.
2. Then, Describe features and removing any redundant information.
3. Maintain the ascending chronological order of features.
4. List functionalities and remove implementation details.
5. ONLY return a clear and concise bullet list.
6. Do not offer further help or suggestions.
7. Must respond in ${this.config.language}.

Here is the consolidated list of features:
`;
      // Use 9K tokens for consolidation
      return (await this.query(prompt, 9216)).trim();
    } catch (error) {
      console.error('Failed to consolidate features:', error);
      throw error;
    }
  }

  setLanguage(language) {
    this.config.language = language;
  }

  toggleStreaming(enabled) {
    this.config.streaming = enabled;
    return enabled;
  }
}

// Create singleton instance
const ollamaClient = new OllamaClient();

// Export public methods
export const analyzeGitDiff = (diff) => ollamaClient.analyzeGitDiff(diff);
export const consolidateFeaturesList = (features) => ollamaClient.consolidateFeaturesList(features);
export const setLanguage = (language) => ollamaClient.setLanguage(language);
export const toggleStreaming = (enabled) => ollamaClient.toggleStreaming(enabled);
