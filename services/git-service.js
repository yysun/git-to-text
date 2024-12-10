import { isSourceFile } from './project-analyzer.js';

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

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

export async function getCommitDiffs(git, projectType, groupSize = 1, onProgress = null) {
  const commits = await git.log();
  const diffs = [];
  const commitList = commits.all.reverse(); // Oldest to newest

  if (commitList.length === 0) {
    return diffs;
  }

  let progressCount = 0;

  if (groupSize === 1) {
    // For n=1: Compare commit index 0 with empty tree, then 1 with 0, 2 with 1, etc.
    // Start with commit index 0 vs empty tree
    const firstCommit = commitList[0];
    try {
      const firstDiff = await git.diff([EMPTY_TREE_HASH, firstCommit.hash]);
      if (firstDiff) {
        const filteredDiff = filterSourceFiles(firstDiff, projectType);
        if (filteredDiff) {
          diffs.push({
            fromCommit: { hash: EMPTY_TREE_HASH, message: 'Empty tree' },
            toCommit: firstCommit,
            diff: filteredDiff,
            message: firstCommit.message
          });
        }
      }
      
      if (onProgress) {
        progressCount++;
        onProgress(progressCount);
      }
    } catch (error) {
      console.error(`Error getting diff for first commit ${firstCommit.hash}: ${error.message}`);
    }

    // Compare each subsequent commit with its previous
    for (let i = 1; i < commitList.length; i++) {
      const currentCommit = commitList[i];
      const previousCommit = commitList[i - 1];
      
      try {
        const diff = await git.diff([previousCommit.hash, currentCommit.hash]);
        if (diff) {
          const filteredDiff = filterSourceFiles(diff, projectType);
          if (filteredDiff) {
            diffs.push({
              fromCommit: previousCommit,
              toCommit: currentCommit,
              diff: filteredDiff,
              message: currentCommit.message
            });
          }
        }
        
        if (onProgress) {
          progressCount++;
          onProgress(progressCount);
        }
      } catch (error) {
        console.error(`Error getting diff between commits ${previousCommit.hash} and ${currentCommit.hash}: ${error.message}`);
      }
    }
  } else {
    // For n>1:
    // For n=2: Start with index 2, compare with empty tree, then 4 with 2, 6 with 4, etc.
    // For n=3: Start with index 3, compare with empty tree, then 6 with 3, 9 with 6, etc.
    
    // Get the first comparison (nth commit vs empty tree)
    const startIndex = groupSize;
    if (startIndex < commitList.length) {
      const firstNthCommit = commitList[startIndex];
      try {
        const firstDiff = await git.diff([EMPTY_TREE_HASH, firstNthCommit.hash]);
        if (firstDiff) {
          const filteredDiff = filterSourceFiles(firstDiff, projectType);
          if (filteredDiff) {
            diffs.push({
              fromCommit: { hash: EMPTY_TREE_HASH, message: 'Empty tree' },
              toCommit: firstNthCommit,
              diff: filteredDiff,
              message: firstNthCommit.message
            });
          }
        }
        
        if (onProgress) {
          progressCount++;
          onProgress(progressCount);
        }
      } catch (error) {
        console.error(`Error getting diff for nth commit ${firstNthCommit.hash}: ${error.message}`);
      }

      // Process remaining commits based on group size
      // For n=2: Compare index 4 with 2, 6 with 4, etc.
      // For n=3: Compare index 6 with 3, 9 with 6, etc.
      for (let i = startIndex + groupSize; i < commitList.length; i += groupSize) {
        const currentCommit = commitList[i];
        const previousNthCommit = commitList[i - groupSize];
        
        try {
          const diff = await git.diff([previousNthCommit.hash, currentCommit.hash]);
          if (diff) {
            const filteredDiff = filterSourceFiles(diff, projectType);
            if (filteredDiff) {
              diffs.push({
                fromCommit: previousNthCommit,
                toCommit: currentCommit,
                diff: filteredDiff,
                message: currentCommit.message
              });
            }
          }
          
          if (onProgress) {
            progressCount++;
            onProgress(progressCount);
          }
        } catch (error) {
          console.error(`Error getting diff between commits ${previousNthCommit.hash} and ${currentCommit.hash}: ${error.message}`);
        }
      }
    }
  }
  
  return diffs;
}

export async function getTagDiffs(git, projectType, fromTag = null) {
  // Get all tags sorted by date
  const tags = await git.tags();
  const sortedTags = [];
  
  // If no tags and no fromTag specified, return diff from empty tree to HEAD
  if (tags.all.length === 0 && !fromTag) {
    const headDiff = await git.diff([EMPTY_TREE_HASH, 'HEAD']);
    const sourceHeadDiff = filterSourceFiles(headDiff, projectType);
    
    if (sourceHeadDiff) {
      return [{
        fromTag: 'empty-tree',
        toTag: 'HEAD',
        date: new Date(),
        diff: sourceHeadDiff
      }];
    }
    return [];
  }
  
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

  // If no fromTag provided, start with empty tree hash to first tag
  if (!fromTag && sortedTags.length > 0) {
    const firstTag = sortedTags[0];
    const firstDiff = await git.diff([EMPTY_TREE_HASH, firstTag.name]);
    const sourceDiff = filterSourceFiles(firstDiff, projectType);
    
    if (sourceDiff) {
      diffs.push({
        fromTag: 'empty-tree',
        toTag: firstTag.name,
        date: firstTag.date,
        diff: sourceDiff
      });
    }
  }
  
  // Get diffs between consecutive tags
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

  // Add diff between last tag and HEAD if there are any tags
  if (sortedTags.length > 0) {
    const lastTag = sortedTags[sortedTags.length - 1];
    const headDiff = await git.diff([lastTag.name, 'HEAD']);
    const sourceHeadDiff = filterSourceFiles(headDiff, projectType);
    
    if (sourceHeadDiff) {
      diffs.push({
        fromTag: lastTag.name,
        toTag: 'HEAD',
        date: new Date(),
        diff: sourceHeadDiff
      });
    }
  }
  
  return diffs;
}
