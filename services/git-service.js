import { isSourceFile } from './project-analyzer.js';

export function filterSourceFiles(diff, projectType) {
  // Split diff into file sections
  const diffSections = diff.split('diff --git');
  
  // Filter out the empty first element
  const sections = diffSections.filter(Boolean);
  
  // Process each section
  const sourceDiffs = sections
    .map(section => section.trim())
    .filter(section => {
      // Extract file path from the diff section
      const filePathMatch = section.match(/a\/(.+?) b\//);
      if (!filePathMatch) return false;
      
      const filePath = filePathMatch[1];
      return isSourceFile(filePath, projectType);
    });
  
  // Reconstruct the filtered diff
  return sourceDiffs.length > 0
    ? 'diff --git ' + sourceDiffs.join('\ndiff --git ')
    : '';
}

export async function getCommitDiffs(git, projectType, onProgress) {
  const log = await git.log();
  // Sort commits by date ascending (oldest first)
  const commits = log.all.sort((a, b) => new Date(a.date) - new Date(b.date));
  const total = commits.length - 1;
  const diffs = [];
  
  for (let i = 0; i < total; i++) {
    const currentCommit = commits[i];
    const nextCommit = commits[i + 1];
    
    const diff = await git.diff([currentCommit.hash, nextCommit.hash]);
    // Filter diff to only include source files based on project type
    const sourceDiff = filterSourceFiles(diff, projectType);
    
    if (sourceDiff) {
      diffs.push({
        commitHash: currentCommit.hash,
        message: currentCommit.message,
        date: currentCommit.date,
        diff: sourceDiff
      });
    }

    // Call progress callback with current commit number
    if (onProgress) {
      onProgress(i + 1);
    }
  }
  
  return diffs;
}

export async function getTagDiffs(git, projectType, fromTag = null) {
  // Get all tags sorted by date
  const tags = await git.tags();
  const sortedTags = [];
  
  // Get creation date for each tag
  for (const tagName of tags.all) {
    const show = await git.show([tagName]);
    const date = show.match(/Date:\s+(.+)/)?.[1];
    sortedTags.push({ name: tagName, date: new Date(date) });
  }
  
  // Sort tags by date
  sortedTags.sort((a, b) => a.date - b.date);
  
  // Find starting index if fromTag is provided
  let startIndex = 0;
  if (fromTag) {
    startIndex = sortedTags.findIndex(tag => tag.name === fromTag);
    if (startIndex === -1) {
      throw new Error(`Tag '${fromTag}' not found`);
    }
  }
  
  // Get diffs between consecutive tags
  const diffs = [];
  for (let i = startIndex; i < sortedTags.length - 1; i++) {
    const currentTag = sortedTags[i];
    const nextTag = sortedTags[i + 1];
    
    const diff = await git.diff([currentTag.name, nextTag.name]);
    // Filter diff to only include source files based on project type
    const sourceDiff = filterSourceFiles(diff, projectType);
    
    if (sourceDiff) {
      diffs.push({
        fromTag: currentTag.name,
        toTag: nextTag.name,
        date: nextTag.date,
        diff: sourceDiff
      });
    }
  }
  
  return diffs;
}
