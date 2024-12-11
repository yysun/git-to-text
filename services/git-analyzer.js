import { query, CONFIG, chat } from './ollama.js';

// Generic chunk grouping function that supports streaming
function* groupBySize(items, maxSize, getSize = item => item.length) {
  let currentGroup = [];
  let currentSize = 0;

  for (const item of items) {
    const itemSize = getSize(item);

    // Handle items larger than maxSize individually
    if (itemSize > maxSize) {
      if (currentGroup.length > 0) {
        yield currentGroup;
        currentGroup = [];
        currentSize = 0;
      }
      yield [item];
      continue;
    }

    // Start new group if current would exceed maxSize
    if (currentSize + itemSize > maxSize) {
      yield currentGroup;
      currentGroup = [item];
      currentSize = itemSize;
    } else {
      currentGroup.push(item);
      currentSize += itemSize;
    }
  }

  // Yield remaining group
  if (currentGroup.length > 0) {
    yield currentGroup;
  }
}

// Split diff into chunks by file with streaming support
function* splitDiffIntoFileChunks(diff) {
  const lines = diff.split('\n');
  let currentChunk = '';
  let currentFile = '';

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (currentChunk) {
        yield { file: currentFile, content: currentChunk.trim() };
      }
      currentFile = line.split(' b/')[1];
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }

  if (currentChunk) {
    yield { file: currentFile, content: currentChunk.trim() };
  }
}

export async function analyzeGitDiff(diff) {
  try {
    const processedDiff = diff.trim();
    const chunks = [...splitDiffIntoFileChunks(processedDiff)];
    const groups = [...groupBySize(chunks, 2000, chunk => chunk.content.length)];

    let finalResult = '';
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const groupDiff = group.map(chunk => chunk.content).join('\n');

      const prompt = `You are a business analyst. You have a git diff:
${groupDiff}

Please analyze features implemented from the git diff according to rules below:
1.Describe features as if how you would implement. 
2.Describe implementation and analyze parameters details.
3.Do NOT review, fix, refactor or improve the code or implementation details. 
4.Do NOT include code snippets, suggestions or improvements.
5.Do NOT offer further help or provide any additional information or context.
6.Must respond in ${CONFIG.language}.
7.ONLY return a clear and concise bullet list in markdown format, no bold or italic:

- [Feature description]
  - [Changes made and parameters details]

`;
      const result = await query(prompt, 2048);
      if (finalResult) finalResult += '\n\n';
      finalResult += result.trim();
    }

    return finalResult;
  } catch (error) {
    console.error('Failed to analyze git diff:', error);
    throw error;
  }
}

export async function summarizeFeatures(features) {
  try {
    const allFeatures = features.join('\n').split('\n');
    const validFeatures = allFeatures.filter(f => f && f.trim());

    if (validFeatures.length === 0) {
      return 'No features to summarize';
    }

    const chunks = [...groupBySize(validFeatures, 4000)];

    const messages = [{
      role: "system",
      content: `You are a summarization assistant. I will provide a large text in chunks. After each chunk, update the global summary, ensuring it remains coherent and captures all key points introduced so far.`
    }];

    let globalSummary = "";

    for (let i = 0; i < chunks.length; i++) {
      const promptContent = i === 0
        ? `Here is the first part of the document:\n\n${chunks[i].join('\n')}\n\nPlease summarize this portion.`
        : `Here is another part of the document:\n\n${chunks[i].join('\n')}\n\nIncorporate this new information into the existing summary:\n\n${globalSummary}`;

      messages.push({ role: "user", content: promptContent });

      const response = await chat(messages);
      globalSummary = response;

      // Clean up messages to save context space - keep only system message
      messages.splice(1);
      messages.push({ role: "user", content: promptContent });
      messages.push({ role: "assistant", content: globalSummary });
    }

    return globalSummary.trim();
  } catch (error) {
    console.error('Failed to summarize features:', error);
    throw error;
  }
}
