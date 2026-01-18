# Tweet Bookmark Extension

Save, organize, and search your favorite tweets locally.

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `tweet-bookmark-extension` folder
5. The extension icon (📌) will appear in your toolbar

## How to Use

### Saving Tweets
1. Go to [x.com](https://x.com) or [twitter.com](https://twitter.com)
2. Find a tweet you want to save
3. Click the **📌** button on the tweet
4. Add tags (optional) and click **Save**

### Viewing Bookmarks
1. Click the extension icon in your toolbar
2. Click **Open Dashboard**
3. Search, filter by tags, edit, or delete bookmarks

### Export/Import
- **Export**: Download all bookmarks as JSON (backup)
- **Import**: Restore bookmarks from a JSON file

## Files

```
tweet-bookmark-extension/
├── manifest.json      # Extension config
├── content.js         # Injects save button on tweets
├── content.css        # Button and modal styles
├── storage.js         # IndexedDB functions
├── dashboard.html     # Bookmark manager page
├── dashboard.css      # Dashboard styles
├── dashboard.js       # Dashboard logic
├── popup.html         # Extension popup
├── popup.js           # Popup logic
└── icons/             # Extension icons
```

## Notes

- Data is stored locally in your browser (IndexedDB)
- Export regularly as backup - data is lost if you uninstall or clear browser data
- Works on both x.com and twitter.com
