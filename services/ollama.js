// Configuration
export const CONFIG = {
  endpoint: 'http://localhost:11434/api/generate',
  model: 'llama3.2:3b',
  temperature: 0.3,
  retryAttempts: 3,
  retryDelay: 1000,
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
            temperature: this.config.temperature
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
    process.stdout.write('\n');

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) {
              process.stdout.write(DIM + parsed.response + RESET);
              fullText += parsed.response;
            }
          } catch (e) {
            console.error('Error parsing stream chunk:', e);
          }
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
      const prompt = `Analyze this git diff and list the changes made: 

      ${processedDiff}

      - Describe the features implemented into a bullet list.
      - Use sublist for parameters details if any, but no code details.
      - Only return a bullet list. 
      - Do not offer explanations or further help.`;


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
      
      const prompt = `Consolidate these features into a clear, non-redundant features list: 
      
      ${validFeatures.join('\n')}

      - Maintain the order of features as they appear in the list. 
      - Later features to same objects should override earlier changes.
      - Use bullet points for each feature, keep implementation and parameters details.          
      - Use sublist for details if needed.
      - Return ONLY the list. 
      - Do not offer further help or suggestions.

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
