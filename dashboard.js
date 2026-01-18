// Tweet Bookmarks Dashboard - Premium Edition
// Features: Search, Filter, Notes, Quick Tags, Animations

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
const editNotesInput = document.getElementById('edit-notes');
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
    setupQuickTags();
    addCardAnimations();
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

// Render bookmarks with staggered animation
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

    filteredBookmarks.forEach((bookmark, index) => {
        const card = createBookmarkCard(bookmark, index);
        bookmarksContainer.appendChild(card);
    });
}

// Create bookmark card with premium styling
function createBookmarkCard(bookmark, index) {
    const card = document.createElement('div');
    card.className = 'bookmark-card';
    card.dataset.id = bookmark.id;
    card.style.animationDelay = `${index * 0.05}s`;

    const savedDate = formatDate(bookmark.savedAt);

    const tagsHtml = bookmark.tags && bookmark.tags.length > 0
        ? bookmark.tags.map(tag => `<span class="bookmark-tag">${escapeHtml(tag)}</span>`).join('')
        : '';

    const notesHtml = bookmark.notes
        ? `<div class="bookmark-notes" style="font-size: 13px; color: var(--text-muted); font-style: italic; margin-bottom: 12px;">💭 ${escapeHtml(bookmark.notes)}</div>`
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
    ${notesHtml}
    ${tagsHtml ? `<div class="bookmark-tags">${tagsHtml}</div>` : ''}
    <div class="bookmark-footer">
      <span class="bookmark-date">📅 ${savedDate}</span>
      <a href="${escapeHtml(bookmark.url)}" target="_blank" class="bookmark-link">View on X →</a>
    </div>
  `;

    // Event listeners for actions
    card.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(bookmark);
    });
    card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteModal(bookmark.id);
    });

    // Add 3D tilt effect
    addTiltEffect(card);

    return card;
}

// Add 3D tilt effect to cards
function addTiltEffect(card) {
    card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const rotateX = (y - centerY) / 20;
        const rotateY = (centerX - x) / 20;

        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
    });

    card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateY(0)';
    });
}

// Format date nicely
function formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    // Less than 24 hours
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        if (hours < 1) {
            const mins = Math.floor(diff / 60000);
            return mins < 1 ? 'Just now' : `${mins}m ago`;
        }
        return `${hours}h ago`;
    }

    // Less than 7 days
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `${days}d ago`;
    }

    // Otherwise show date
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
}

// Render tags in sidebar
function renderTags() {
    const tags = getAllTagsFromBookmarks();
    tagListEl.innerHTML = '';

    if (tags.length === 0) {
        tagListEl.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No tags yet</p>';
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
        if (bookmark.tags) {
            bookmark.tags.forEach(tag => tagSet.add(tag));
        }
    });
    return Array.from(tagSet).sort();
}

// Update stats with animation
function updateStats() {
    const target = allBookmarks.length;
    const current = parseInt(totalCountEl.textContent) || 0;

    if (current === target) return;

    // Animate count
    const duration = 500;
    const step = (target - current) / (duration / 16);
    let value = current;

    const animate = () => {
        value += step;
        if ((step > 0 && value >= target) || (step < 0 && value <= target)) {
            totalCountEl.textContent = target;
        } else {
            totalCountEl.textContent = Math.round(value);
            requestAnimationFrame(animate);
        }
    };

    requestAnimationFrame(animate);
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
            (bookmark.content && bookmark.content.toLowerCase().includes(currentSearch)) ||
            (bookmark.author && bookmark.author.toLowerCase().includes(currentSearch)) ||
            (bookmark.authorName && bookmark.authorName.toLowerCase().includes(currentSearch)) ||
            (bookmark.notes && bookmark.notes.toLowerCase().includes(currentSearch)) ||
            (bookmark.tags && bookmark.tags.some(tag => tag.toLowerCase().includes(currentSearch)));

        const matchesTag = currentFilter === null ||
            (bookmark.tags && bookmark.tags.some(tag => tag.toLowerCase() === currentFilter.toLowerCase()));

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
    editTagsInput.value = bookmark.tags ? bookmark.tags.join(', ') : '';
    editNotesInput.value = bookmark.notes || '';
    editModal.style.display = 'flex';
    setTimeout(() => editTagsInput.focus(), 100);
}

// Close edit modal
function closeEditModal() {
    editModal.style.display = 'none';
    editingBookmarkId = null;
    editTagsInput.value = '';
    editNotesInput.value = '';
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
    bookmark.notes = editNotesInput.value.trim() || '';

    try {
        await saveBookmark(bookmark);
        closeEditModal();
        await loadBookmarks();
        showToast('✨ Bookmark updated!', 'success');
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
        showToast('🗑️ Bookmark deleted!', 'success');
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

        showToast(`📤 Exported ${allBookmarks.length} bookmarks!`, 'success');
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
        showToast(`📥 Imported ${count} bookmarks!`, 'success');
    } catch (error) {
        console.error('Error importing:', error);
        showToast('Error importing bookmarks. Check file format.', 'error');
    }
}

// Show toast with animation
function showToast(message, type = 'success') {
    const existingToast = document.querySelector('.toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        toast.style.animation = 'toastSlide 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Setup quick tags functionality
function setupQuickTags() {
    // Sidebar quick tags
    const quickTags = document.querySelectorAll('#quick-tags .tag-suggestion');
    quickTags.forEach(tag => {
        tag.addEventListener('click', () => {
            filterByTag(tag.dataset.tag);
        });
    });

    // Edit modal quick tags
    const editTagSuggestions = document.querySelectorAll('#edit-tag-suggestions .tag-suggestion');
    editTagSuggestions.forEach(tag => {
        tag.addEventListener('click', () => {
            const currentTags = editTagsInput.value.trim();
            const newTag = tag.dataset.tag;

            if (currentTags) {
                const tagsArray = currentTags.split(',').map(t => t.trim());
                if (!tagsArray.includes(newTag)) {
                    editTagsInput.value = currentTags + ', ' + newTag;
                }
            } else {
                editTagsInput.value = newTag;
            }

            editTagsInput.focus();
        });
    });
}

// Add card entrance animations
function addCardAnimations() {
    // Already handled by CSS animation with staggered delays
}

// Setup event listeners
function setupEventListeners() {
    // Search
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value;
        clearSearchBtn.style.display = query ? 'flex' : 'none';

        // Debounce search
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchBookmarksLocal(query);
        }, 150);
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        currentSearch = '';
        applyFilters();
        searchInput.focus();
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
            e.target.value = '';
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
        // Escape to close modals
        if (e.key === 'Escape') {
            closeEditModal();
            closeDeleteModal();
        }

        // Ctrl/Cmd + F to focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        }

        // Ctrl/Cmd + E to export
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
            e.preventDefault();
            exportBookmarksToFile();
        }
    });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
