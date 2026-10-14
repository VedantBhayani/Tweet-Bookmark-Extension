# Tweet Bookmark Extension

Save, organize, and search your favorite tweets locally.

## Features

- **Save Tweets**: One-click saving of tweets from your timeline.
- **DM Tweet Scanner**: Automatically scans and bulk-bookmarks tweets shared in Direct Messages using a multi-pass algorithm (scanner v2.8.1).
- **Organization**: Tag tweets and search through your collection.
- **Local Storage**: Data lives in your browser, respecting your privacy.
- **Export/Import**: Backup and restore your bookmarks via JSON.

## Prerequisites

- A Chromium-based browser (Google Chrome, Brave, Microsoft Edge, Opera).

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
├── content.js         # Injects save button on tweets and contains the multi-pass DM scanning logic
├── content.css        # Button and modal styles
├── storage.js         # chrome.storage.local wrapper
├── dashboard.html     # Bookmark manager page
├── dashboard.css      # Dashboard styles
├── dashboard.js       # Dashboard logic
├── popup.html         # Extension popup
├── popup.js           # Popup logic
├── LICENSE            # MIT License
└── icons/             # Extension icons
```

## Notes

- Data is stored locally in your browser (`chrome.storage.local`)
- Export regularly as backup - data is lost if you uninstall or clear browser data
- Works on both x.com and twitter.com

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
