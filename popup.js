// Tweet Bookmarks - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
    const countEl = document.getElementById('bookmark-count');
    const openDashboardBtn = document.getElementById('open-dashboard');
    const exportBtn = document.getElementById('export-btn');

    // Load bookmark count
    try {
        const count = await getBookmarkCount();
        countEl.textContent = count;
    } catch (error) {
        console.error('Error getting count:', error);
        countEl.textContent = '?';
    }

    // Open dashboard
    openDashboardBtn.addEventListener('click', () => {
        chrome.tabs.create({
            url: chrome.runtime.getURL('dashboard.html')
        });
    });

    // Export bookmarks
    exportBtn.addEventListener('click', async () => {
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
        } catch (error) {
            console.error('Error exporting:', error);
        }
    });
});
