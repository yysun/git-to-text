// Configuration
export const CONFIG = {
  endpoint: 'http://localhost:11434/api/generate',
  model: 'llama3.2:3b',
  temperature: 0.3,
  retryAttempts: 3,
  retryDelay: 1000,
  maxTokens: 8192,  // Added maxTokens config
};

// ANSI escape codes
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

class OllamaClient {
  constructor(config = CONFIG) {
    this.config = config;
  }

  // Core API method
  async query(prompt) {
    return this._retryWithDelay(async () => {
      try {
        const response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.model,
            prompt: this._sanitizePrompt(prompt),
            stream: true,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens  // Added maxTokens to request
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
    process.stdout.write('\n');

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
                process.stdout.write(DIM + parsed.response + RESET);
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
            process.stdout.write(DIM + parsed.response + RESET);
            fullText += parsed.response;
          }
        } catch (e) {
          console.error('Error parsing final buffer:', e.message);
        }
      }
    } finally {
      reader.releaseLock();
    }
    
    process.stdout.write('\n');
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
      const prompt = `You are a business analyst. You have a git diff:

${processedDiff}

Analyze the git diff changes using rules:
* Describe the features implemented into a bullet list.
* Use sublist for parameters details if any.
* Do NOT include code snippets.
* Retain project structure changes as separate features.
* Do NOT review, fix, refactor or improve the code or implementation details. 
* Only return a bullet list. 
* Do NOT offer further help or provide any additional information or context.
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
      
      const prompt = `You are a business analyst. You have a features change history: 

${validFeatures.join('\n')}

Consolidate these features into a bullet list using rules:
* Maintain the order of features as they appear in the list.
* Retaining all features and details as much as possible.
* Later feature updates can merge into or replace with earlier ones if needed.
* Return ONLY a bullet list. No explanations.
* Do not offer further help or suggestions.
      `;
      return (await this.query(prompt)).trim();
    } catch (error) {
      console.error('Failed to consolidate features:', error);
      throw error;
    }
  }
}

// Create singleton instance
const ollamaClient = new OllamaClient();

// Export public methods
export const analyzeGitDiff = (diff) => ollamaClient.analyzeGitDiff(diff);
export const consolidateFeaturesList = (features) => ollamaClient.consolidateFeaturesList(features);
