# DM Scanner Technical Notes

This document contains everything learned about the DM tweet scanning functionality.

## Table of Contents
- [Overview](#overview)
- [Core Problem: Twitter's Virtualization](#core-problem-twitters-virtualization)
- [Architecture](#architecture)
- [Scan Algorithm (v2.6.0)](#scan-algorithm-v260)
- [Key Functions](#key-functions)
- [Problems Encountered & Solutions](#problems-encountered--solutions)
- [Version History](#version-history)

---

## Overview

The DM Scanner finds tweets shared in Twitter/X direct message conversations and allows bulk bookmarking them. It handles Twitter's virtualized list which only renders ~10-15 tweets at a time.

---

## Core Problem: Twitter's Virtualization

Twitter DMs use a virtualized list that:
1. Only renders ~10-15 tweet cards in the DOM at any time
2. Removes cards from DOM as you scroll away
3. May render different content depending on scroll direction
4. Aggressively resets scroll position when scanning too fast

### Evidence from Testing

| Scenario | Tweets Found | Notes |
|----------|--------------|-------|
| v2.4 single pass | 80 | Completed 45 iterations, reached top |
| User pre-scrolled first | 214 | Manual scrolling loaded more content |
| v2.6+ multi-pass | not yet measured | 3 passes in different directions; no recorded result yet |

---

## Architecture

### Key Files

| File | Purpose |
|------|---------|
| `content.js` | Main content script, contains all DM scanning logic |
| `content.css` | Styles for scan progress panel |
| `storage.js` | Chrome storage API wrapper |
| `dashboard.js` | Bookmark manager UI |

### DM Scan State Object (line ~25-40)

```javascript
const dmScanState = {
    isScanning: false,
    isPaused: false,
    isCancelled: false,
    foundTweets: new Map(),      // tweetId -> card object
    startTime: null,
    currentIteration: 0,
    viewport: null,
    recipient: '',
    consecutiveEmptyScrolls: 0,
    scrollStepMultiplier: 0.5,   // Viewport fraction per scroll
    scrollDelay: 400,            // ms between scrolls
    loadingCheckEnabled: true,
    maxLoadingWaitMs: 15000,
    lastScrollHeight: 0
};
```

---

## Scan Algorithm (v2.6.0)

### Pass 1: Bottom → Top (Primary Scan)
- Start at `scrollHeight` (bottom of conversation)
- Scroll UP toward position 0
- Step size: 50% of viewport height
- Exit conditions:
  - Reached `scrollTop <= 10`
  - 10 consecutive empty scrolls (`MAX_STABLE_SCROLLS`)
  - Twitter blocking scroll (3 consecutive resets)

### Pass 2: Top → Bottom (Reverse Scan)
- Only runs if found < 150 tweets
- Start at position 0 (top)
- Scroll DOWN toward `scrollHeight`
- Step size: 40% of viewport height
- Exit: 8 consecutive empty scrolls

### Pass 3: Bottom → Top (Fine-grain)
- Only runs if found < 150 tweets
- Start at bottom again
- Step size: 25% of viewport (smaller for thorough coverage)
- Exit: 12 consecutive empty scrolls

---

## Key Functions

### `scanDMForTweets()` (line ~800)
Main scanning orchestrator. Handles:
- Viewport detection
- Multi-pass coordination
- Progress UI updates
- Pause/resume/cancel

### `findTweetCardsInDM()` (line ~1175)
Finds all tweet cards currently in DOM:
1. Queries `a[href*="/status/"]` links
2. Extracts tweet IDs from URLs
3. Builds card objects with metadata
4. Returns array of unique cards

### `isTwitterLoading()` (line ~628)
Detects if Twitter is loading content:
1. Spinner elements (`[data-testid="spinner"]`)
2. Animated loading elements
3. Placeholder cells (no tweet links)
4. **"x.com" placeholder text** (key discovery!)
5. ScrollHeight changes

### `waitForLoadingToComplete()` (line ~720)
Polls `isTwitterLoading()` until false or timeout.

### `detectTweetType()` (line ~580)
Analyzes tweet card to determine:
- Type: text, image, video, gif, poll, article
- Media count
- Has quote tweet
- Is thread

---

## Problems Encountered & Solutions

### Problem 1: Only 80 tweets found (not 200+)

**Root Cause**: Twitter's virtualization doesn't render all tweets. Scanner completed successfully (reached top) but only ~80 unique tweets appeared in DOM across 45 iterations.

**Solution**: Multi-pass scanning (v2.6.0)
- Pass 2 scrolls opposite direction, triggering different renders
- Pass 3 uses smaller steps for thorough coverage

### Problem 2: Scroll Position Resets

**Symptom**: Scanner tries to scroll to position 2000, but Twitter resets to position 15000.

**Evidence from logs**:
```
Scroll was reset! Target: 2552, Actual: 16776
Scroll was reset! Target: 1455, Actual: 19327
```

**Solution**:
- Retry scroll 3 times (`MAX_RESETS_AT_POSITION`)
- If stuck, try from `minScrollReached` instead
- Use smaller scroll steps (0.3) in difficult areas

### Problem 3: x.com Placeholder Cards

**Discovery**: Twitter shows gray cards with "x.com" text and blue spinners while loading tweet content.

**Screenshot evidence**: Cards show spinner + "x.com" text before actual tweet loads.

**Solution**: Added detection in `isTwitterLoading()`:
```javascript
if (text === 'x.com' || (text.length < 15 && text.includes('x.com') && !hasTweetLink)) {
    return true; // Loading detected
}
```

### Problem 4: Wait-for-content Loop Too Slow (v2.5.0-2.5.2)

**Symptom**: Added a wait loop that checked loading before collecting tweets, but it made scan very slow (5+ seconds per position) and sometimes broke collection entirely.

**Root Cause**: The loop did `continue` when loading detected, skipping tweet collection. If loading always detected (edge placeholders), tweets never collected.

**Solution**: Removed the problematic wait-for-content loop (v2.5.3). Kept the loading detection in main loop only.

---

## Version History

| Version | Changes |
|---------|---------|
| 2.3.0 | Robust DM Scanner with pause/resume |
| 2.4.0 | Loading-aware scanning, 15s max wait |
| 2.5.0 | Added x.com placeholder detection, wait-for-content loop |
| 2.5.1 | Reduced wait times (still slow) |
| 2.5.2 | Further reduced wait times (broke at 13 tweets) |
| 2.5.3 | Removed wait loop, back to v2.4 speed |
| 2.6.0 | **Multi-pass bidirectional scanning** |
| 2.7.0 | Smaller scroll steps and direction reversal |
| 2.8.0 | Timing and loading-detection changes |
| 2.8.1 | Passes 2 and 3 store extracted data after a loading wait; raw cards were being dropped |

---

## Timing Configuration

### Current Settings (v2.6.0)

| Setting | Value | Location |
|---------|-------|----------|
| `scrollDelay` | 400ms | dmScanState |
| `scrollStepMultiplier` | 0.5 | dmScanState |
| `maxLoadingWaitMs` | 15000ms | dmScanState |
| `MAX_STABLE_SCROLLS` | 10 | scanDMForTweets |
| `MAX_RESETS_AT_POSITION` | 3 | scanDMForTweets |
| Pass 2 step | 0.4 viewport | scanDMForTweets |
| Pass 3 step | 0.25 viewport | scanDMForTweets |

### Speed vs Coverage Tradeoffs

| Faster | Slower |
|--------|--------|
| Misses tweets (virtualization) | Catches more tweets |
| Twitter doesn't load content | Twitter has time to render |
| Scroll resets more often | More stable scrolling |

---

## Console Log Patterns

### Healthy Scan
```
[Tweet Bookmark v2.6.0] Content script loaded
Tweet Bookmark: Starting at bottom, scrollTop: 19327, scrollHeight: 19327
Tweet Bookmark: Iteration 1, target: 18500, actual: 18500, found: 8
Tweet Bookmark: Iteration 2, target: 17700, actual: 17700, found: 12
...
Tweet Bookmark: Pass 2 complete, found 95 total tweets
Tweet Bookmark: Pass 3 complete, found 112 total tweets
```

### Scroll Reset (Normal)
```
Tweet Bookmark: Scroll was reset! Target: 2552, Actual: 16776, Min reached: 3396
```

### Loading Detected
```
Tweet Bookmark: Loading detected - x.com placeholder card
Tweet Bookmark: Loading detected, waiting for content...
```

---

## Testing Checklist

1. [ ] Console shows v2.6.0 loaded
2. [ ] Pass 1 completes (reaches top or max empty)
3. [ ] Pass 2 runs if < 150 tweets
4. [ ] Pass 3 runs if still < 150 tweets
5. [ ] Final count > 100 tweets
6. [ ] Pause/Resume still works
7. [ ] Cancel stops all passes

---

## Future Improvements to Consider

1. **Simulate wheel events** instead of `scrollTo()` - may prevent resets
2. **Random delays** between scrolls - more human-like
3. **Adaptive pass count** - keep running passes until no new tweets found
4. **Cache scroll positions** where tweets were found for retry
5. **Parallel viewport scanning** - check both visible and nearby positions

---

## File Locations

- Extension: `[Project Root]`
- Console logs: Export from DevTools
