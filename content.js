// content.js — detects end/replay, prevents autoplay/loop, auto-clicks Continue Watching,
// and ensures only one tab plays at a time via background coordination.
(function(){
  if (!/(^|\.)youtube\.com$/i.test(location.hostname)) return;

  let video = null;
  let endedOnce = false;
  let hardPauseInterval = null;
  let lastHref = location.href;
  let guardsInterval = null;

  function log(){ /* console.log('[YTFG]', ...arguments); */ }

  function $(sel){ return document.querySelector(sel); }

  function clickContinueWatching() {
    const candidates = Array.from(document.querySelectorAll('button, yt-button-shape button, .ytp-button'));
    for (const btn of candidates) {
      const t = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
      if (/continue watching/i.test(t) || (/yes/i.test(t) && /watch/i.test((btn.closest('*')?.innerText || '')))) {
        btn.click();
        break;
      }
    }
  }

  function disableAutoplayToggle() {
    // Try to switch off "Autoplay" if visible
    const autoOn = document.querySelector('button[aria-label*="Autoplay"][aria-pressed="true"], ytd-toggle-button-renderer[is-icon-button][aria-pressed="true"]');
    if (autoOn) autoOn.click();
  }

  function attach() {
    const v = document.querySelector('video');
    if (!v || v === video) return;
    if (video) detach();
    video = v;

    try { video.loop = false; } catch(e){}
    clickContinueWatching();
    disableAutoplayToggle();

    video.addEventListener('play', onPlay, true);
    video.addEventListener('playing', onPlay, true);
    video.addEventListener('pause', onPause, true);
    video.addEventListener('ended', onEnded, true);
    video.addEventListener('timeupdate', onTimeUpdate, true);

    // keep guards alive (continue watching + autoplay switch)
    if (guardsInterval) clearInterval(guardsInterval);
    guardsInterval = setInterval(() => {
      clickContinueWatching();
      disableAutoplayToggle();
    }, 1500);

    // handshake
    chrome.runtime.sendMessage({ type: 'REQUEST_STATE' });
  }

  function detach() {
    if (!video) return;
    video.removeEventListener('play', onPlay, true);
    video.removeEventListener('playing', onPlay, true);
    video.removeEventListener('pause', onPause, true);
    video.removeEventListener('ended', onEnded, true);
    video.removeEventListener('timeupdate', onTimeUpdate, true);
    video = null;
    if (guardsInterval) { clearInterval(guardsInterval); guardsInterval = null; }
  }

  function send(evt, extra) {
    const payload = {
      type: 'VIDEO_EVENT',
      event: evt,
      url: location.href,
      title: document.title,
      duration: video ? video.duration || 0 : 0,
      currentTime: video ? video.currentTime || 0 : 0,
      playing: video ? !video.paused : false,
      endedOnce: endedOnce,
      completed: video && video.duration ? (video.currentTime / video.duration) >= 0.985 : false
    };
    if (extra) {
      for (const k in extra) payload[k] = extra[k];
    }
    chrome.runtime.sendMessage(payload).catch(()=>{});
  }

  function onPlay() {
    // If it started again right at the beginning after having ended -> replay
    if (endedOnce && video && video.currentTime < 2) {
      send('replay');
      return;
    }
    send('playing');
  }
  function onPause() { send('pause'); }
  function onEnded() { endedOnce = true; send('ended'); }
  function onTimeUpdate() { send('timeupdate'); }

  function startHardPauseLoop() {
    if (hardPauseInterval) return;
    hardPauseInterval = setInterval(() => {
      if (!video) return;
      if (!video.paused) video.pause();
    }, 300);
  }
  function stopHardPauseLoop() {
    if (hardPauseInterval) {
      clearInterval(hardPauseInterval);
      hardPauseInterval = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'HARD_PAUSE_LOOP') {
      startHardPauseLoop();
    }
    if (msg.type === 'ALLOW_PLAY') {
      stopHardPauseLoop();
      if (video && video.paused) {
        video.play().catch(()=>{});
      }
    }
  });

  // Watch SPA navigation
  const mo = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      endedOnce = false;
      setTimeout(attach, 500);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('readystatechange', () => setTimeout(attach, 500));
  setTimeout(attach, 1000);
})();