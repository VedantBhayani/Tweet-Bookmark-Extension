// Tweet Bookmark Extension - Content Script
// Runs on twitter.com and x.com
// Optimized for performance with throttled observers and memory management

(function () {
    'use strict';

    // Track which tweets already have our button
    const processedTweets = new Set();
    let lastUrl = location.href;
    let isProcessing = false;
    let processingTimeout = null;

    // Extract tweet ID from URL
    function extractTweetId(url) {
        const match = url.match(/\/status\/(\d+)/);
        return match ? match[1] : null;
    }

    // Clear processed tweets when URL changes (navigation)
    function checkUrlChange() {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            // Clear cache on navigation to prevent memory buildup
            if (processedTweets.size > 500) {
                processedTweets.clear();
            }
        }
    }

    // Extract data from a tweet element
    function extractTweetData(tweetElement) {
        try {
            // Get tweet text
            const textElement = tweetElement.querySelector('div[data-testid="tweetText"]');
            const content = textElement ? textElement.innerText : '';

            // Get author info
            const userNameDiv = tweetElement.querySelector('div[data-testid="User-Name"]');
            let author = '';
            let authorName = '';

            if (userNameDiv) {
                const links = userNameDiv.querySelectorAll('a');
                links.forEach(link => {
                    const href = link.getAttribute('href');
                    if (href && href.startsWith('/') && !href.includes('/status/')) {
                        author = '@' + href.substring(1);
                    }
                    // Get display name (usually the first span with specific styling)
                    const nameSpan = link.querySelector('span');
                    if (nameSpan && !authorName) {
                        authorName = nameSpan.innerText;
                    }
                });
            }

            // Get tweet URL
            const timeLink = tweetElement.querySelector('a[href*="/status/"]');
            const url = timeLink ? 'https://x.com' + timeLink.getAttribute('href').split('?')[0] : '';

            // Get tweet ID
            const id = extractTweetId(url);

            // Get timestamp
            const timeElement = tweetElement.querySelector('time');
            const tweetDate = timeElement ? timeElement.getAttribute('datetime') : '';

            return {
                id,
                url,
                content,
                author,
                authorName,
                tweetDate,
                tags: [],
                savedAt: Date.now()
            };
        } catch (error) {
            console.error('Tweet Bookmark: Error extracting tweet data:', error);
            return null;
        }
    }

    // Create the save button
    function createSaveButton(tweetElement) {
        const btn = document.createElement('button');
        btn.className = 'tweet-bookmark-btn';
        btn.innerHTML = '📌';
        btn.title = 'Save to Bookmarks';
        btn.setAttribute('aria-label', 'Save tweet to bookmarks');

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const tweetData = extractTweetData(tweetElement);
            if (!tweetData || !tweetData.id) {
                showToast('Could not extract tweet data');
                return;
            }

            // Check if already saved
            const exists = await bookmarkExists(tweetData.id);
            if (exists) {
                showModal(tweetData, true); // Edit mode
            } else {
                showModal(tweetData, false); // New bookmark
            }
        });

        return btn;
    }

    // Show the save/edit modal
    function showModal(tweetData, isEdit = false) {
        // Remove any existing modal
        const existingModal = document.querySelector('.tweet-bookmark-modal-overlay');
        if (existingModal) existingModal.remove();

        const overlay = document.createElement('div');
        overlay.className = 'tweet-bookmark-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'tweet-bookmark-modal-title');

        overlay.innerHTML = `
      <div class="tweet-bookmark-modal">
        <div class="tweet-bookmark-modal-header">
          <h2 class="tweet-bookmark-modal-title" id="tweet-bookmark-modal-title">${isEdit ? '✏️ Edit Bookmark' : '📌 Save Tweet'}</h2>
          <button class="tweet-bookmark-modal-close" aria-label="Close dialog">&times;</button>
        </div>
        <div class="tweet-bookmark-modal-body">
          <div class="tweet-bookmark-preview">
            <div class="tweet-bookmark-preview-author">${escapeHtml(tweetData.authorName)}</div>
            <div class="tweet-bookmark-preview-handle">${escapeHtml(tweetData.author)}</div>
            <div class="tweet-bookmark-preview-content">${escapeHtml(tweetData.content.substring(0, 280))}${tweetData.content.length > 280 ? '...' : ''}</div>
          </div>
          <div class="tweet-bookmark-form-group">
            <label class="tweet-bookmark-label" for="tweet-bookmark-tags">Tags</label>
            <input type="text" class="tweet-bookmark-input" id="tweet-bookmark-tags" 
                   placeholder="tech, ai, interesting" 
                   value="${tweetData.tags ? tweetData.tags.join(', ') : ''}"
                   aria-describedby="tweet-bookmark-tags-hint">
            <div class="tweet-bookmark-quick-tags" role="group" aria-label="Quick add tags">
              <span class="tweet-bookmark-quick-tag" data-tag="important" role="button" tabindex="0">🔥 Important</span>
              <span class="tweet-bookmark-quick-tag" data-tag="learn" role="button" tabindex="0">📚 Learn</span>
              <span class="tweet-bookmark-quick-tag" data-tag="tech" role="button" tabindex="0">💻 Tech</span>
              <span class="tweet-bookmark-quick-tag" data-tag="thread" role="button" tabindex="0">🧵 Thread</span>
            </div>
          </div>
          <div class="tweet-bookmark-form-group">
            <label class="tweet-bookmark-label" for="tweet-bookmark-notes">Notes (optional)</label>
            <input type="text" class="tweet-bookmark-input" id="tweet-bookmark-notes" 
                   placeholder="Why are you saving this?"
                   value="${tweetData.notes || ''}">
          </div>
        </div>
        <div class="tweet-bookmark-modal-footer">
          <button class="tweet-bookmark-btn-cancel">Cancel</button>
          <button class="tweet-bookmark-btn-save">${isEdit ? 'Update' : 'Save'}</button>
        </div>
      </div>
    `;

        document.body.appendChild(overlay);

        // Event listeners
        const closeBtn = overlay.querySelector('.tweet-bookmark-modal-close');
        const cancelBtn = overlay.querySelector('.tweet-bookmark-btn-cancel');
        const saveBtn = overlay.querySelector('.tweet-bookmark-btn-save');
        const tagsInput = overlay.querySelector('#tweet-bookmark-tags');
        const notesInput = overlay.querySelector('#tweet-bookmark-notes');
        const quickTags = overlay.querySelectorAll('.tweet-bookmark-quick-tag');

        const closeModal = () => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 150);
        };

        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        // Quick tag click handlers
        quickTags.forEach(tagEl => {
            const addTag = () => {
                const tag = tagEl.dataset.tag;
                const currentTags = tagsInput.value.trim();

                if (currentTags) {
                    const tagsArray = currentTags.split(',').map(t => t.trim());
                    if (!tagsArray.includes(tag)) {
                        tagsInput.value = currentTags + ', ' + tag;
                    }
                } else {
                    tagsInput.value = tag;
                }

                tagsInput.focus();
            };

            tagEl.addEventListener('click', addTag);
            tagEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    addTag();
                }
            });
        });

        // Focus tags input
        setTimeout(() => tagsInput.focus(), 100);

        // Save handler
        saveBtn.addEventListener('click', async () => {
            const tagsValue = tagsInput.value.trim();
            const tags = tagsValue
                ? tagsValue.split(',').map(t => t.trim()).filter(t => t.length > 0)
                : [];

            const bookmark = {
                ...tweetData,
                tags,
                notes: notesInput.value.trim() || '',
                savedAt: Date.now()
            };

            try {
                await saveBookmark(bookmark);
                closeModal();
                showToast(isEdit ? '✨ Bookmark updated!' : '🎉 Tweet saved!');

                // Update button appearance
                const btn = document.querySelector(`[data-tweet-id="${tweetData.id}"]`);
                if (btn) btn.classList.add('saved');
            } catch (error) {
                console.error('Tweet Bookmark: Error saving:', error);
                showToast('❌ Error saving bookmark');
            }
        });

        // Enter key to save, Escape to close
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                saveBtn.click();
            }
            if (e.key === 'Escape') {
                closeModal();
            }
        });
    }

    // Show toast notification
    function showToast(message) {
        const existingToast = document.querySelector('.tweet-bookmark-toast');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.className = 'tweet-bookmark-toast';
        toast.textContent = message;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(12px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Add save button to a tweet
    function addButtonToTweet(tweetElement) {
        // Find the actions bar (where like, retweet buttons are)
        const actionsBar = tweetElement.querySelector('div[role="group"]');
        if (!actionsBar) return;

        // Check if we already added a button
        if (actionsBar.querySelector('.tweet-bookmark-btn')) return;

        // Get tweet ID to track
        const timeLink = tweetElement.querySelector('a[href*="/status/"]');
        const url = timeLink ? timeLink.getAttribute('href') : '';
        const tweetId = extractTweetId(url);

        if (!tweetId || processedTweets.has(tweetId)) return;
        processedTweets.add(tweetId);

        // Create and add button
        const btn = createSaveButton(tweetElement);
        btn.setAttribute('data-tweet-id', tweetId);

        // Check if already saved and mark accordingly
        bookmarkExists(tweetId).then(exists => {
            if (exists) btn.classList.add('saved');
        });

        // Add to the end of actions bar
        actionsBar.appendChild(btn);
    }

    // Process all visible tweets
    function processAllTweets() {
        checkUrlChange();
        const tweets = document.querySelectorAll('article[data-testid="tweet"]');
        tweets.forEach(addButtonToTweet);
    }

    // Observe for new tweets (infinite scroll) - optimized with throttling
    function observeNewTweets() {
        const observer = new MutationObserver((mutations) => {
            // Skip if already processing
            if (isProcessing) return;

            // Check if any nodes were added
            const hasNewNodes = mutations.some(mutation => mutation.addedNodes.length > 0);

            if (hasNewNodes) {
                isProcessing = true;

                // Clear existing timeout
                if (processingTimeout) {
                    clearTimeout(processingTimeout);
                }

                // Throttle processing to 250ms
                processingTimeout = setTimeout(() => {
                    processAllTweets();
                    isProcessing = false;
                }, 250);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Initialize
    function init() {
        console.log('Tweet Bookmark: Extension loaded');
        processAllTweets();
        observeNewTweets();
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
