// background.js — MV3-safe, no ternary-operator mixing.
const STATES = new Map(); // tabId -> { completed, playing, title, url, lastUpdate }
let queue = [];           // ordered list of tabIds that have started but not completed
let currentTab = null;    // tabId that has priority

function inQueue(tabId) {
  return queue.indexOf(tabId) !== -1;
}
function addToQueue(tabId) {
  if (!inQueue(tabId)) queue.push(tabId);
}
function removeFromQueue(tabId) {
  queue = queue.filter(id => id !== tabId);
}

async function closeTab(tabId) {
  try { await chrome.tabs.remove(tabId); } catch(e) {}
  STATES.delete(tabId);
  removeFromQueue(tabId);
  if (currentTab === tabId) currentTab = null;
}

async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
  } catch (e) {}
}

function getNextUnfinished(except) {
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (except !== undefined && id === except) continue;
    const st = STATES.get(id);
    if (st && !st.completed) return id;
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return;

  if (msg.type === 'VIDEO_EVENT') {
    const now = Date.now();
    const prev = STATES.get(tabId) || {};
    const updated = {
      url: msg.url || prev.url,
      title: msg.title || prev.title,
      completed: !!msg.completed,
      playing: !!msg.playing,
      lastUpdate: now
    };
    STATES.set(tabId, updated);
    addToQueue(tabId);

    // 1) Close immediately if ended/completed (prevents autoplay)
    if (msg.event === 'ended' || updated.completed) {
      closeTab(tabId);
      // Move focus to next unfinished, if any
      const next = getNextUnfinished();
      if (next) {
        currentTab = next;
        focusTab(next);
        chrome.tabs.sendMessage(next, { type: 'ALLOW_PLAY' }).catch(()=>{});
      }
      return;
    }

    // 2) If replay detected (video previously ended and starts over) — close tab
    if (msg.event === 'replay') {
      closeTab(tabId);
      const next = getNextUnfinished();
      if (next) {
        currentTab = next;
        focusTab(next);
        chrome.tabs.sendMessage(next, { type: 'ALLOW_PLAY' }).catch(()=>{});
      }
      return;
    }

    // 3) Enforce one-at-a-time playback
    if (msg.event === 'playing' && !updated.completed) {
      if (currentTab === null) {
        currentTab = tabId;
        chrome.tabs.sendMessage(tabId, { type: 'ALLOW_PLAY' }).catch(()=>{});
        // Pause any stragglers just in case
        for (const [id, st] of STATES.entries()) {
          if (id !== tabId && st.playing) {
            chrome.tabs.sendMessage(id, { type: 'HARD_PAUSE_LOOP' }).catch(()=>{});
          }
        }
      } else if (currentTab !== tabId) {
        // Another tab is already active -> pause newcomer and refocus current
        chrome.tabs.sendMessage(tabId, { type: 'HARD_PAUSE_LOOP' }).catch(()=>{});
        focusTab(currentTab);
      }
    }
  }

  if (msg.type === 'REQUEST_STATE') {
    // no-op; used by content to ensure handshake
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  STATES.delete(tabId);
  removeFromQueue(tabId);
  if (currentTab === tabId) {
    currentTab = null;
    const next = getNextUnfinished();
    if (next) {
      currentTab = next;
      focusTab(next);
      chrome.tabs.sendMessage(next, { type: 'ALLOW_PLAY' }).catch(()=>{});
    }
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // If navigating away from YouTube, clear state
  if (changeInfo.status === 'loading' && tab && tab.url && !/https?:\/\/(www\.)?youtube\.com/.test(tab.url)) {
    STATES.delete(tabId);
    removeFromQueue(tabId);
    if (currentTab === tabId) currentTab = null;
  }
});