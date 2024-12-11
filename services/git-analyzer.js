import { query, CONFIG } from './ollama.js';

// Split diff into chunks by file
function splitDiffIntoFileChunks(diff) {
  const chunks = [];
  const lines = diff.split('\n');
  let currentChunk = '';
  let currentFile = '';

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (currentChunk) {
        chunks.push({ file: currentFile, content: currentChunk.trim() });
      }
      currentFile = line.split(' b/')[1];
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }

  if (currentChunk) {
    chunks.push({ file: currentFile, content: currentChunk.trim() });
  }

  return chunks;
}

// Group chunks that are less than 2K
function groupChunks(chunks) {
  const groups = [];
  let currentGroup = [];
  let currentSize = 0;
  const MAX_SIZE = 2000;

  for (const chunk of chunks) {
    const chunkSize = chunk.content.length;

    if (chunkSize > MAX_SIZE) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
        currentSize = 0;
      }
      groups.push([chunk]);
    } else if (currentSize + chunkSize > MAX_SIZE) {
      groups.push(currentGroup);
      currentGroup = [chunk];
      currentSize = chunkSize;
    } else {
      currentGroup.push(chunk);
      currentSize += chunkSize;
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

export async function analyzeGitDiff(diff, language = 'English') {
  try {
    const processedDiff = diff.trim();
    const chunks = splitDiffIntoFileChunks(processedDiff);
    const groups = groupChunks(chunks);

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
6.Must respond in ${language}.
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

export async function consolidateFeaturesList(features) {
  try {
    const validFeatures = features.filter(f => f && f.trim());

    if (validFeatures.length === 0) {
      return 'No features to consolidate';
    }

    const prompt = `You are a business analyst. You have features: 
${validFeatures.join('\n')}

Please consolidate these features following rules below:
1.Describe overall system structure and functionalities.
2.Describe features into a clear, concise list.
3.Update and combine the features with latest information.
4.Describe functionalities of each feature.
5.Do not offer further help or suggestions.
6.Must respond in ${CONFIG.language}.
7.Return features as a bullet list in markdown format, no bold or italic:

- [Feature]
  - [Functionality]
`;
    // Use 9K tokens for consolidation
    return (await query(prompt, 9216)).trim();
  } catch (error) {
    console.error('Failed to consolidate features:', error);
    throw error;
  }
}
