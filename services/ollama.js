/**
 * Ollama API client with streaming support and error handling
 * 
 * Implementation:
 * - Uses fetch API with streaming response processing
 * - Implements retry logic with exponential backoff
 * - Handles partial JSON chunks in stream with buffer
 * - Supports both chat and completion endpoints
 * - Uses ANSI codes for console output formatting
 * 
 * Data flow:
 * 1. Request -> Streaming response -> Buffer -> JSON chunks
 * 2. JSON chunks -> Console output + Text accumulation
 * 3. Final text -> Response cleanup -> Return
 * 
 * Key params:
 * - model: llama3.2:3b
 * - max_tokens: 4096
 * - num_ctx: 131072 (context window)
 * - temperature: 0.3
 */

// Configuration
export const CONFIG = {
  endpoint: 'http://localhost:11434/',
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
        const response = await fetch(this.config.endpoint + 'api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.model,
            prompt: this._sanitizePrompt(prompt),
            stream: this.config.streaming,
            temperature: this.config.temperature,
            max_tokens: maxTokens,
            num_ctx: 131072
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await this._processStream(response, false);
      } catch (error) {
        console.error('Error querying Ollama:', error);
        throw error;
      }
    });
  }

  async chat(messages, maxTokens = this.config.maxTokens) {
    return this._retryWithDelay(async () => {
      try {
        const response = await fetch(this.config.endpoint + 'api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.model,
            messages,
            stream: this.config.streaming,
            temperature: this.config.temperature,
            max_tokens: maxTokens
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await this._processStream(response, true);
      } catch (error) {
        console.error('Error in chat with Ollama:', error);
        throw error;
      }
    });
  }

  // Stream handling
  async _processStream(response, isChat = false) {
    const reader = response.body.getReader();
    let fullText = '';

    if (this.config.streaming) {
      process.stdout.write('\n');
    }

    try {
      let decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex === -1) break;

          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line);
            fullText = isChat ? 
              this._processChatStream(parsed, fullText) : 
              this._processQueryStream(parsed, fullText);
          } catch (e) {
            // Silently ignore parsing errors
          }
        }
      }

      // Handle any remaining buffer content
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          fullText = isChat ? 
            this._processChatStream(parsed, fullText) : 
            this._processQueryStream(parsed, fullText);
        } catch (e) {
          // Silently ignore parsing errors
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

  _processChatStream(parsed, currentText) {
    const content = parsed.message?.content || '';
    if (content && !parsed.done) {
      if (this.config.streaming) {
        process.stdout.write(DIM + content + RESET);
      }
      return currentText + content; // Now accumulating chat responses
    }
    return currentText;
  }

  _processQueryStream(parsed, currentText) {
    const content = parsed.response || '';
    if (content) {
      if (this.config.streaming) {
        process.stdout.write(DIM + content + RESET);
      }
      return currentText + content; // Query concatenates responses
    }
    return currentText;
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
export const query = (prompt, maxTokens) => ollamaClient.query(prompt, maxTokens);
export const setLanguage = (language) => ollamaClient.setLanguage(language);
export const toggleStreaming = (enabled) => ollamaClient.toggleStreaming(enabled);
export const chat = (messages, maxTokens) => ollamaClient.chat(messages, maxTokens);
