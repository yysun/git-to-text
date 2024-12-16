/**
 * Git diff analyzer that extracts feature descriptions using LLM
 * 
 * Implementation:
 * - Uses generator functions for memory-efficient streaming of large diffs
 * - Splits diffs into 2000-char chunks to stay within LLM context limits
 * - Processes diffs in parallel using Promise.all for better performance
 * - Implements hierarchical feature summarization with context management
 * - Supports document updating with new features while preserving structure
 * 
 * Data flow:
 * 1. Raw git diff -> File-based chunks -> Size-based groups
 * 2. Groups -> LLM analysis -> Feature descriptions
 * 3. Features -> Chunked summaries -> Global hierarchical summary
 * 4. Existing text + Features -> Updated documentation with preserved structure
 * 
 * Dependencies: ollama.js for LLM integration (query, chat)
 */

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

    let features = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const groupDiff = group.map(chunk => chunk.content).join('\n');

      const prompt = `You are a coding assistant. You are reviewing a git diff below:
${groupDiff}

Please describe changes as a list of features following these rules:
1. Describe features introduced by the changes in a way YOU can recreate it in the future. Not file changes.
2. Analyze implementation and parameter details without source code.
3. Do NOT review, fix, refactor. Do NOT include code examples.
4. Do NOT offer help, suggestions, explanations, or clarifications.
5. Respond in ${CONFIG.language}.
6. ONLY return a bullet list in markdown format, using this structure, e.g.:
  - [Feature description]
    - [Changes made and parameters details]
`;
      const result = await query(prompt, 2048);
      features.push(result.trim());
    }

    return features;
  } catch (error) {
    console.error('Failed to analyze git diff:', error);
    throw error;
  }
}

export async function summarizeFeatures(features) {
  try {
    const validFeatures = features.filter(f => f && f.trim());

    if (validFeatures.length === 0) {
      return 'No features to summarize';
    }

    const chunks = [...groupBySize(validFeatures, 4000)];

    const messages = [{
      role: "system",
      content: `You are a summarization assistant. Use will provide a large text in chunks. After each chunk, repeat the following process:
1. Describe the overall system structure and its capabilities.
2. Describe features into a list by page, module, service, functionality, and etc..
4. Describe capabilities of each feature as a sub list.
3. Keep updating features with information from each new chunk.
5. Use plain language and avoid code or technical details.
6. Do not offer additional help or suggestions.
7. Respond in ${CONFIG.language}.
8. Use markdown format with bullet points only (no bold or italics), e.g.:
  - [Feature description]
    - [Functionality description]`
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

export async function updateDoc(text, features) {
  try {
    const validFeatures = features.filter(f => f && f.trim());

    if (validFeatures.length === 0) {
      return text;
    }

    const chunks = [...groupBySize(validFeatures, 4000)];

    const messages = [{
      role: "system",
      content: `You are a documentation assistant. The User will provide an existing document and new features in chunks. After each chunk, repeat the following process:
1. Maintain the original document's structure, style, and organization.
2. Update the document by incorporating new content based on existing content.
3. Preserve the original markdown formatting.
4. Ensure consistent formatting and language throughout.
5. Do not remove or significantly alter existing content.
6. Do not add new sections unless absolutely necessary.
7. Respond in ${CONFIG.language}.
8. Do not offer additional help, suggestions, explanations, or clarifications.
`

    }];

    let updatedDoc = text;

    for (let i = 0; i < chunks.length; i++) {
      const promptContent = i === 0
        ? `Here is the original document:\n\n${text}\n\nAnd here are new features to incorporate:\n\n${chunks[i].join('\n')}\n\nPlease update the document while maintaining its structure.`
        : `Here are more features to incorporate:\n\n${chunks[i].join('\n')}\n\nPlease update the current version:\n\n${updatedDoc}`;

      messages.push({ role: "user", content: promptContent });

      const response = await chat(messages);
      updatedDoc = response;

      // Clean up messages to save context space - keep only system message
      messages.splice(1);
      messages.push({ role: "user", content: promptContent });
      messages.push({ role: "assistant", content: updatedDoc });
    }

    return updatedDoc.trim();
  } catch (error) {
    console.error('Failed to update document:', error);
    throw error;
  }
}
