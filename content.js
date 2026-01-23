// Tweet Bookmark Extension - Content Script
// Runs on twitter.com and x.com
// Version: 2.8.0 - Fix timing & loading detection for consistent 300+ tweet discovery

(function () {
    'use strict';

    // VERSION CHECK - Log to confirm latest code is running
    console.log('%c[Tweet Bookmark v2.8.0] Content script loaded', 'color: green; font-weight: bold');

    // Track which tweets already have our button
    const processedTweets = new Set();
    let lastUrl = location.href;
    let isProcessing = false;
    let processingTimeout = null;

    // DM scanning state
    let dmScanButton = null;
    let isDMPage = false;

    // Robust DM scan state management for 1000+ tweets
    let dmScanState = {
        isScanning: false,
        isPaused: false,
        isCancelled: false,
        foundTweets: new Map(),
        scrollProgress: 0,
        currentIteration: 0,
        maxIterations: 3000,
        startTime: null,
        lastCheckpoint: null,
        viewport: null,
        recipient: '',
        // Adaptive scrolling state
        consecutiveEmptyScrolls: 0,
        scrollStepMultiplier: 0.35,
        scrollDelay: 500,
        // Loading-aware scanning config
        loadingCheckEnabled: true,
        maxLoadingWaitMs: 15000,
        lastScrollHeight: 0
    };

    // Scan progress panel element reference
    let scanProgressPanel = null;

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

    // Reset scan state to initial values
    function resetScanState() {
        dmScanState.isScanning = false;
        dmScanState.isPaused = false;
        dmScanState.isCancelled = false;
        dmScanState.foundTweets.clear();
        dmScanState.scrollProgress = 0;
        dmScanState.currentIteration = 0;
        dmScanState.startTime = null;
        dmScanState.lastCheckpoint = null;
        dmScanState.viewport = null;
        dmScanState.recipient = '';
        dmScanState.consecutiveEmptyScrolls = 0;
        dmScanState.scrollStepMultiplier = 0.35;
        dmScanState.scrollDelay = 400;
    }

    // Create floating progress panel for scan
    function createScanProgressPanel() {
        if (scanProgressPanel) {
            scanProgressPanel.remove();
        }

        scanProgressPanel = document.createElement('div');
        scanProgressPanel.className = 'dm-scan-progress-panel';
        scanProgressPanel.innerHTML = `
            <div class="progress-header">
                <span class="progress-title">Scanning DM...</span>
                <span class="progress-stats">Found: <span class="tweets-count">0</span> tweets</span>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar-fill"></div>
                <span class="progress-percent">0%</span>
            </div>
            <div class="progress-controls">
                <button class="pause-btn" aria-label="Pause scan">⏸️ Pause</button>
                <button class="cancel-btn" aria-label="Cancel scan">✖️ Cancel</button>
            </div>
            <div class="progress-details">
                <span class="scroll-position">Starting scan...</span>
            </div>
        `;

        document.body.appendChild(scanProgressPanel);

        // Wire up button event handlers
        const pauseBtn = scanProgressPanel.querySelector('.pause-btn');
        const cancelBtn = scanProgressPanel.querySelector('.cancel-btn');

        pauseBtn.addEventListener('click', () => {
            if (dmScanState.isPaused) {
                // Resume
                dmScanState.isPaused = false;
                pauseBtn.textContent = '⏸️ Pause';
                updateScanProgress({ status: 'scanning' });
            } else {
                // Pause
                dmScanState.isPaused = true;
                pauseBtn.textContent = '▶️ Resume';
                updateScanProgress({ status: 'paused' });
            }
        });

        cancelBtn.addEventListener('click', () => {
            dmScanState.isCancelled = true;
            dmScanState.isPaused = false; // Unpause to allow loop to exit
        });

        return scanProgressPanel;
    }

    // Remove progress panel
    function removeScanProgressPanel() {
        if (scanProgressPanel) {
            scanProgressPanel.remove();
            scanProgressPanel = null;
        }
    }

    // Update progress panel with current state
    function updateScanProgress({ tweetsFound, scrollPercent, iteration, status }) {
        if (!scanProgressPanel) return;

        const tweetsCountEl = scanProgressPanel.querySelector('.tweets-count');
        const progressFill = scanProgressPanel.querySelector('.progress-bar-fill');
        const progressPercent = scanProgressPanel.querySelector('.progress-percent');
        const scrollPosition = scanProgressPanel.querySelector('.scroll-position');
        const titleEl = scanProgressPanel.querySelector('.progress-title');

        if (tweetsFound !== undefined) {
            tweetsCountEl.textContent = tweetsFound;
        }

        if (scrollPercent !== undefined) {
            const percent = Math.min(100, Math.max(0, scrollPercent));
            progressFill.style.width = `${percent}%`;
            progressPercent.textContent = `${Math.round(percent)}%`;
        }

        if (iteration !== undefined) {
            scrollPosition.textContent = `Iteration ${iteration} / ${dmScanState.maxIterations}`;
        }

        if (status === 'paused') {
            titleEl.textContent = '⏸️ Scan Paused';
            scanProgressPanel.classList.add('paused');
        } else if (status === 'scanning') {
            titleEl.textContent = '🔍 Scanning DM...';
            scanProgressPanel.classList.remove('paused');
        } else if (status === 'completing') {
            titleEl.textContent = '✨ Completing...';
        }
    }

    // Calculate scroll progress percentage
    function calculateScrollProgress(viewport, targetScrollTop, totalScrollHeight) {
        if (!viewport || totalScrollHeight <= 0) return 0;
        // We scroll from bottom (scrollHeight) to top (0)
        // Progress = how far we've scrolled up from bottom
        const scrolledDistance = totalScrollHeight - targetScrollTop;
        return (scrolledDistance / totalScrollHeight) * 100;
    }

    // Check if scanning should continue
    function shouldContinueScanning() {
        return dmScanState.isScanning &&
               !dmScanState.isCancelled &&
               dmScanState.currentIteration < dmScanState.maxIterations;
    }

    // Wait for resume when paused
    function waitForResume() {
        return new Promise(resolve => {
            const checkInterval = setInterval(() => {
                if (!dmScanState.isPaused || dmScanState.isCancelled) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
        });
    }

    // Finalize scan (called on complete, cancel, or interrupt)
    function finalizeScan(reason) {
        // Just call processScanResults directly, it handles the UI cleanup
        processScanResults(reason);
    }

    // Process scan results and show selection modal
    async function processScanResults(reason) {
        console.log(`Tweet Bookmark: Processing scan results (${reason})...`);

        // Remove progress panel
        if (scanProgressPanel) {
            scanProgressPanel.remove();
            scanProgressPanel = null;
        }

        dmScanState.isScanning = false;
        dmScanState.isPaused = false;
        removeDMScanButton(); // Clean up button state

        // Re-inject button after a moment
        setTimeout(() => {
            if (checkIsDMPage()) {
                createDMScanButton();
            }
        }, 1000);

        try {
            // Get extracted data
            const tweetsData = Array.from(dmScanState.foundTweets.values());
            const uniqueCount = tweetsData.length;

            console.log(`Tweet Bookmark: Scan finished with ${uniqueCount} unique tweets`);

            if (uniqueCount === 0) {
                if (reason === 'cancelled') {
                    showToast('Scan cancelled');
                } else {
                    showToast('No shared tweets found in this conversation');
                }
                return;
            }

            // Since we extracted data *during* the scan, we don't need to loop through DOM elements again.
            // Just filter out any invalid entries.
            const validTweets = tweetsData.filter(t => t && t.id && t.content !== undefined);

            // Sort logic: Twitter IDs are chronological. Sort by ID ascending (oldest first) or descending (newest first).
            // Let's default to chronological order (oldest -> newest) for the list view, or whatever user prefers.
            // The modal usually shows a list.
            validTweets.sort((a, b) => {
                if (a.id.length !== b.id.length) {
                    return a.id.length - b.id.length;
                }
                return a.id.localeCompare(b.id);
            });

            // Check sent status (this was also captured during scan)
            // But we might want to do a sanity check or fallback if isSentByMe is undefined
            validTweets.forEach(t => {
                if (typeof t.isSentByMe === 'undefined') {
                    t.isSentByMe = false; // Default to received if unknown
                }
            });

            // Check which are already saved (async operation)
            for (const tweet of validTweets) {
                tweet.alreadySaved = await bookmarkExists(tweet.id);
            }

            console.log('Tweet Bookmark: Showing modal with', validTweets.length, 'tweets');
            showDMBookmarkModal(validTweets, dmScanState.recipient);

        } catch (error) {
            console.error('Tweet Bookmark: Error processing scan results:', error);
            showToast('Error processing scan results', 'error');
        }
    }

    // Detect tweet type from card element
    function detectTweetType(cardElement, tweetLink) {
        const href = tweetLink?.href || tweetLink?.getAttribute('href') || '';
        const cardContent = cardElement?.textContent || '';

        const hasMedia = !!(cardElement?.querySelector('img[src*="pbs.twimg"], video, [data-testid="tweetPhoto"]'));
        const hasQuote = href.includes('/status/') && !!(cardElement?.querySelector('[data-testid="tweet"] [data-testid="tweet"], [data-testid="quoteTweet"]'));
        const mediaCount = cardElement?.querySelectorAll('img[src*="pbs.twimg"], [data-testid="tweetPhoto"]').length || 0;
        const isThread = cardContent.includes('Show this thread') || !!(cardElement?.querySelector('[aria-label*="thread"]'));

        let type = 'regular';
        if (hasQuote) {
            type = 'quote';
        } else if (hasMedia) {
            type = 'media';
        } else if (isThread) {
            type = 'thread';
        }

        return {
            type,
            hasMedia,
            hasQuote,
            mediaCount,
            isThread
        };
    }

    // Detect if Twitter is currently loading content in the viewport
    function isTwitterLoading(viewport) {
        if (!viewport) return false;

        // Strategy 1: Check for spinner elements (Twitter's loading indicators)
        const spinnerSelectors = [
            '[data-testid="spinner"]',
            '[role="progressbar"]',
            '[data-testid="loading"]',
            'svg[aria-label*="Loading"]',
            '[aria-label*="Loading"]'
        ];

        for (const selector of spinnerSelectors) {
            const spinner = viewport.querySelector(selector) || document.querySelector(selector);
            if (spinner) {
                // Check if spinner is visible (not hidden)
                const rect = spinner.getBoundingClientRect();
                const style = window.getComputedStyle(spinner);
                if (rect.width > 0 && rect.height > 0 &&
                    style.visibility !== 'hidden' && style.display !== 'none') {
                    console.log('Tweet Bookmark: Loading detected via spinner:', selector);
                    return true;
                }
            }
        }

        // Strategy 2: Check for animated loading elements
        const animatedElements = viewport.querySelectorAll('[class*="loading"], [class*="spinner"]');
        for (const el of animatedElements) {
            const style = window.getComputedStyle(el);
            if (style.animationName && style.animationName !== 'none') {
                console.log('Tweet Bookmark: Loading detected via animation');
                return true;
            }
        }

        // Strategy 3: Check for placeholder tweet cards (cellInnerDiv without tweet links)
        const dmContentArea = viewport.closest?.('[data-testid="DmActivityViewport"]') ||
                              document.querySelector('[data-testid="DmActivityViewport"]') ||
                              viewport;

        const cellInnerDivs = dmContentArea.querySelectorAll('[data-testid="cellInnerDiv"]');
        for (const cell of cellInnerDivs) {
            // Check if this cell is visible in viewport
            const rect = cell.getBoundingClientRect();
            if (rect.height === 0 || rect.top > window.innerHeight || rect.bottom < 0) {
                continue; // Skip off-screen cells
            }

            // A placeholder is a cell that exists but has no tweet link inside yet
            const hasTweetLink = cell.querySelector('a[href*="/status/"]');
            if (!hasTweetLink) {
                // Check if cell has minimal content (placeholder state)
                const hasContent = cell.textContent.trim().length > 20;
                if (!hasContent) {
                    console.log('Tweet Bookmark: Loading detected - placeholder cellInnerDiv found');
                    return true;
                }
            }

            // Strategy 3b: Check for "x.com" placeholder cards
            // Twitter shows "x.com" placeholder text while tweet content loads
            const text = cell.textContent.trim();
            if (text === 'x.com' || (text.length < 15 && text.includes('x.com') && !hasTweetLink)) {
                console.log('Tweet Bookmark: Loading detected - x.com placeholder card');
                return true;
            }
        }

        // Strategy 4: Check if scrollHeight is actively changing (content loading)
        const currentScrollHeight = viewport.scrollHeight;
        if (dmScanState.lastScrollHeight > 0) {
            const scrollHeightChanged = Math.abs(currentScrollHeight - dmScanState.lastScrollHeight) > 100;
            if (scrollHeightChanged) {
                console.log('Tweet Bookmark: Loading detected - scrollHeight changed from',
                            dmScanState.lastScrollHeight, 'to', currentScrollHeight);
                dmScanState.lastScrollHeight = currentScrollHeight;
                return true;
            }
        }
        dmScanState.lastScrollHeight = currentScrollHeight;

        // Strategy 5: Check for rate limit or confirmation popups
        const confirmationSheet = document.querySelector('[data-testid="confirmationSheet"]');
        if (confirmationSheet) {
            console.log('Tweet Bookmark: Twitter confirmation/warning popup detected');
            return true;
        }

        // Strategy 6: Check for rate limit text
        const bodyText = document.body.innerText;
        if (bodyText.includes('Rate limit exceeded') ||
            bodyText.includes('Unlock more posts') ||
            bodyText.includes('Something went wrong')) {
             console.log('Tweet Bookmark: Rate limit or error text detected');
             return true;
        }

        return false;
    }

    // Wait for loading to complete before continuing scan
    async function waitForLoadingToComplete(viewport, maxWaitMs = 15000) {
        const startTime = Date.now();
        const pollInterval = 250;
        let isLoading = isTwitterLoading(viewport);

        if (!isLoading) {
            return; // Not loading, no need to wait
        }

        console.log('Tweet Bookmark: Waiting for content to load...');

        // Update progress panel to show waiting status
        if (scanProgressPanel) {
            const scrollPosition = scanProgressPanel.querySelector('.scroll-position');
            if (scrollPosition) {
                scrollPosition.textContent = 'Waiting for content to load...';
            }
            scanProgressPanel.classList.add('waiting');
        }

        // Poll until loading completes or timeout
        while (isLoading && (Date.now() - startTime) < maxWaitMs) {
            await sleep(pollInterval);

            // Check if scan was cancelled or paused during wait
            if (dmScanState.isCancelled) {
                console.log('Tweet Bookmark: Scan cancelled during loading wait');
                break;
            }

            if (dmScanState.isPaused) {
                // If paused, wait for resume before continuing
                await waitForResume();
                if (dmScanState.isCancelled) break;
            }

            isLoading = isTwitterLoading(viewport);
        }

        // Remove waiting class from progress panel
        if (scanProgressPanel) {
            scanProgressPanel.classList.remove('waiting');
        }

        if (isLoading) {
            console.log(`Tweet Bookmark: Loading timeout after ${maxWaitMs}ms, continuing scan`);
        } else {
            const waitedMs = Date.now() - startTime;
            console.log(`Tweet Bookmark: Loading completed after ${waitedMs}ms`);
        }

        // Give Twitter a moment to render the new content
        await sleep(200);
    }

    // Extract data from a tweet card immediately (to avoid virtualization issues)
    function processCardData(card) {
        try {
            // First, extract all data from DOM while it's still available
            const extractedData = extractTweetDataFromDMCard(card);

            if (!extractedData) return null;

            // Detect tweet type if not already done
            if (!card.tweetType) {
                const typeInfo = detectTweetType(card.element, card.tweetLink);
                extractedData.tweetType = typeInfo.type;
                extractedData.hasMedia = typeInfo.hasMedia;
                extractedData.mediaCount = typeInfo.mediaCount;
                extractedData.isQuote = typeInfo.hasQuote;
                extractedData.isThread = typeInfo.isThread;
            } else {
                // Copy pre-detected type info
                extractedData.tweetType = card.tweetType;
                extractedData.hasMedia = card.hasMedia;
                extractedData.mediaCount = card.mediaCount;
                extractedData.isQuote = card.isQuote;
                extractedData.isThread = card.isThread;
            }

            // Copy sent status
            extractedData.isSentByMe = card.isSentByMe;

            return extractedData;
        } catch (error) {
            console.error('Tweet Bookmark: Error processing card data:', error);
            return null;
        }
    }

    // Scan DM conversation for shared tweets with progressive scrolling
    async function scanDMForTweets() {
        // Prevent multiple concurrent scans
        if (dmScanState.isScanning) {
            showToast('Scan already in progress');
            return;
        }

        const recipient = extractDMRecipient();

        // Find the ACTUAL scrollable DM container (not <main>, but the inner scrollable div)
        let viewport = null;

        // Try specific Twitter DM selectors first
        const dmSelectors = [
            '[data-testid="DmActivityViewport"]',
            '[data-testid="DmScrollerContainer"]',
            '[data-testid="DMDrawer"] [data-testid="ScrollSnap-List"]',
            'section[role="region"] > div > div'
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

        // Initialize scan state
        resetScanState();
        dmScanState.isScanning = true;
        dmScanState.startTime = Date.now();
        dmScanState.viewport = viewport;
        dmScanState.recipient = recipient;

        // Create and show progress panel
        createScanProgressPanel();
        updateScanProgress({ tweetsFound: 0, scrollPercent: 0, iteration: 0, status: 'scanning' });

        // Constants for robust scanning
        const MAX_STABLE_SCROLLS = 30;  // More tolerance for sparse areas and Twitter virtualization
        const MAX_TWEETS = 5000;        // Hard safety limit for 1000+ tweets
        let noNewTweetsCount = 0;

        // Save original scroll position
        const originalScroll = viewport.scrollTop;
        const totalScrollHeight = viewport.scrollHeight;

        // DMs show newest at BOTTOM, so we need to scroll UP to load older messages
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' });
        await sleep(600);
        await waitForLoadingToComplete(viewport, 5000);  // Up to 5s for initial load

        console.log('Tweet Bookmark: Starting at bottom, scrollTop:', viewport.scrollTop, 'scrollHeight:', viewport.scrollHeight);

        // Scan current viewport BEFORE starting scroll loop
        const initialCards = findTweetCardsInDM();
        for (const card of initialCards) {
            try {
                if (card.tweetId && !dmScanState.foundTweets.has(card.tweetId)) {
                    const data = processCardData(card);
                    if (data) {
                        dmScanState.foundTweets.set(card.tweetId, data);
                    }
                }
            } catch (err) {
                console.error('Tweet Bookmark: Error processing initial card:', err);
            }
        }
        console.log('Tweet Bookmark: Initial scan found', dmScanState.foundTweets.size, 'tweets');

        let scrollStep = viewport.clientHeight * dmScanState.scrollStepMultiplier;
        let targetScrollTop = viewport.scrollHeight;
        let minScrollReached = viewport.scrollHeight;
        let consecutiveResets = 0;
        const MAX_RESETS_AT_POSITION = 3;
        let lastProgressUpdate = Date.now();

        // Progressive scroll UP and scan
        while (shouldContinueScanning() && noNewTweetsCount < MAX_STABLE_SCROLLS) {
            // Check for pause
            if (dmScanState.isPaused) {
                await waitForResume();
                if (dmScanState.isCancelled) break;
            }

            dmScanState.currentIteration++;
            const previousCount = dmScanState.foundTweets.size;

            // Scan current viewport
            try {
                const currentCards = findTweetCardsInDM();
                for (const card of currentCards) {
                    if (card.tweetId && !dmScanState.foundTweets.has(card.tweetId)) {
                        const data = processCardData(card);
                        if (data) {
                            dmScanState.foundTweets.set(card.tweetId, data);
                        }
                    }
                }
            } catch (loopError) {
                console.error('Tweet Bookmark: Error in main scan loop:', loopError);
            }

            // Update progress (throttled to avoid UI jank)
            const now = Date.now();
            if (now - lastProgressUpdate > 100) {
                const scrollProgress = calculateScrollProgress(viewport, targetScrollTop, totalScrollHeight);
                updateScanProgress({
                    tweetsFound: dmScanState.foundTweets.size,
                    scrollPercent: scrollProgress,
                    iteration: dmScanState.currentIteration
                });
                lastProgressUpdate = now;
            }

            // Check if we found new tweets
            if (dmScanState.foundTweets.size > previousCount) {
                noNewTweetsCount = 0;
                dmScanState.consecutiveEmptyScrolls = 0;
            } else {
                // Check if Twitter is loading before counting as empty
                if (dmScanState.loadingCheckEnabled && isTwitterLoading(viewport)) {
                    console.log('Tweet Bookmark: Loading detected, waiting for content...');
                    await waitForLoadingToComplete(viewport, dmScanState.maxLoadingWaitMs);

                    // Rescan after loading completes to pick up newly loaded tweets
                    try {
                        const postLoadCards = findTweetCardsInDM();
                        for (const card of postLoadCards) {
                            if (card.tweetId && !dmScanState.foundTweets.has(card.tweetId)) {
                                const data = processCardData(card);
                                if (data) {
                                    dmScanState.foundTweets.set(card.tweetId, data);
                                }
                            }
                        }
                    } catch (loadError) {
                        console.error('Tweet Bookmark: Error in post-load scan:', loadError);
                    }

                    // Only count as empty if still no new tweets after loading
                    if (dmScanState.foundTweets.size > previousCount) {
                        noNewTweetsCount = 0;
                        dmScanState.consecutiveEmptyScrolls = 0;
                    } else if (viewport.scrollTop <= minScrollReached + scrollStep) {
                        noNewTweetsCount++;
                        dmScanState.consecutiveEmptyScrolls++;
                    }
                } else if (viewport.scrollTop <= minScrollReached + scrollStep) {
                    noNewTweetsCount++;
                    dmScanState.consecutiveEmptyScrolls++;
                }
            }

            // Adaptive scrolling: adjust step size based on consecutive empty scrolls
            if (dmScanState.consecutiveEmptyScrolls >= 5) {
                dmScanState.scrollStepMultiplier = 0.3;
                scrollStep = viewport.clientHeight * 0.3;
            } else if (dmScanState.consecutiveEmptyScrolls >= 3) {
                dmScanState.scrollStepMultiplier = 0.35;
                scrollStep = viewport.clientHeight * 0.35;
            }

            // Direction reversal: every 30 scrolls, briefly reverse direction to trigger different Twitter virtualization
            if (dmScanState.currentIteration % 30 === 0 && dmScanState.currentIteration > 0) {
                const currentPos = viewport.scrollTop;
                const viewportHeight = viewport.clientHeight;
                // Quick reverse scroll (scroll DOWN briefly)
                const reverseTarget = Math.min(currentPos + viewportHeight * 0.5, viewport.scrollHeight);
                viewport.scrollTo({ top: reverseTarget, behavior: 'instant' });
                await sleep(350);
                console.log(`Tweet Bookmark: Direction reversal at iteration ${dmScanState.currentIteration}, scrolled to ${reverseTarget}`);
                // Scan at reversed position to catch any missed tweets
                try {
                    const reverseScanCards = findTweetCardsInDM();
                    for (const card of reverseScanCards) {
                        if (card.tweetId && !dmScanState.foundTweets.has(card.tweetId)) {
                            const data = processCardData(card);
                            if (data) {
                                dmScanState.foundTweets.set(card.tweetId, data);
                            }
                        }
                    }
                } catch (revError) {
                    console.error('Tweet Bookmark: Error in reverse scan:', revError);
                }
                // Return to previous position to continue scanning upward
                viewport.scrollTo({ top: currentPos, behavior: 'instant' });
                await sleep(250);
            }

            // Safety limit - max tweets to prevent infinite loops
            if (dmScanState.foundTweets.size > MAX_TWEETS) {
                console.log(`Tweet Bookmark: Hit ${MAX_TWEETS} tweet limit, stopping scan`);
                break;
            }

            // Calculate next target position (scrolling UP toward 0)
            targetScrollTop = Math.max(0, targetScrollTop - scrollStep);

            // Use smaller scroll step when loading detected (content still appearing)
            if (dmScanState.consecutiveEmptyScrolls === 0 && isTwitterLoading(viewport)) {
                scrollStep = viewport.clientHeight * 0.3;
                console.log('Tweet Bookmark: Using smaller scroll step due to loading');
            }

            // Force scroll to target position
            viewport.scrollTo({ top: targetScrollTop, behavior: 'instant' });

            console.log(`Tweet Bookmark: Iteration ${dmScanState.currentIteration}, target: ${targetScrollTop}, actual: ${viewport.scrollTop}, found: ${dmScanState.foundTweets.size}`);

            // Wait for new content to render
            await sleep(dmScanState.scrollDelay);

            // Update minimum scroll position reached
            if (viewport.scrollTop < minScrollReached) {
                minScrollReached = viewport.scrollTop;
                consecutiveResets = 0;
            }

            // Check if Twitter reset our scroll
            const scrollDrift = Math.abs(viewport.scrollTop - targetScrollTop);
            if (scrollDrift > 100) {
                console.log(`Tweet Bookmark: Scroll was reset! Target: ${targetScrollTop}, Actual: ${viewport.scrollTop}, Min reached: ${minScrollReached}`);

                viewport.scrollTo({ top: targetScrollTop, behavior: 'instant' });
                await sleep(200);

                if (Math.abs(viewport.scrollTop - targetScrollTop) > 100) {
                    consecutiveResets++;

                    if (consecutiveResets >= MAX_RESETS_AT_POSITION) {
                        if (minScrollReached < viewport.scrollHeight - scrollStep) {
                            console.log(`Tweet Bookmark: Can't reach ${targetScrollTop}, trying smaller steps from ${minScrollReached}`);
                            targetScrollTop = minScrollReached;
                            consecutiveResets = 0;
                            // Reduce scroll step for difficult areas
                            scrollStep = viewport.clientHeight * 0.3;
                        } else {
                            console.log('Tweet Bookmark: Cannot scroll - Twitter blocking. Stopping scan.');
                            break;
                        }
                    }
                } else {
                    consecutiveResets = 0;
                }
            }

            // Check if we reached the top
            if (targetScrollTop <= 0 || viewport.scrollTop <= 10) {
                console.log('Tweet Bookmark: Reached top of conversation');
                // Do one more scan at top
                try {
                    const finalCards = findTweetCardsInDM();
                    for (const card of finalCards) {
                        if (card.tweetId && !dmScanState.foundTweets.has(card.tweetId)) {
                            const data = processCardData(card);
                            if (data) {
                                dmScanState.foundTweets.set(card.tweetId, data);
                            }
                        }
                    }
                } catch (finalError) {
                    console.error('Tweet Bookmark: Error in final top scan:', finalError);
                }
                break;
            }

            // Yield to UI thread periodically
            if (dmScanState.currentIteration % 10 === 0) {
                await new Promise(r => setTimeout(r, 0));
            }
        }

        // ========== PASS 2: Scroll DOWN (Top to Bottom) ==========
        if (!dmScanState.isCancelled && dmScanState.foundTweets.size < MAX_TWEETS) {
            console.log('%c[Tweet Bookmark] Starting Pass 2: Top → Bottom', 'color: orange; font-weight: bold');
            updateScanProgress({ status: 'scanning', pass: 2 });

            // Start from top
            viewport.scrollTo({ top: 0, behavior: 'instant' });
            await sleep(400);

            let pass2Target = 0;
            const pass2Step = viewport.clientHeight * 0.3;
            let pass2EmptyCount = 0;
            const pass2MaxEmpty = 12;

            while (!dmScanState.isCancelled && pass2EmptyCount < pass2MaxEmpty && pass2Target < viewport.scrollHeight) {
                if (dmScanState.isPaused) {
                    await waitForResume();
                    if (dmScanState.isCancelled) break;
                }

                dmScanState.currentIteration++;
                const prevCount = dmScanState.foundTweets.size;

                // Collect tweets
                const cards = findTweetCardsInDM();
                for (const card of cards) {
                    if (card.tweetId && !dmScanState.foundTweets.has(card.tweetId)) {
                        const typeInfo = detectTweetType(card.element, card.tweetLink);
                        card.tweetType = typeInfo.type;
                        card.hasMedia = typeInfo.hasMedia;
                        card.mediaCount = typeInfo.mediaCount;
                        card.isQuote = typeInfo.hasQuote;
                        card.isThread = typeInfo.isThread;
                        dmScanState.foundTweets.set(card.tweetId, card);
                    }
                }

                if (dmScanState.foundTweets.size > prevCount) {
                    pass2EmptyCount = 0;
                } else {
                    // Check for loading before counting as empty
                    if (dmScanState.loadingCheckEnabled && isTwitterLoading(viewport)) {
                        await waitForLoadingToComplete(viewport, 10000);
                        // Rescan after loading
                        const postLoadCards = findTweetCardsInDM();
                        for (const card of postLoadCards) {
                            if (card.tweetId && !dmScanState.foundTweets.has(card.tweetId)) {
                                const typeInfo = detectTweetType(card.element, card.tweetLink);
                                card.tweetType = typeInfo.type;
                                card.hasMedia = typeInfo.hasMedia;
                                card.mediaCount = typeInfo.mediaCount;
                                card.isQuote = typeInfo.hasQuote;
                                card.isThread = typeInfo.isThread;
                                dmScanState.foundTweets.set(card.tweetId, card);
                            }
                        }
                        // Only count as empty if still no new tweets
                        if (dmScanState.foundTweets.size === prevCount) {
                            pass2EmptyCount++;
                        }
                    } else {
                        pass2EmptyCount++;
                    }
                }

                // Scroll DOWN
                pass2Target = Math.min(viewport.scrollHeight, pass2Target + pass2Step);
                viewport.scrollTo({ top: pass2Target, behavior: 'instant' });

                console.log(`Tweet Bookmark: Pass 2, Iteration ${dmScanState.currentIteration}, target: ${pass2Target}, found: ${dmScanState.foundTweets.size}`);

                await sleep(450);

                // Update progress
                updateScanProgress({
                    tweetsFound: dmScanState.foundTweets.size,
                    iteration: dmScanState.currentIteration
                });
            }

            console.log(`Tweet Bookmark: Pass 2 complete, found ${dmScanState.foundTweets.size} total tweets`);
        }

        // ========== PASS 3: Fine-grain scroll UP with smaller steps ==========
        if (!dmScanState.isCancelled && dmScanState.foundTweets.size < MAX_TWEETS) {
            console.log('%c[Tweet Bookmark] Starting Pass 3: Bottom → Top (fine-grain)', 'color: purple; font-weight: bold');
            updateScanProgress({ status: 'scanning', pass: 3 });

            // Start from bottom again
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' });
            await sleep(400);

            let pass3Target = viewport.scrollHeight;
            const pass3Step = viewport.clientHeight * 0.20; // Smaller steps
            let pass3EmptyCount = 0;
            const pass3MaxEmpty = 15;

            while (!dmScanState.isCancelled && pass3EmptyCount < pass3MaxEmpty && pass3Target > 0) {
                if (dmScanState.isPaused) {
                    await waitForResume();
                    if (dmScanState.isCancelled) break;
                }

                dmScanState.currentIteration++;
                const prevCount = dmScanState.foundTweets.size;

                // Collect tweets
                const cards = findTweetCardsInDM();
                for (const card of cards) {
                    if (card.tweetId && !dmScanState.foundTweets.has(card.tweetId)) {
                        const typeInfo = detectTweetType(card.element, card.tweetLink);
                        card.tweetType = typeInfo.type;
                        card.hasMedia = typeInfo.hasMedia;
                        card.mediaCount = typeInfo.mediaCount;
                        card.isQuote = typeInfo.hasQuote;
                        card.isThread = typeInfo.isThread;
                        dmScanState.foundTweets.set(card.tweetId, card);
                    }
                }

                if (dmScanState.foundTweets.size > prevCount) {
                    pass3EmptyCount = 0;
                } else {
                    // Check for loading before counting as empty
                    if (dmScanState.loadingCheckEnabled && isTwitterLoading(viewport)) {
                        await waitForLoadingToComplete(viewport, 10000);
                        // Rescan after loading
                        const postLoadCards = findTweetCardsInDM();
                        for (const card of postLoadCards) {
                            if (card.tweetId && !dmScanState.foundTweets.has(card.tweetId)) {
                                const typeInfo = detectTweetType(card.element, card.tweetLink);
                                card.tweetType = typeInfo.type;
                                card.hasMedia = typeInfo.hasMedia;
                                card.mediaCount = typeInfo.mediaCount;
                                card.isQuote = typeInfo.hasQuote;
                                card.isThread = typeInfo.isThread;
                                dmScanState.foundTweets.set(card.tweetId, card);
                            }
                        }
                        // Only count as empty if still no new tweets
                        if (dmScanState.foundTweets.size === prevCount) {
                            pass3EmptyCount++;
                        }
                    } else {
                        pass3EmptyCount++;
                    }
                }

                // Scroll UP with smaller steps
                pass3Target = Math.max(0, pass3Target - pass3Step);
                viewport.scrollTo({ top: pass3Target, behavior: 'instant' });

                console.log(`Tweet Bookmark: Pass 3, Iteration ${dmScanState.currentIteration}, target: ${pass3Target}, found: ${dmScanState.foundTweets.size}`);

                await sleep(400);

                // Update progress
                updateScanProgress({
                    tweetsFound: dmScanState.foundTweets.size,
                    iteration: dmScanState.currentIteration
                });

                if (pass3Target <= 10) break;
            }

            console.log(`Tweet Bookmark: Pass 3 complete, found ${dmScanState.foundTweets.size} total tweets`);
        }

        // Restore scroll position
        viewport.scrollTop = originalScroll;

        const scanDuration = ((Date.now() - dmScanState.startTime) / 1000).toFixed(1);
        console.log(`Tweet Bookmark: Scan complete. Found ${dmScanState.foundTweets.size} unique tweets in ${scanDuration}s after ${dmScanState.currentIteration} iterations`);

        // Determine completion reason
        let reason = 'completed';
        if (dmScanState.isCancelled) {
            reason = 'cancelled';
        }

        // Finalize the scan
        updateScanProgress({ status: 'completing' });
        finalizeScan(reason);
    }

    // Find all tweet cards embedded in DM messages
    function findTweetCardsInDM() {
        console.log('%c[Tweet Bookmark v2.8.0] findTweetCardsInDM() called', 'color: blue; font-weight: bold');

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

        // Calculate counts for filter tabs
        const sentTweets = tweets.filter(t => t.isSentByMe);
        const receivedTweets = tweets.filter(t => !t.isSentByMe);
        const mediaTweets = tweets.filter(t => t.hasMedia || t.tweetType === 'media');

        const overlay = document.createElement('div');
        overlay.className = 'tweet-bookmark-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'dm-bookmark-modal-title');

        const tag = `dm-${recipient}`;

        // Helper to get type badge HTML
        const getTypeBadge = (tweet) => {
            const badges = [];
            if (tweet.tweetType === 'media' || tweet.hasMedia) {
                badges.push('<span class="tweet-type-badge media" title="Has media">📷</span>');
            }
            if (tweet.tweetType === 'quote' || tweet.isQuote) {
                badges.push('<span class="tweet-type-badge quote" title="Quote tweet">💬</span>');
            }
            if (tweet.tweetType === 'thread' || tweet.isThread) {
                badges.push('<span class="tweet-type-badge thread" title="Thread">🧵</span>');
            }
            return badges.join('');
        };

        // Helper to get sent/received badge
        const getSentBadge = (tweet) => {
            return tweet.isSentByMe
                ? '<span class="tweet-sent-badge sent">You shared</span>'
                : '<span class="tweet-sent-badge received">Received</span>';
        };

        overlay.innerHTML = `
      <div class="tweet-bookmark-modal tweet-bookmark-dm-modal">
        <div class="tweet-bookmark-modal-header">
          <h2 class="tweet-bookmark-modal-title" id="dm-bookmark-modal-title">📌 Bookmark Shared Tweets</h2>
          <button class="tweet-bookmark-modal-close" aria-label="Close dialog">&times;</button>
        </div>
        <div class="tweet-bookmark-modal-body">
          <div class="dm-bookmark-summary">
            <div class="dm-bookmark-count">
              Found <strong>${tweets.length}</strong> tweet${tweets.length === 1 ? '' : 's'} in conversation with <strong>${escapeHtml(recipient)}</strong>
            </div>
            ${savedCount > 0 ? `<div class="dm-bookmark-saved-note">(${savedCount} already bookmarked)</div>` : ''}
          </div>

          <div class="dm-filter-tabs" role="tablist">
            <button class="dm-filter-tab active" data-filter="all" role="tab" aria-selected="true">
              All <span class="tab-count">${tweets.length}</span>
            </button>
            <button class="dm-filter-tab" data-filter="sent" role="tab" aria-selected="false">
              Sent <span class="tab-count">${sentTweets.length}</span>
            </button>
            <button class="dm-filter-tab" data-filter="received" role="tab" aria-selected="false">
              Received <span class="tab-count">${receivedTweets.length}</span>
            </button>
            <button class="dm-filter-tab" data-filter="media" role="tab" aria-selected="false">
              Media <span class="tab-count">${mediaTweets.length}</span>
            </button>
          </div>

          <div class="dm-tweet-preview-list">
            ${tweets.map((tweet, index) => `
              <div class="dm-tweet-preview-item ${tweet.alreadySaved ? 'already-saved' : ''}"
                   data-index="${index}"
                   data-type="${tweet.tweetType || 'regular'}"
                   data-sent="${tweet.isSentByMe ? 'true' : 'false'}"
                   data-has-media="${tweet.hasMedia ? 'true' : 'false'}">
                <div class="dm-tweet-checkbox">
                  <input type="checkbox" id="dm-tweet-${index}" ${tweet.alreadySaved ? 'disabled' : 'checked'}>
                </div>
                <div class="dm-tweet-info">
                  <div class="dm-tweet-meta">
                    <span class="dm-tweet-author">${escapeHtml(tweet.author)}</span>
                    ${getTypeBadge(tweet)}
                    ${getSentBadge(tweet)}
                  </div>
                  <div class="dm-tweet-content">${escapeHtml(tweet.content.substring(0, 100))}${tweet.content.length > 100 ? '...' : ''}</div>
                </div>
                ${tweet.alreadySaved ? '<span class="already-saved-badge">✓ Saved</span>' : ''}
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
        const filterTabs = overlay.querySelectorAll('.dm-filter-tab');
        const tweetItems = overlay.querySelectorAll('.dm-tweet-preview-item');

        const closeModal = () => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 150);
        };

        // Update save button count based on checked items (respecting current filter)
        const updateSaveButtonCount = () => {
            const checkedCount = overlay.querySelectorAll('.dm-tweet-preview-item:not(.already-saved) input[type="checkbox"]:checked').length;
            saveBtn.textContent = `Save ${checkedCount} Tweet${checkedCount === 1 ? '' : 's'}`;
            saveBtn.disabled = checkedCount === 0;
        };

        // Filter tab click handler
        const handleFilterClick = (e) => {
            const filter = e.target.closest('.dm-filter-tab')?.dataset.filter;
            if (!filter) return;

            // Update active tab
            filterTabs.forEach(tab => {
                tab.classList.remove('active');
                tab.setAttribute('aria-selected', 'false');
            });
            e.target.closest('.dm-filter-tab').classList.add('active');
            e.target.closest('.dm-filter-tab').setAttribute('aria-selected', 'true');

            // Filter items
            tweetItems.forEach(item => {
                const isSent = item.dataset.sent === 'true';
                const hasMedia = item.dataset.hasMedia === 'true' || item.dataset.type === 'media';

                let show = true;
                if (filter === 'sent') {
                    show = isSent;
                } else if (filter === 'received') {
                    show = !isSent;
                } else if (filter === 'media') {
                    show = hasMedia;
                }

                item.style.display = show ? '' : 'none';
            });
        };

        filterTabs.forEach(tab => {
            tab.addEventListener('click', handleFilterClick);
        });

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

            // Batch save implementation
            progressFill.style.width = '50%';
            progressText.textContent = `Preparing ${selectedTweets.length} tweets...`;

            // Yield to UI
            await new Promise(r => setTimeout(r, 50));

            const bookmarksToSave = selectedTweets.map(tweet => {
                const bookmark = {
                    ...tweet,
                    tags: [tag, ...additionalTags],
                    notes: `Shared in DM with ${recipient}`,
                    savedAt: Date.now()
                };
                // Clean up internal properties
                delete bookmark.alreadySaved;
                delete bookmark.isSentByMe;
                delete bookmark.tweetType;
                delete bookmark.hasMedia;
                delete bookmark.mediaCount;
                delete bookmark.isQuote;
                delete bookmark.isThread;
                return bookmark;
            });

            progressFill.style.width = '75%';
            progressText.textContent = `Saving to storage...`;

            // Yield to UI
            await new Promise(r => setTimeout(r, 50));

            try {
                // Use the new batch save function from storage.js
                await saveBookmarksBatch(bookmarksToSave);
                savedCount = bookmarksToSave.length;
                progressFill.style.width = '100%';
            } catch (error) {
                console.error('Tweet Bookmark: Error batch saving tweets:', error);
                errorCount = bookmarksToSave.length;
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

    // Handle tab visibility change for graceful scan interruption
    function setupVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && dmScanState.isScanning && !dmScanState.isPaused) {
                // Auto-pause on tab switch
                dmScanState.isPaused = true;
                updateScanProgress({ status: 'paused' });

                // Update pause button if panel exists
                const pauseBtn = scanProgressPanel?.querySelector('.pause-btn');
                if (pauseBtn) {
                    pauseBtn.textContent = '▶️ Resume';
                }

                console.log('Tweet Bookmark: Scan auto-paused due to tab switch');
            }
        });
    }

    // Initialize
    function init() {
        console.log('Tweet Bookmark: Extension loaded');
        processAllTweets();
        observeNewTweets();
        // Check if we're on a DM page on initial load
        handleDMPage();
        // Setup visibility handler for graceful interruption
        setupVisibilityHandler();
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
