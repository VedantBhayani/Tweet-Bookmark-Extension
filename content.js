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

    // DM scanning state
    let dmScanButton = null;
    let isDMPage = false;

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
            // Check for DM page on navigation
            handleDMPage();
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

    // ==========================================
    // DM Auto-Bookmark Feature
    // ==========================================

    // Check if current page is a DM conversation
    function checkIsDMPage() {
        return /\/messages\/\d+/.test(location.pathname);
    }

    // Extract recipient username from DM page
    function extractDMRecipient() {
        // Try to get username from conversation header
        // Twitter DM header contains the recipient's name/handle
        const headerSelectors = [
            '[data-testid="conversation-header"] [dir="ltr"] span',
            '[data-testid="DM_Conversation_Header"] span',
            'section[role="region"] h2 span',
            '[data-testid="cellInnerDiv"] [data-testid="UserName"]'
        ];

        for (const selector of headerSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                const text = element.textContent.trim();
                // Check if it looks like a handle (starts with @)
                if (text.startsWith('@')) {
                    return text;
                }
            }
        }

        // Try finding username in header links
        const headerLinks = document.querySelectorAll('[data-testid="conversation-header"] a, header a');
        for (const link of headerLinks) {
            const href = link.getAttribute('href');
            if (href && href.match(/^\/[a-zA-Z0-9_]+$/) && !href.includes('/messages')) {
                return '@' + href.substring(1);
            }
        }

        return '@unknown';
    }

    // Create floating DM scan button
    function createDMScanButton() {
        if (dmScanButton) return;

        dmScanButton = document.createElement('button');
        dmScanButton.className = 'tweet-bookmark-dm-scan-btn';
        dmScanButton.innerHTML = '<span class="dm-scan-icon">📌</span><span class="dm-scan-text">Bookmark My Shared Tweets</span>';
        dmScanButton.title = 'Scan this DM for tweets you shared and bookmark them';
        dmScanButton.setAttribute('aria-label', 'Bookmark tweets shared in this DM conversation');

        dmScanButton.addEventListener('click', () => {
            scanDMForTweets();
        });

        document.body.appendChild(dmScanButton);
    }

    // Remove DM scan button
    function removeDMScanButton() {
        if (dmScanButton) {
            dmScanButton.remove();
            dmScanButton = null;
        }
    }

    // Scan DM conversation for shared tweets
    async function scanDMForTweets() {
        const recipient = extractDMRecipient();
        showToast('🔍 Scanning DM for shared tweets...');

        // Find all tweet cards in the DM conversation
        const tweetCards = findTweetCardsInDM();

        if (tweetCards.length === 0) {
            showToast('No shared tweets found in this conversation');
            return;
        }

        // Filter to only tweets YOU sent (not received)
        const mySharedTweets = tweetCards.filter(card => isTweetSentByMe(card));

        if (mySharedTweets.length === 0) {
            showToast('No tweets that you shared were found');
            return;
        }

        // Extract tweet data from cards
        const tweetsData = [];
        for (const card of mySharedTweets) {
            const tweetData = extractTweetDataFromDMCard(card);
            if (tweetData && tweetData.id) {
                // Check if already bookmarked
                const exists = await bookmarkExists(tweetData.id);
                tweetsData.push({
                    ...tweetData,
                    alreadySaved: exists
                });
            }
        }

        // Deduplicate by tweet ID
        const uniqueTweets = [];
        const seenIds = new Set();
        for (const tweet of tweetsData) {
            if (!seenIds.has(tweet.id)) {
                seenIds.add(tweet.id);
                uniqueTweets.push(tweet);
            }
        }

        if (uniqueTweets.length === 0) {
            showToast('No tweets to bookmark (could not extract data)');
            return;
        }

        // Show confirmation modal
        showDMBookmarkModal(uniqueTweets, recipient);
    }

    // Find all tweet cards embedded in DM messages
    function findTweetCardsInDM() {
        const tweetCards = [];

        // Twitter embeds tweets as cards with links to /status/
        // Look for various tweet card selectors used in DMs
        const cardSelectors = [
            '[data-testid="tweetText"]',
            'a[href*="/status/"]',
            '[data-testid="card.wrapper"]',
            '[data-testid="tweet"]'
        ];

        // First, find all message groups in the DM
        const messageContainers = document.querySelectorAll('[data-testid="messageEntry"], [data-testid="cellInnerDiv"]');

        for (const container of messageContainers) {
            // Check for tweet links within this message
            const tweetLinks = container.querySelectorAll('a[href*="/status/"]');
            for (const link of tweetLinks) {
                // Get the parent container that represents the whole tweet card
                const cardWrapper = link.closest('[data-testid="card.wrapper"]') ||
                                   link.closest('article') ||
                                   link.closest('[role="link"]') ||
                                   link;

                if (cardWrapper && !tweetCards.includes(cardWrapper)) {
                    tweetCards.push({
                        element: cardWrapper,
                        messageContainer: container,
                        tweetLink: link
                    });
                }
            }
        }

        // Also check for standalone tweet embeds
        const embeddedTweets = document.querySelectorAll('[data-testid="tweetText"]');
        for (const tweet of embeddedTweets) {
            const container = tweet.closest('[data-testid="messageEntry"], [data-testid="cellInnerDiv"]');
            if (container) {
                const tweetLink = container.querySelector('a[href*="/status/"]');
                if (tweetLink) {
                    const existing = tweetCards.find(tc => tc.element === tweet || tc.tweetLink === tweetLink);
                    if (!existing) {
                        tweetCards.push({
                            element: tweet,
                            messageContainer: container,
                            tweetLink: tweetLink
                        });
                    }
                }
            }
        }

        return tweetCards;
    }

    // Determine if a message containing a tweet was sent by the current user
    function isTweetSentByMe(tweetCard) {
        const messageContainer = tweetCard.messageContainer;
        if (!messageContainer) return false;

        // Twitter DM styling: sent messages are typically on the right side
        // and have different background colors/styling

        // Method 1: Check for data-testid attributes that indicate sent messages
        const sentIndicators = messageContainer.querySelectorAll('[data-testid*="sent"], [data-testid*="outgoing"]');
        if (sentIndicators.length > 0) return true;

        // Method 2: Check for styling classes that indicate sent messages
        // Sent messages typically have a colored background (blue/accent color)
        const messageElement = messageContainer.querySelector('[data-testid="messageEntry"]') || messageContainer;
        const computedStyle = window.getComputedStyle(messageElement);

        // Method 3: Check positioning - sent messages are typically flex-end/right aligned
        const parentStyle = messageContainer.parentElement ?
            window.getComputedStyle(messageContainer.parentElement) : null;

        if (parentStyle) {
            const justifyContent = parentStyle.justifyContent;
            const alignItems = parentStyle.alignItems;
            if (justifyContent === 'flex-end' || alignItems === 'flex-end') {
                return true;
            }
        }

        // Method 4: Check if message bubble has the "sent" styling
        // Twitter uses specific background colors for sent vs received
        const bubble = messageContainer.querySelector('[dir="auto"]')?.closest('div');
        if (bubble) {
            const bgColor = window.getComputedStyle(bubble).backgroundColor;
            // Twitter's sent message color is typically blue/accent (rgb(29, 155, 240))
            if (bgColor.includes('29, 155, 240') || bgColor.includes('1d9bf0')) {
                return true;
            }
        }

        // Method 5: Check the container's flex alignment
        let parent = messageContainer;
        for (let i = 0; i < 5; i++) {
            if (!parent.parentElement) break;
            parent = parent.parentElement;
            const style = window.getComputedStyle(parent);
            if (style.display === 'flex') {
                if (style.justifyContent === 'flex-end') {
                    return true;
                }
                if (style.flexDirection === 'row-reverse') {
                    return true;
                }
            }
        }

        // Method 6: Check for margin-left: auto pattern (right-aligned)
        const msgStyle = window.getComputedStyle(messageContainer);
        if (msgStyle.marginLeft === 'auto' || msgStyle.marginInlineStart === 'auto') {
            return true;
        }

        // Default: assume it's received if we can't determine
        return false;
    }

    // Extract tweet data from a DM embedded tweet card
    function extractTweetDataFromDMCard(tweetCard) {
        try {
            const { element, tweetLink } = tweetCard;

            // Get tweet URL from the link
            let url = '';
            let tweetId = null;

            if (tweetLink) {
                const href = tweetLink.getAttribute('href');
                if (href) {
                    url = href.startsWith('http') ? href : 'https://x.com' + href;
                    tweetId = extractTweetId(url);
                }
            }

            if (!tweetId) return null;

            // Try to extract content from the card preview
            let content = '';
            const textElement = element.querySelector('[data-testid="tweetText"]') ||
                               element.querySelector('[dir="auto"]') ||
                               element;
            if (textElement) {
                content = textElement.innerText || '';
            }

            // Try to extract author info
            let author = '';
            let authorName = '';

            // Look for author links or text in the card
            const authorLink = element.querySelector('a[href^="/"]:not([href*="/status/"])');
            if (authorLink) {
                const href = authorLink.getAttribute('href');
                if (href && href.match(/^\/[a-zA-Z0-9_]+$/)) {
                    author = '@' + href.substring(1);
                }
                const nameSpan = authorLink.querySelector('span');
                if (nameSpan) {
                    authorName = nameSpan.innerText || '';
                }
            }

            // Extract from URL if author not found
            if (!author && url) {
                const urlMatch = url.match(/x\.com\/([^\/]+)\/status/);
                if (urlMatch) {
                    author = '@' + urlMatch[1];
                }
            }

            return {
                id: tweetId,
                url: url,
                content: content.substring(0, 500), // Limit content length
                author: author,
                authorName: authorName,
                tweetDate: '',
                tags: [],
                savedAt: Date.now()
            };
        } catch (error) {
            console.error('Tweet Bookmark: Error extracting DM tweet data:', error);
            return null;
        }
    }

    // Show modal to confirm bulk bookmarking
    function showDMBookmarkModal(tweets, recipient) {
        // Remove any existing modal
        const existingModal = document.querySelector('.tweet-bookmark-modal-overlay');
        if (existingModal) existingModal.remove();

        const newTweets = tweets.filter(t => !t.alreadySaved);
        const savedCount = tweets.length - newTweets.length;

        const overlay = document.createElement('div');
        overlay.className = 'tweet-bookmark-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'dm-bookmark-modal-title');

        const tag = `dm-${recipient}`;

        overlay.innerHTML = `
      <div class="tweet-bookmark-modal tweet-bookmark-dm-modal">
        <div class="tweet-bookmark-modal-header">
          <h2 class="tweet-bookmark-modal-title" id="dm-bookmark-modal-title">📌 Bookmark Shared Tweets</h2>
          <button class="tweet-bookmark-modal-close" aria-label="Close dialog">&times;</button>
        </div>
        <div class="tweet-bookmark-modal-body">
          <div class="dm-bookmark-summary">
            <div class="dm-bookmark-count">
              Found <strong>${tweets.length}</strong> tweet${tweets.length === 1 ? '' : 's'} you shared with <strong>${escapeHtml(recipient)}</strong>
            </div>
            ${savedCount > 0 ? `<div class="dm-bookmark-saved-note">(${savedCount} already bookmarked)</div>` : ''}
          </div>

          <div class="dm-tweet-preview-list">
            ${tweets.map((tweet, index) => `
              <div class="dm-tweet-preview-item ${tweet.alreadySaved ? 'already-saved' : ''}" data-index="${index}">
                <div class="dm-tweet-checkbox">
                  <input type="checkbox" id="dm-tweet-${index}" ${tweet.alreadySaved ? 'disabled' : 'checked'}>
                </div>
                <div class="dm-tweet-info">
                  <div class="dm-tweet-author">${escapeHtml(tweet.author)}</div>
                  <div class="dm-tweet-content">${escapeHtml(tweet.content.substring(0, 100))}${tweet.content.length > 100 ? '...' : ''}</div>
                  ${tweet.alreadySaved ? '<div class="dm-tweet-saved-badge">Already saved</div>' : ''}
                </div>
              </div>
            `).join('')}
          </div>

          <div class="tweet-bookmark-form-group">
            <label class="tweet-bookmark-label">Auto-Tag</label>
            <div class="dm-auto-tag-preview">
              <span class="dm-tag-chip">${escapeHtml(tag)}</span>
            </div>
          </div>

          <div class="tweet-bookmark-form-group">
            <label class="tweet-bookmark-label" for="dm-additional-tags">Additional Tags (optional)</label>
            <input type="text" class="tweet-bookmark-input" id="dm-additional-tags"
                   placeholder="important, reference">
          </div>
        </div>
        <div class="tweet-bookmark-modal-footer">
          <div class="dm-bookmark-progress" style="display: none;">
            <div class="dm-progress-bar"><div class="dm-progress-fill"></div></div>
            <div class="dm-progress-text">Saving...</div>
          </div>
          <button class="tweet-bookmark-btn-cancel">Cancel</button>
          <button class="tweet-bookmark-btn-save dm-save-all-btn" ${newTweets.length === 0 ? 'disabled' : ''}>
            Save ${newTweets.length} Tweet${newTweets.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    `;

        document.body.appendChild(overlay);

        // Event listeners
        const closeBtn = overlay.querySelector('.tweet-bookmark-modal-close');
        const cancelBtn = overlay.querySelector('.tweet-bookmark-btn-cancel');
        const saveBtn = overlay.querySelector('.dm-save-all-btn');
        const additionalTagsInput = overlay.querySelector('#dm-additional-tags');
        const progressDiv = overlay.querySelector('.dm-bookmark-progress');
        const progressFill = overlay.querySelector('.dm-progress-fill');
        const progressText = overlay.querySelector('.dm-progress-text');
        const checkboxes = overlay.querySelectorAll('.dm-tweet-preview-item:not(.already-saved) input[type="checkbox"]');

        const closeModal = () => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 150);
        };

        // Update save button count based on checked items
        const updateSaveButtonCount = () => {
            const checkedCount = overlay.querySelectorAll('.dm-tweet-preview-item:not(.already-saved) input[type="checkbox"]:checked').length;
            saveBtn.textContent = `Save ${checkedCount} Tweet${checkedCount === 1 ? '' : 's'}`;
            saveBtn.disabled = checkedCount === 0;
        };

        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        // Checkbox change handlers
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', updateSaveButtonCount);
        });

        // Save handler
        saveBtn.addEventListener('click', async () => {
            const additionalTagsValue = additionalTagsInput.value.trim();
            const additionalTags = additionalTagsValue
                ? additionalTagsValue.split(',').map(t => t.trim()).filter(t => t.length > 0)
                : [];

            // Get selected tweets
            const selectedTweets = [];
            tweets.forEach((tweet, index) => {
                if (tweet.alreadySaved) return;
                const checkbox = overlay.querySelector(`#dm-tweet-${index}`);
                if (checkbox && checkbox.checked) {
                    selectedTweets.push(tweet);
                }
            });

            if (selectedTweets.length === 0) {
                showToast('No tweets selected');
                return;
            }

            // Show progress
            saveBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
            progressDiv.style.display = 'block';

            let savedCount = 0;
            let errorCount = 0;

            for (let i = 0; i < selectedTweets.length; i++) {
                const tweet = selectedTweets[i];

                // Update progress
                const progress = ((i + 1) / selectedTweets.length) * 100;
                progressFill.style.width = `${progress}%`;
                progressText.textContent = `Saving ${i + 1} of ${selectedTweets.length}...`;

                try {
                    const bookmark = {
                        ...tweet,
                        tags: [tag, ...additionalTags],
                        notes: `Shared in DM with ${recipient}`,
                        savedAt: Date.now()
                    };
                    delete bookmark.alreadySaved;

                    await saveBookmark(bookmark);
                    savedCount++;
                } catch (error) {
                    console.error('Tweet Bookmark: Error saving tweet:', error);
                    errorCount++;
                }
            }

            closeModal();

            if (errorCount > 0) {
                showToast(`✅ Saved ${savedCount} tweets, ⚠️ ${errorCount} failed`);
            } else {
                showToast(`🎉 Saved ${savedCount} tweet${savedCount === 1 ? '' : 's'} with tag: ${tag}`);
            }
        });

        // Escape to close
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        });
    }

    // Handle DM page detection and button injection
    function handleDMPage() {
        const isCurrentlyDMPage = checkIsDMPage();

        if (isCurrentlyDMPage && !isDMPage) {
            // Entered a DM conversation
            isDMPage = true;
            // Wait a bit for the DM to load
            setTimeout(() => {
                if (checkIsDMPage()) {
                    createDMScanButton();
                }
            }, 1000);
        } else if (!isCurrentlyDMPage && isDMPage) {
            // Left DM conversation
            isDMPage = false;
            removeDMScanButton();
        }
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
        // Check if we're on a DM page on initial load
        handleDMPage();
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
