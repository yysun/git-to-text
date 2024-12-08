// Ollama service configuration
export const CONFIG = {
  endpoint: 'http://localhost:11434/api/generate',
  model: 'llama3.2:3b',
  retryAttempts: 3,
  retryDelay: 1000,
};

function sanitizePrompt(text) {
  if (!text) return '';
  
  // Remove any potential JSON-breaking characters
  const sanitized = text
    .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '') // Remove control characters
    .replace(/\\(?!["\\/bfnrt])/g, '\\\\') // Escape backslashes
    .replace(/"/g, '\\"') // Escape quotes
    .replace(/\n/g, '\\n') // Escape newlines
    .replace(/\r/g, '\\r') // Escape carriage returns
    .replace(/\t/g, '\\t'); // Escape tabs

  // Limit length to prevent oversized requests
  return sanitized.slice(0, 100000); // Limit to 100k chars
}

async function retryWithDelay(fn, retries = CONFIG.retryAttempts) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay * (i + 1)));
    }
  }
}

async function processStream(response) {
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
            process.stdout.write(parsed.response);
            fullText += parsed.response;
          }
        } catch (e) {
          console.error('Error parsing JSON:', e);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  process.stdout.write('\n');
  return fullText;
}

async function queryOllama(prompt) {
  return retryWithDelay(async () => {
    try {
      const response = await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: CONFIG.model,
          prompt: sanitizePrompt(prompt),
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await processStream(response);
    } catch (error) {
      console.error('Error querying Ollama:', error);
      throw error;
    }
  });
}

export async function analyzeDiff(diff) {
  const prompt = `Analyze this git diff and list the main features or changes implemented. Only return the key points as a bullet list:\n\n${diff}`;
  return queryOllama(prompt);
}

export async function consolidateFeatures(features) {
  const prompt = `Consolidate these features into a clear, non-redundant list of main features implemented:\n\n${features.join('\n')}`;
  return queryOllama(prompt);
}

export async function analyzeGitDiff(diff) {
  try {
    // Pre-process diff if needed
    const processedDiff = diff.trim();
    
    // Get analysis from Ollama
    const analysis = await analyzeDiff(processedDiff);
    
    // Post-process analysis if needed
    return analysis.trim();
  } catch (error) {
    console.error('Failed to analyze git diff:', error);
    throw error;
  }
}

export async function consolidateFeaturesList(features) {
  try {
    // Pre-process features if needed
    const validFeatures = features.filter(f => f && f.trim());
    
    if (validFeatures.length === 0) {
      return 'No features to consolidate';
    }
    
    // Get consolidated features from Ollama
    const consolidated = await consolidateFeatures(validFeatures);
    
    // Post-process consolidated features if needed
    return consolidated.trim();
  } catch (error) {
    console.error('Failed to consolidate features:', error);
    throw error;
  }
}
