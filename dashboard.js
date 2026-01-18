// Tweet Bookmarks Dashboard - JavaScript

let allBookmarks = [];
let filteredBookmarks = [];
let currentFilter = null;
let currentSearch = '';
let editingBookmarkId = null;
let deletingBookmarkId = null;

// DOM Elements
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const tagListEl = document.getElementById('tag-list');
const clearFilterBtn = document.getElementById('clear-filter');
const totalCountEl = document.getElementById('total-count');
const bookmarksContainer = document.getElementById('bookmarks-container');
const emptyState = document.getElementById('empty-state');
const noResults = document.getElementById('no-results');
const exportBtn = document.getElementById('export-btn');
const importInput = document.getElementById('import-input');

// Edit Modal
const editModal = document.getElementById('edit-modal');
const editModalClose = document.getElementById('edit-modal-close');
const editTagsInput = document.getElementById('edit-tags');
const editCancel = document.getElementById('edit-cancel');
const editSave = document.getElementById('edit-save');

// Delete Modal
const deleteModal = document.getElementById('delete-modal');
const deleteModalClose = document.getElementById('delete-modal-close');
const deleteCancel = document.getElementById('delete-cancel');
const deleteConfirm = document.getElementById('delete-confirm');

// Initialize
async function init() {
    await loadBookmarks();
    setupEventListeners();
}

// Load all bookmarks
async function loadBookmarks() {
    try {
        allBookmarks = await getAllBookmarks();
        filteredBookmarks = [...allBookmarks];
        renderBookmarks();
        renderTags();
        updateStats();
    } catch (error) {
        console.error('Error loading bookmarks:', error);
        showToast('Error loading bookmarks', 'error');
    }
}

// Render bookmarks
function renderBookmarks() {
    bookmarksContainer.innerHTML = '';

    if (allBookmarks.length === 0) {
        emptyState.style.display = 'flex';
        noResults.style.display = 'none';
        bookmarksContainer.style.display = 'none';
        return;
    }

    if (filteredBookmarks.length === 0) {
        emptyState.style.display = 'none';
        noResults.style.display = 'flex';
        bookmarksContainer.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    noResults.style.display = 'none';
    bookmarksContainer.style.display = 'grid';

    filteredBookmarks.forEach(bookmark => {
        const card = createBookmarkCard(bookmark);
        bookmarksContainer.appendChild(card);
    });
}

// Create bookmark card
function createBookmarkCard(bookmark) {
    const card = document.createElement('div');
    card.className = 'bookmark-card';
    card.dataset.id = bookmark.id;

    const savedDate = new Date(bookmark.savedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });

    const tagsHtml = bookmark.tags.length > 0
        ? bookmark.tags.map(tag => `<span class="bookmark-tag">${escapeHtml(tag)}</span>`).join('')
        : '';

    card.innerHTML = `
    <div class="bookmark-header">
      <div class="bookmark-author">
        <span class="bookmark-author-name">${escapeHtml(bookmark.authorName || 'Unknown')}</span>
        <span class="bookmark-author-handle">${escapeHtml(bookmark.author || '')}</span>
      </div>
      <div class="bookmark-actions">
        <button class="btn-icon" title="Edit" data-action="edit">✏️</button>
        <button class="btn-icon" title="Delete" data-action="delete">🗑️</button>
      </div>
    </div>
    <div class="bookmark-content">${escapeHtml(bookmark.content || 'No content')}</div>
    ${tagsHtml ? `<div class="bookmark-tags">${tagsHtml}</div>` : ''}
    <div class="bookmark-footer">
      <span class="bookmark-date">Saved ${savedDate}</span>
      <a href="${escapeHtml(bookmark.url)}" target="_blank" class="bookmark-link">View on X →</a>
    </div>
  `;

    // Event listeners for actions
    card.querySelector('[data-action="edit"]').addEventListener('click', () => openEditModal(bookmark));
    card.querySelector('[data-action="delete"]').addEventListener('click', () => openDeleteModal(bookmark.id));

    return card;
}

// Render tags in sidebar
function renderTags() {
    const tags = getAllTagsFromBookmarks();
    tagListEl.innerHTML = '';

    if (tags.length === 0) {
        tagListEl.innerHTML = '<p style="color: var(--text-secondary); font-size: 13px;">No tags yet</p>';
        return;
    }

    tags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip' + (currentFilter === tag ? ' active' : '');
        chip.textContent = tag;
        chip.addEventListener('click', () => filterByTag(tag));
        tagListEl.appendChild(chip);
    });
}

// Get all unique tags from bookmarks
function getAllTagsFromBookmarks() {
    const tagSet = new Set();
    allBookmarks.forEach(bookmark => {
        bookmark.tags.forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
}

// Update stats
function updateStats() {
    totalCountEl.textContent = allBookmarks.length;
}

// Search bookmarks
function searchBookmarksLocal(query) {
    currentSearch = query.toLowerCase();
    applyFilters();
}

// Filter by tag
function filterByTag(tag) {
    if (currentFilter === tag) {
        currentFilter = null;
        clearFilterBtn.style.display = 'none';
    } else {
        currentFilter = tag;
        clearFilterBtn.style.display = 'block';
    }
    renderTags();
    applyFilters();
}

// Apply all filters
function applyFilters() {
    filteredBookmarks = allBookmarks.filter(bookmark => {
        const matchesSearch = currentSearch === '' ||
            bookmark.content.toLowerCase().includes(currentSearch) ||
            bookmark.author.toLowerCase().includes(currentSearch) ||
            bookmark.authorName.toLowerCase().includes(currentSearch) ||
            bookmark.tags.some(tag => tag.toLowerCase().includes(currentSearch));

        const matchesTag = currentFilter === null ||
            bookmark.tags.some(tag => tag.toLowerCase() === currentFilter.toLowerCase());

        return matchesSearch && matchesTag;
    });

    renderBookmarks();
}

// Clear filters
function clearFilters() {
    currentFilter = null;
    currentSearch = '';
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    clearFilterBtn.style.display = 'none';
    filteredBookmarks = [...allBookmarks];
    renderTags();
    renderBookmarks();
}

// Open edit modal
function openEditModal(bookmark) {
    editingBookmarkId = bookmark.id;
    editTagsInput.value = bookmark.tags.join(', ');
    editModal.style.display = 'flex';
    setTimeout(() => editTagsInput.focus(), 100);
}

// Close edit modal
function closeEditModal() {
    editModal.style.display = 'none';
    editingBookmarkId = null;
    editTagsInput.value = '';
}

// Save edit
async function saveEdit() {
    if (!editingBookmarkId) return;

    const bookmark = allBookmarks.find(b => b.id === editingBookmarkId);
    if (!bookmark) return;

    const tagsValue = editTagsInput.value.trim();
    const newTags = tagsValue
        ? tagsValue.split(',').map(t => t.trim()).filter(t => t.length > 0)
        : [];

    bookmark.tags = newTags;

    try {
        await saveBookmark(bookmark);
        closeEditModal();
        await loadBookmarks();
        showToast('Bookmark updated!');
    } catch (error) {
        console.error('Error updating bookmark:', error);
        showToast('Error updating bookmark', 'error');
    }
}

// Open delete modal
function openDeleteModal(id) {
    deletingBookmarkId = id;
    deleteModal.style.display = 'flex';
}

// Close delete modal
function closeDeleteModal() {
    deleteModal.style.display = 'none';
    deletingBookmarkId = null;
}

// Confirm delete
async function confirmDelete() {
    if (!deletingBookmarkId) return;

    try {
        await deleteBookmark(deletingBookmarkId);
        closeDeleteModal();
        await loadBookmarks();
        showToast('Bookmark deleted!');
    } catch (error) {
        console.error('Error deleting bookmark:', error);
        showToast('Error deleting bookmark', 'error');
    }
}

// Export bookmarks
async function exportBookmarksToFile() {
    try {
        const json = await exportBookmarks();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `tweet-bookmarks-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`Exported ${allBookmarks.length} bookmarks!`);
    } catch (error) {
        console.error('Error exporting:', error);
        showToast('Error exporting bookmarks', 'error');
    }
}

// Import bookmarks
async function importBookmarksFromFile(file) {
    try {
        const text = await file.text();
        const count = await importBookmarks(text);
        await loadBookmarks();
        showToast(`Imported ${count} bookmarks!`);
    } catch (error) {
        console.error('Error importing:', error);
        showToast('Error importing bookmarks. Check file format.', 'error');
    }
}

// Show toast
function showToast(message, type = 'success') {
    const existingToast = document.querySelector('.toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.background = type === 'error' ? 'var(--danger)' : 'var(--success)';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

// Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Setup event listeners
function setupEventListeners() {
    // Search
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value;
        clearSearchBtn.style.display = query ? 'flex' : 'none';
        searchBookmarksLocal(query);
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        currentSearch = '';
        applyFilters();
    });

    // Clear filter
    clearFilterBtn.addEventListener('click', clearFilters);

    // Export
    exportBtn.addEventListener('click', exportBookmarksToFile);

    // Import
    importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            importBookmarksFromFile(file);
            e.target.value = ''; // Reset input
        }
    });

    // Edit modal
    editModalClose.addEventListener('click', closeEditModal);
    editCancel.addEventListener('click', closeEditModal);
    editSave.addEventListener('click', saveEdit);
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) closeEditModal();
    });
    editTagsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') closeEditModal();
    });

    // Delete modal
    deleteModalClose.addEventListener('click', closeDeleteModal);
    deleteCancel.addEventListener('click', closeDeleteModal);
    deleteConfirm.addEventListener('click', confirmDelete);
    deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) closeDeleteModal();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeEditModal();
            closeDeleteModal();
        }
    });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
