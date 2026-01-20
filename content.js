// Tweet Bookmark Extension - Content Script
// Runs on twitter.com and x.com
// Version: 2.2.0 - Progressive scroll scanning for DMs + improved author detection

(function () {
    'use strict';

    // VERSION CHECK - Log to confirm latest code is running
    console.log('%c[Tweet Bookmark v2.2.0] Content script loaded', 'color: green; font-weight: bold');

    // Track which tweets already have our button
    const processedTweets = new Set();
    let lastUrl = location.href;
    let isProcessing = false;
    let processingTimeout = null;

    // DM scanning state
    let dmScanButton = null;
    let isDMPage = false;

    // Helper: Sleep/delay function for async operations
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
        // Match both old and new DM URL patterns:
        // - /messages/{id} (old format)
        // - /i/chat/{id1}-{id2} (new format: x.com/i/chat/1289813681602142209-1687831766835556352)
        return /\/(messages\/\d+|i\/chat\/[\d-]+)/.test(location.pathname);
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

    // Scan DM conversation for shared tweets with progressive scrolling
    async function scanDMForTweets() {
        const recipient = extractDMRecipient();

        // Find the ACTUAL scrollable DM container (not <main>, but the inner scrollable div)
        // Strategy: Find element with overflow-y scroll/auto that contains DM messages
        let viewport = null;

        // Try specific Twitter DM selectors first
        const dmSelectors = [
            '[data-testid="DmActivityViewport"]',
            '[data-testid="DmScrollerContainer"]',
            '[data-testid="DMDrawer"] [data-testid="ScrollSnap-List"]',
            'section[role="region"] > div > div' // Common DM structure
        ];

        for (const selector of dmSelectors) {
            const el = document.querySelector(selector);
            if (el) {
                const style = window.getComputedStyle(el);
                if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                    viewport = el;
                    console.log('Tweet Bookmark: Found scrollable via selector:', selector);
                    break;
                }
            }
        }

        // Fallback: Find any scrollable container that has tweet links inside
        if (!viewport) {
            const tweetLink = document.querySelector('a[href*="/status/"]');
            if (tweetLink) {
                let parent = tweetLink.parentElement;
                for (let i = 0; i < 20 && parent; i++) {
                    const style = window.getComputedStyle(parent);
                    // Check if this element is scrollable AND has significant scroll height
                    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                        parent.scrollHeight > parent.clientHeight + 100) {
                        viewport = parent;
                        console.log('Tweet Bookmark: Found scrollable via parent walk, tag:', parent.tagName, 'scrollHeight:', parent.scrollHeight);
                        break;
                    }
                    parent = parent.parentElement;
                }
            }
        }

        if (!viewport) {
            console.log('Tweet Bookmark: Could not find scrollable viewport, trying document.scrollingElement');
            viewport = document.scrollingElement || document.body;
        }

        console.log('Tweet Bookmark: Using viewport:', viewport.tagName, viewport.className?.substring(0, 50),
                    'scrollHeight:', viewport.scrollHeight, 'clientHeight:', viewport.clientHeight);

        // Show scanning progress
        showToast('🔍 Scanning... scrolling through conversation');

        const foundTweets = new Map(); // tweetId -> cardData
        let noNewTweetsCount = 0;
        const MAX_STABLE_SCROLLS = 5; // Stop after 5 scrolls with no new tweets
        const MAX_ITERATIONS = 100; // Safety limit

        // Save original scroll position
        const originalScroll = viewport.scrollTop;

        // DMs show newest at BOTTOM, so we need to scroll UP to load older messages
        // First, go to the BOTTOM (newest messages)
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' });
        await sleep(300);

        console.log('Tweet Bookmark: Starting at bottom, scrollTop:', viewport.scrollTop, 'scrollHeight:', viewport.scrollHeight);

        let iterations = 0;
        const scrollStep = viewport.clientHeight * 0.7; // Slightly smaller steps for better coverage
        let targetScrollTop = viewport.scrollHeight; // Track where we WANT to be
        let stuckCount = 0; // Track if scroll is stuck/fighting
        const MAX_STUCK = 3; // Max times we can be stuck at same position

        // Progressive scroll UP and scan
        while (noNewTweetsCount < MAX_STABLE_SCROLLS && iterations < MAX_ITERATIONS) {
            iterations++;
            const previousCount = foundTweets.size;

            // Scan current viewport
            const currentCards = findTweetCardsInDM();
            for (const card of currentCards) {
                if (card.tweetId && !foundTweets.has(card.tweetId)) {
                    foundTweets.set(card.tweetId, card);
                }
            }

            // Update progress toast if we found new tweets
            if (foundTweets.size > previousCount) {
                showToast(`🔍 Found ${foundTweets.size} tweets... scrolling`);
                noNewTweetsCount = 0;
            } else {
                noNewTweetsCount++;
            }

            // Safety limit - max tweets to prevent infinite loops
            if (foundTweets.size > 200) {
                console.log('Tweet Bookmark: Hit 200 tweet limit, stopping scan');
                break;
            }

            // Calculate next target position (scrolling UP toward 0)
            targetScrollTop = Math.max(0, targetScrollTop - scrollStep);

            // Force scroll to target position with instant behavior to avoid Twitter interference
            viewport.scrollTo({ top: targetScrollTop, behavior: 'instant' });

            console.log(`Tweet Bookmark: Iteration ${iterations}, target: ${targetScrollTop}, actual: ${viewport.scrollTop}, found: ${foundTweets.size}`);

            // Wait for new content to render
            await sleep(400);

            // Check if Twitter reset our scroll (we're not near our target)
            const scrollDrift = Math.abs(viewport.scrollTop - targetScrollTop);
            if (scrollDrift > 100) {
                console.log(`Tweet Bookmark: Scroll was reset! Target: ${targetScrollTop}, Actual: ${viewport.scrollTop}, Drift: ${scrollDrift}`);
                // Force scroll again
                viewport.scrollTo({ top: targetScrollTop, behavior: 'instant' });
                await sleep(200);

                // If still not at target, track as stuck
                if (Math.abs(viewport.scrollTop - targetScrollTop) > 100) {
                    stuckCount++;
                    if (stuckCount >= MAX_STUCK) {
                        console.log('Tweet Bookmark: Scroll stuck, continuing with current position');
                        // Use actual position as new target
                        targetScrollTop = viewport.scrollTop;
                        stuckCount = 0;
                    }
                }
            }

            // Check if we reached the top
            if (targetScrollTop <= 0 || viewport.scrollTop <= 10) {
                console.log('Tweet Bookmark: Reached top of conversation');
                // Do one more scan at top
                const finalCards = findTweetCardsInDM();
                for (const card of finalCards) {
                    if (card.tweetId && !foundTweets.has(card.tweetId)) {
                        foundTweets.set(card.tweetId, card);
                    }
                }
                break;
            }
        }

        // Restore scroll position
        viewport.scrollTop = originalScroll;

        console.log(`Tweet Bookmark: Scan complete. Found ${foundTweets.size} unique tweets after ${iterations} scroll iterations`);

        // Convert to array
        const tweetCards = Array.from(foundTweets.values());

        if (tweetCards.length === 0) {
            showToast('No shared tweets found in this conversation');
            return;
        }

        // Filter to only tweets YOU sent (not received)
        // Uses pre-captured isSentByMe status (captured when element was still in DOM)
        const mySharedTweets = tweetCards.filter(card => {
            console.log('Tweet Bookmark: Card sent by me?', card.isSentByMe, card.tweetLink?.getAttribute('href'));
            return card.isSentByMe;
        });

        console.log('Tweet Bookmark: Tweets sent by me:', mySharedTweets.length);

        if (mySharedTweets.length === 0) {
            // Show all tweets found if none detected as "mine" - let user decide
            console.log('Tweet Bookmark: No tweets detected as sent by user, showing all tweets');
            showToast(`Found ${tweetCards.length} tweets - showing all (couldn't detect which you sent)`);
            // Fall through to show all tweets instead
            const allTweetsData = [];
            const seenIdsInFallback = new Set();
            for (const card of tweetCards) {
                const tweetData = extractTweetDataFromDMCard(card);
                if (tweetData && tweetData.id) {
                    // Extra deduplication safeguard
                    if (seenIdsInFallback.has(tweetData.id)) {
                        console.log('Tweet Bookmark: Skipping duplicate ID in fallback:', tweetData.id);
                        continue;
                    }
                    seenIdsInFallback.add(tweetData.id);

                    const exists = await bookmarkExists(tweetData.id);
                    allTweetsData.push({
                        ...tweetData,
                        alreadySaved: exists
                    });
                }
            }
            console.log('Tweet Bookmark: Final unique tweets to show:', allTweetsData.length);
            if (allTweetsData.length > 0) {
                showDMBookmarkModal(allTweetsData, recipient);
            } else {
                showToast('No tweets to bookmark (could not extract data)');
            }
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
        console.log('%c[Tweet Bookmark v2.2.0] findTweetCardsInDM() called', 'color: blue; font-weight: bold');

        // SIMPLE APPROACH: Find all unique tweet IDs first, then build card objects
        const tweetIdToLink = new Map(); // Map<tweetId, {link, messageContainer}>

        // Helper to extract tweet ID from href
        const getTweetIdFromHref = (href) => {
            if (!href) return null;
            const match = href.match(/\/status\/(\d+)/);
            return match ? match[1] : null;
        };

        // Find the DM content area
        const dmContentArea = document.querySelector('[data-testid="DmActivityViewport"]') ||
                              document.querySelector('[data-testid="DmActivityContainer"]') ||
                              document.querySelector('main[role="main"]') ||
                              document.querySelector('main') ||
                              document.body;

        console.log('Tweet Bookmark: DM content area:', dmContentArea?.tagName, dmContentArea?.className);

        // Find ALL links to /status/ in the DM area
        const allStatusLinks = dmContentArea.querySelectorAll('a[href*="/status/"]');

        console.log('%c[Tweet Bookmark] Found ' + allStatusLinks.length + ' status links in DOM', 'color: orange; font-weight: bold');

        // Log ALL links found for debugging
        const allHrefs = [];
        for (const link of allStatusLinks) {
            const href = link.getAttribute('href');
            allHrefs.push(href);
        }
        console.log('Tweet Bookmark: All hrefs found:', allHrefs);

        // Extract unique tweet IDs
        const allTweetIds = [];
        for (const link of allStatusLinks) {
            const href = link.getAttribute('href');
            const tweetId = getTweetIdFromHref(href);

            if (!tweetId) {
                console.log('Tweet Bookmark: Could not extract ID from:', href);
                continue;
            }

            allTweetIds.push(tweetId);

            // Only keep the first occurrence of each tweet ID
            if (tweetIdToLink.has(tweetId)) {
                console.log('Tweet Bookmark: Skipping duplicate tweet ID:', tweetId);
                continue;
            }

            // Find the message container by walking up the DOM
            let messageContainer = null;
            let parent = link.parentElement;

            for (let i = 0; i < 15 && parent && parent !== dmContentArea; i++) {
                // Look for common message container patterns
                const role = parent.getAttribute('role');
                const testId = parent.getAttribute('data-testid');

                if (role === 'listitem' ||
                    role === 'article' ||
                    testId === 'messageEntry' ||
                    testId === 'cellInnerDiv' ||
                    parent.getAttribute('data-message-id')) {
                    messageContainer = parent;
                    break;
                }

                // Also check for flex containers with specific alignment (message bubbles)
                const style = window.getComputedStyle(parent);
                if (style.display === 'flex' &&
                    (style.justifyContent === 'flex-start' || style.justifyContent === 'flex-end')) {
                    if (!messageContainer) {
                        messageContainer = parent;
                    }
                }

                parent = parent.parentElement;
            }

            // Default to link's parent if no container found
            if (!messageContainer) {
                messageContainer = link.closest('div') || link.parentElement;
            }

            tweetIdToLink.set(tweetId, {
                link: link,
                messageContainer: messageContainer
            });
        }

        // Convert to array format
        const tweetCards = [];
        for (const [tweetId, data] of tweetIdToLink) {
            const cardData = {
                tweetId: tweetId, // Store the ID directly for debugging
                element: data.link.closest('div') || data.link,
                messageContainer: data.messageContainer,
                tweetLink: data.link
            };
            // Capture sent status NOW while element is in DOM (before Twitter's virtualization removes it)
            cardData.isSentByMe = checkIfSentByMe(cardData);
            tweetCards.push(cardData);
        }

        // Log summary
        console.log('%c[Tweet Bookmark] All tweet IDs found: ' + allTweetIds.join(', '), 'color: purple');
        console.log('%c[Tweet Bookmark] Unique tweet IDs (Map size): ' + tweetIdToLink.size, 'color: green; font-weight: bold');
        console.log('%c[Tweet Bookmark] Final tweetCards array length: ' + tweetCards.length, 'color: green; font-weight: bold');

        tweetCards.forEach((card, i) => {
            console.log(`Tweet Bookmark: Card ${i}: ID=${card.tweetId}, href=${card.tweetLink.getAttribute('href')}`);
        });

        return tweetCards;
    }

    // Determine if a message containing a tweet was sent by the current user
    // Called at scan time when element is still in DOM to capture positioning data
    function checkIfSentByMe(tweetCard) {
        const messageContainer = tweetCard.messageContainer;
        const cardElement = tweetCard.element;

        // Strategy 1: Check for data-testid attributes that indicate sent messages
        if (messageContainer) {
            const sentIndicators = messageContainer.querySelectorAll('[data-testid*="sent"], [data-testid*="outgoing"]');
            if (sentIndicators.length > 0) return true;
        }

        // Check the card element itself
        const sentMarker = cardElement?.closest('[data-testid*="sent"]') ||
                          cardElement?.closest('[data-testid*="outgoing"]');
        if (sentMarker) return true;

        // Strategy 2: Check positioning (sent messages typically on right)
        const targetElement = cardElement || messageContainer;
        if (targetElement) {
            const rect = targetElement.getBoundingClientRect();
            const viewportWidth = window.innerWidth;

            // If the element is positioned in the right 40% of the viewport, it's likely sent
            if (rect.left > viewportWidth * 0.5 && rect.right > viewportWidth * 0.6) {
                return true;
            }

            // Check parent container positioning
            const parentRect = targetElement.parentElement?.getBoundingClientRect();
            if (parentRect && parentRect.width > 100) {
                const isRightAligned = rect.right > (parentRect.left + parentRect.width * 0.6);
                if (isRightAligned) return true;
            }
        }

        // Strategy 3: Check for flex alignment indicators
        let element = cardElement || messageContainer;
        for (let i = 0; i < 8 && element; i++) {
            const style = window.getComputedStyle(element);

            // Sent messages often use flex-end or right alignment
            if (style.justifyContent === 'flex-end' ||
                style.alignItems === 'flex-end' ||
                style.alignSelf === 'flex-end' ||
                style.marginLeft === 'auto' ||
                style.marginInlineStart === 'auto') {
                return true;
            }

            // Check for flex-direction: row-reverse (common in RTL-style sent messages)
            if (style.display === 'flex' && style.flexDirection === 'row-reverse') {
                return true;
            }

            element = element.parentElement;
        }

        // Strategy 4: Check for blue bubble background (Twitter's sent message color)
        element = cardElement || messageContainer;
        for (let i = 0; i < 8 && element; i++) {
            const bg = window.getComputedStyle(element).backgroundColor;
            // Twitter's sent message color is typically blue/accent (rgb(29, 155, 240))
            // Also check for variations with different spacing
            if (bg.includes('29, 155, 240') ||
                bg.includes('29,155,240') ||
                bg.includes('1d9bf0') ||
                bg.includes('rgb(29, 155, 240)')) {
                return true;
            }
            element = element.parentElement;
        }

        // Strategy 5: Check for specific CSS classes that might indicate sent status
        element = cardElement || messageContainer;
        for (let i = 0; i < 5 && element; i++) {
            const classList = element.classList;
            if (classList) {
                // Check for common class name patterns indicating sent/outgoing
                for (const className of classList) {
                    const lowerClass = className.toLowerCase();
                    if (lowerClass.includes('sent') ||
                        lowerClass.includes('outgoing') ||
                        lowerClass.includes('self') ||
                        lowerClass.includes('mine')) {
                        return true;
                    }
                }
            }
            element = element.parentElement;
        }

        // Strategy 6: Check if message bubble styling indicates sent (for new format)
        if (messageContainer) {
            const bubble = messageContainer.querySelector('[dir="auto"]')?.closest('div');
            if (bubble) {
                const bgColor = window.getComputedStyle(bubble).backgroundColor;
                if (bgColor.includes('29, 155, 240') || bgColor.includes('1d9bf0')) {
                    return true;
                }
            }
        }

        // Default: assume it's received if we can't determine
        return false;
    }

    // Extract tweet data from a DM embedded tweet card
    function extractTweetDataFromDMCard(tweetCard) {
        try {
            const { element, tweetLink, tweetId: storedTweetId, messageContainer } = tweetCard;

            // Get tweet URL from the link
            let url = '';
            let tweetId = storedTweetId; // Use pre-extracted ID if available

            if (tweetLink) {
                const href = tweetLink.getAttribute('href');
                if (href) {
                    url = href.startsWith('http') ? href : 'https://x.com' + href;
                    if (!tweetId) {
                        tweetId = extractTweetId(url);
                    }
                }
            }

            if (!tweetId) {
                console.log('Tweet Bookmark: No tweet ID for extraction');
                return null;
            }

            // Try to extract content - search in multiple areas
            let content = '';
            const searchAreas = [element, messageContainer, tweetLink?.parentElement].filter(Boolean);

            for (const area of searchAreas) {
                if (content) break;

                // Try specific tweet text first
                let textEl = area.querySelector?.('[data-testid="tweetText"]');
                if (!textEl) {
                    // Try dir="auto" with lang attribute (actual text content)
                    textEl = area.querySelector?.('[dir="auto"][lang]');
                }
                if (!textEl) {
                    // Fallback to any dir="auto"
                    textEl = area.querySelector?.('[dir="auto"]');
                }

                if (textEl) {
                    content = textEl.innerText?.trim() || '';
                }
            }

            // If still no content, try the link text itself
            if (!content && tweetLink) {
                content = tweetLink.innerText?.trim() || '';
            }

            // Try to extract author info - search more aggressively
            let author = '';
            let authorName = '';

            // Strategy A: Search in immediate areas for profile links
            for (const area of searchAreas) {
                if (author && author !== '@i') break;
                if (!area || !area.querySelectorAll) continue;

                // Look for profile links (not status links, not /i/)
                const links = area.querySelectorAll('a[href^="/"]');
                for (const link of links) {
                    const href = link.getAttribute('href');
                    // Valid username: starts with /, 1-15 chars, alphanumeric/underscore only
                    if (href && /^\/[a-zA-Z0-9_]{1,15}$/.test(href) && href !== '/i' && !href.includes('/status')) {
                        author = '@' + href.substring(1);
                        const nameSpan = link.querySelector('span');
                        if (nameSpan) {
                            authorName = nameSpan.innerText?.trim() || '';
                        }
                        break;
                    }
                }
            }

            // Strategy B: Search wider DOM tree for [data-testid="User-Name"]
            if (!author || author === '@i') {
                let searchRoot = element || messageContainer;
                for (let i = 0; i < 10 && searchRoot && searchRoot.parentElement; i++) {
                    searchRoot = searchRoot.parentElement;
                    const userNameEl = searchRoot.querySelector('[data-testid="User-Name"] a');
                    if (userNameEl) {
                        const href = userNameEl.getAttribute('href');
                        if (href && /^\/[a-zA-Z0-9_]{1,15}$/.test(href) && href !== '/i') {
                            author = '@' + href.substring(1);
                            const nameSpan = userNameEl.querySelector('span');
                            if (nameSpan) {
                                authorName = nameSpan.innerText?.trim() || '';
                            }
                            break;
                        }
                    }
                }
            }

            // Strategy C: Find profile image and get parent link
            if (!author || author === '@i') {
                let searchRoot = element || messageContainer;
                for (let i = 0; i < 10 && searchRoot && searchRoot.parentElement; i++) {
                    searchRoot = searchRoot.parentElement;
                    const profileImgs = searchRoot.querySelectorAll('img[src*="profile_images"]');
                    for (const img of profileImgs) {
                        const parentLink = img.closest('a[href^="/"]');
                        if (parentLink) {
                            const href = parentLink.getAttribute('href');
                            if (href && /^\/[a-zA-Z0-9_]{1,15}$/.test(href) && href !== '/i') {
                                author = '@' + href.substring(1);
                                break;
                            }
                        }
                    }
                    if (author && author !== '@i') break;
                }
            }

            // Strategy D: Extract from URL if author not found (but skip /i/status/ format)
            if (!author || author === '@i') {
                if (url) {
                    const urlMatch = url.match(/x\.com\/([a-zA-Z0-9_]{1,15})\/status/);
                    if (urlMatch && urlMatch[1] !== 'i') {
                        author = '@' + urlMatch[1];
                    }
                }
            }

            // Strategy E: Try to find @mentions in text content (first @mention is often the author)
            if (!author || author === '@i') {
                for (const area of searchAreas) {
                    if (author && author !== '@i') break;
                    if (!area) continue;

                    const text = area.textContent || '';
                    // Look for @username pattern
                    const matches = text.match(/@([a-zA-Z0-9_]{1,15})/g);
                    if (matches) {
                        for (const match of matches) {
                            if (match !== '@i') {
                                author = match;
                                break;
                            }
                        }
                    }
                }
            }

            // Strategy F: Extract first @mention from tweet content itself
            if ((!author || author === '@i') && content) {
                const firstMention = content.match(/@([a-zA-Z0-9_]{1,15})/);
                if (firstMention && firstMention[1] !== 'i') {
                    author = '@' + firstMention[1];
                }
            }

            // Default to unknown
            if (!author || author === '@i') {
                author = '@unknown';
                authorName = 'Tweet Author';
            }

            console.log(`Tweet Bookmark: Extracted - ID: ${tweetId}, Author: ${author}, Content: ${content.substring(0, 50)}...`);

            return {
                id: tweetId,
                url: url,
                content: content.substring(0, 500),
                author: author,
                authorName: authorName || author,
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
