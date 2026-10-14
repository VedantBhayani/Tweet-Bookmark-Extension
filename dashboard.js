// Tweet Bookmarks Dashboard
// Features: Search, Filter, Notes, Quick Tags, Scroll Animations, Accessibility

let allBookmarks = [];
let filteredBookmarks = [];
let currentFilter = null;
let currentSearch = '';
let editingBookmarkId = null;
let deletingBookmarkId = null;
let scrollObserver = null;

// Selection mode state
let selectedBookmarks = new Set();
let selectionMode = false;

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

// Bulk Action Elements
const toggleSelectBtn = document.getElementById('toggle-select-btn');
const selectAllContainer = document.getElementById('select-all-container');
const selectAllCheckbox = document.getElementById('select-all');
const selectionCountEl = document.getElementById('selection-count');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');

// Bulk Delete Modal
const bulkDeleteModal = document.getElementById('bulk-delete-modal');
const bulkDeleteModalClose = document.getElementById('bulk-delete-modal-close');
const bulkDeleteCancel = document.getElementById('bulk-delete-cancel');
const bulkDeleteConfirm = document.getElementById('bulk-delete-confirm');
const bulkDeleteCountEl = document.getElementById('bulk-delete-count');

// Setup IntersectionObserver for scroll-triggered reveals
function setupScrollObserver() {
    if (scrollObserver) {
        scrollObserver.disconnect();
    }

    scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.remove('reveal-pending');
                entry.target.classList.add('revealed');
                scrollObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '50px'
    });
}

// Initialize
async function init() {
    setupScrollObserver();
    await loadBookmarks();
    setupEventListeners();
    setupQuickTags();
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

// Render bookmarks with scroll-triggered animation
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
        
        // Setup scroll-triggered reveal
        if (scrollObserver) {
            card.classList.add('reveal-pending');
            scrollObserver.observe(card);
        }
    });
}

// Create bookmark card
function createBookmarkCard(bookmark, index) {
    const card = document.createElement('div');
    card.className = 'bookmark-card';
    card.dataset.id = bookmark.id;
    card.style.setProperty('--index', index);

    const savedDate = formatDate(bookmark.savedAt);

    const tagsHtml = bookmark.tags && bookmark.tags.length > 0
        ? bookmark.tags.map(tag => `<span class="bookmark-tag">${escapeHtml(tag)}</span>`).join('')
        : '';

    const notesHtml = bookmark.notes
        ? `<div class="bookmark-notes">💭 ${escapeHtml(bookmark.notes)}</div>`
        : '';

    card.innerHTML = `
    <div class="bookmark-header">
      <div class="bookmark-author">
        <span class="bookmark-author-name">${escapeHtml(bookmark.authorName || 'Unknown')}</span>
        <span class="bookmark-author-handle">${escapeHtml(bookmark.author || '')}</span>
      </div>
      <div class="bookmark-actions">
        <button class="btn-icon" title="Edit" aria-label="Edit bookmark" data-action="edit">✏️</button>
        <button class="btn-icon" title="Delete" aria-label="Delete bookmark" data-action="delete">🗑️</button>
      </div>
    </div>
    <div class="bookmark-content">${escapeHtml(bookmark.content || 'No content')}</div>
    ${notesHtml}
    ${tagsHtml ? `<div class="bookmark-tags">${tagsHtml}</div>` : ''}
    <div class="bookmark-footer">
      <span class="bookmark-date">📅 ${savedDate}</span>
      <a href="${escapeHtml(bookmark.url)}" target="_blank" rel="noopener noreferrer" class="bookmark-link" aria-label="View tweet on X">View on X →</a>
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

    return card;
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
        chip.setAttribute('role', 'button');
        chip.setAttribute('tabindex', '0');
        chip.setAttribute('aria-pressed', currentFilter === tag);
        chip.addEventListener('click', () => filterByTag(tag));
        chip.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                filterByTag(tag);
            }
        });
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
    
    // Focus trap - focus first input
    setTimeout(() => {
        editTagsInput.focus();
    }, 100);
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
    
    // Focus the cancel button by default (safer option)
    setTimeout(() => {
        deleteCancel.focus();
    }, 100);
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

// === SELECTION MODE FUNCTIONS ===

// Toggle selection mode
function toggleSelectionMode() {
    selectionMode = !selectionMode;

    if (selectionMode) {
        toggleSelectBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            Cancel
        `;
        selectAllContainer.style.display = 'flex';
        selectionCountEl.style.display = 'inline';
    } else {
        toggleSelectBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
            Select
        `;
        selectAllContainer.style.display = 'none';
        selectionCountEl.style.display = 'none';
        bulkDeleteBtn.style.display = 'none';
        deselectAll();
    }

    updateCardSelectionMode();
}

// Update cards for selection mode
function updateCardSelectionMode() {
    const cards = bookmarksContainer.querySelectorAll('.bookmark-card');
    cards.forEach(card => {
        if (selectionMode) {
            card.classList.add('selectable');
            // Add checkbox if not present
            if (!card.querySelector('.card-checkbox')) {
                const checkbox = document.createElement('div');
                checkbox.className = 'card-checkbox';
                checkbox.innerHTML = `<input type="checkbox" aria-label="Select bookmark">`;
                card.appendChild(checkbox);

                const input = checkbox.querySelector('input');
                input.checked = selectedBookmarks.has(card.dataset.id);
                input.addEventListener('change', (e) => {
                    e.stopPropagation();
                    toggleBookmarkSelection(card.dataset.id);
                });
            }
        } else {
            card.classList.remove('selectable', 'selected');
            const checkbox = card.querySelector('.card-checkbox');
            if (checkbox) checkbox.remove();
        }
    });
}

// Toggle individual bookmark selection
function toggleBookmarkSelection(id) {
    if (selectedBookmarks.has(id)) {
        selectedBookmarks.delete(id);
    } else {
        selectedBookmarks.add(id);
    }
    updateSelectionUI();
}

// Select all visible bookmarks
function selectAll() {
    filteredBookmarks.forEach(bookmark => {
        selectedBookmarks.add(bookmark.id);
    });
    updateSelectionUI();
}

// Deselect all bookmarks
function deselectAll() {
    selectedBookmarks.clear();
    updateSelectionUI();
}

// Update selection UI
function updateSelectionUI() {
    const count = selectedBookmarks.size;
    selectionCountEl.textContent = `${count} selected`;

    // Update select all checkbox state
    if (filteredBookmarks.length > 0) {
        selectAllCheckbox.checked = count === filteredBookmarks.length;
        selectAllCheckbox.indeterminate = count > 0 && count < filteredBookmarks.length;
    }

    // Show/hide bulk delete button
    bulkDeleteBtn.style.display = count > 0 ? 'inline-flex' : 'none';

    // Update card visual states
    const cards = bookmarksContainer.querySelectorAll('.bookmark-card');
    cards.forEach(card => {
        const isSelected = selectedBookmarks.has(card.dataset.id);
        card.classList.toggle('selected', isSelected);
        const checkbox = card.querySelector('.card-checkbox input');
        if (checkbox) checkbox.checked = isSelected;
    });
}

// Open bulk delete modal
function openBulkDeleteModal() {
    if (selectedBookmarks.size === 0) return;

    bulkDeleteCountEl.textContent = selectedBookmarks.size;
    bulkDeleteModal.style.display = 'flex';

    setTimeout(() => {
        bulkDeleteCancel.focus();
    }, 100);
}

// Close bulk delete modal
function closeBulkDeleteModal() {
    bulkDeleteModal.style.display = 'none';
}

// Confirm bulk delete
async function confirmBulkDelete() {
    if (selectedBookmarks.size === 0) return;

    const idsToDelete = Array.from(selectedBookmarks);
    let deletedCount = 0;

    try {
        for (const id of idsToDelete) {
            await deleteBookmark(id);
            deletedCount++;
        }

        closeBulkDeleteModal();
        selectedBookmarks.clear();
        selectionMode = false;
        toggleSelectionMode(); // This will reset UI
        toggleSelectionMode(); // Toggle back to get correct state
        selectionMode = false;

        // Reset UI properly
        toggleSelectBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
            Select
        `;
        selectAllContainer.style.display = 'none';
        selectionCountEl.style.display = 'none';
        bulkDeleteBtn.style.display = 'none';

        await loadBookmarks();
        showToast(`🗑️ Deleted ${deletedCount} bookmarks!`, 'success');
    } catch (error) {
        console.error('Error deleting bookmarks:', error);
        showToast('Error deleting some bookmarks', 'error');
        await loadBookmarks();
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
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(16px)';
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
        tag.setAttribute('role', 'button');
        tag.setAttribute('tabindex', '0');
        tag.addEventListener('click', () => {
            filterByTag(tag.dataset.tag);
        });
        tag.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                filterByTag(tag.dataset.tag);
            }
        });
    });

    // Edit modal quick tags
    const editTagSuggestions = document.querySelectorAll('#edit-tag-suggestions .tag-suggestion');
    editTagSuggestions.forEach(tag => {
        tag.setAttribute('role', 'button');
        tag.setAttribute('tabindex', '0');
        
        const addTag = () => {
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
        };
        
        tag.addEventListener('click', addTag);
        tag.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                addTag();
            }
        });
    });
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
    editNotesInput.addEventListener('keydown', (e) => {
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

    // Bulk action controls
    toggleSelectBtn.addEventListener('click', toggleSelectionMode);

    selectAllCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            selectAll();
        } else {
            deselectAll();
        }
    });

    bulkDeleteBtn.addEventListener('click', openBulkDeleteModal);

    // Bulk delete modal
    bulkDeleteModalClose.addEventListener('click', closeBulkDeleteModal);
    bulkDeleteCancel.addEventListener('click', closeBulkDeleteModal);
    bulkDeleteConfirm.addEventListener('click', confirmBulkDelete);
    bulkDeleteModal.addEventListener('click', (e) => {
        if (e.target === bulkDeleteModal) closeBulkDeleteModal();
    });

    // Card click for selection mode
    bookmarksContainer.addEventListener('click', (e) => {
        if (!selectionMode) return;

        const card = e.target.closest('.bookmark-card');
        if (!card) return;

        // Don't toggle if clicking on links or buttons
        if (e.target.closest('a') || e.target.closest('button')) return;

        // Toggle selection
        toggleBookmarkSelection(card.dataset.id);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape to close modals
        if (e.key === 'Escape') {
            closeEditModal();
            closeDeleteModal();
            closeBulkDeleteModal();
            if (selectionMode) {
                toggleSelectionMode();
            }
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

        // Ctrl/Cmd + A to select all (in selection mode)
        if ((e.ctrlKey || e.metaKey) && e.key === 'a' && selectionMode) {
            e.preventDefault();
            selectAll();
        }
    });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
