// Chrome Storage Layer for Tweet Bookmarks
// Uses chrome.storage.local which is shared across all extension contexts

const STORAGE_KEY = 'tweet_bookmarks';

// Get all bookmarks from storage
async function getAllBookmarks() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const bookmarks = result[STORAGE_KEY] || [];
      // Sort by savedAt descending (newest first)
      bookmarks.sort((a, b) => b.savedAt - a.savedAt);
      resolve(bookmarks);
    });
  });
}

// Save all bookmarks to storage
async function saveAllBookmarks(bookmarks) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: bookmarks }, resolve);
  });
}

// Save a single bookmark (add or update)
async function saveBookmark(bookmark) {
  const bookmarks = await getAllBookmarks();
  const existingIndex = bookmarks.findIndex(b => b.id === bookmark.id);

  if (existingIndex >= 0) {
    bookmarks[existingIndex] = bookmark;
  } else {
    bookmarks.push(bookmark);
  }

  await saveAllBookmarks(bookmarks);
  return bookmark;
}

// Get a single bookmark by ID
async function getBookmark(id) {
  const bookmarks = await getAllBookmarks();
  return bookmarks.find(b => b.id === id);
}

// Search bookmarks by content or author
async function searchBookmarks(query) {
  const bookmarks = await getAllBookmarks();
  const lowerQuery = query.toLowerCase();

  return bookmarks.filter(bookmark =>
    bookmark.content.toLowerCase().includes(lowerQuery) ||
    bookmark.author.toLowerCase().includes(lowerQuery) ||
    (bookmark.authorName && bookmark.authorName.toLowerCase().includes(lowerQuery)) ||
    bookmark.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}

// Filter bookmarks by tag
async function filterByTag(tag) {
  const bookmarks = await getAllBookmarks();
  return bookmarks.filter(bookmark =>
    bookmark.tags.some(t => t.toLowerCase() === tag.toLowerCase())
  );
}

// Delete a bookmark
async function deleteBookmark(id) {
  const bookmarks = await getAllBookmarks();
  const filtered = bookmarks.filter(b => b.id !== id);
  await saveAllBookmarks(filtered);
  return true;
}

// Get bookmark count
async function getBookmarkCount() {
  const bookmarks = await getAllBookmarks();
  return bookmarks.length;
}

// Get all unique tags
async function getAllTags() {
  const bookmarks = await getAllBookmarks();
  const tagSet = new Set();

  bookmarks.forEach(bookmark => {
    bookmark.tags.forEach(tag => tagSet.add(tag));
  });

  return Array.from(tagSet).sort();
}

// Export all bookmarks as JSON
async function exportBookmarks() {
  const bookmarks = await getAllBookmarks();
  return JSON.stringify(bookmarks, null, 2);
}

// Import bookmarks from JSON
async function importBookmarks(jsonString) {
  const newBookmarks = JSON.parse(jsonString);
  const existingBookmarks = await getAllBookmarks();

  // Merge: update existing, add new
  const bookmarkMap = new Map();
  existingBookmarks.forEach(b => bookmarkMap.set(b.id, b));
  newBookmarks.forEach(b => bookmarkMap.set(b.id, b));

  const mergedBookmarks = Array.from(bookmarkMap.values());
  await saveAllBookmarks(mergedBookmarks);

  return newBookmarks.length;
}

// Check if bookmark exists
async function bookmarkExists(id) {
  const bookmark = await getBookmark(id);
  return bookmark !== undefined;
}

// Initialize (no-op for chrome.storage, but kept for compatibility)
async function initDB() {
  return Promise.resolve();
}
