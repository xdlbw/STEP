'use strict';

function setUpTabs(tabList) {
  const tabs = [...tabList.querySelectorAll('a')];
  const panels = tabs.map(tab => document.getElementById(tab.hash.slice(1)));
  let activeIndex = -1;

  function activate(index) {
    if (activeIndex === index) return;
    activeIndex = index;
    tabs.forEach((tab, position) => {
      const current = position === index;
      tab.setAttribute('aria-selected', String(current));
      tab.tabIndex = current ? 0 : -1;
      panels[position].hidden = !current;
      observePanel(panels[position], current);
    });
  }

  function followFragment() {
    const target = document.getElementById(location.hash.slice(1));
    const index = panels.findIndex(panel => panel.contains(target));
    if (index < 0) return;
    activate(index);
    requestAnimationFrame(() => target.scrollIntoView());
  }

  tabList.setAttribute('role', 'tablist');
  tabs.forEach((tab, index) => {
    tab.id = `tab-${panels[index].id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panels[index].id);
    panels[index].setAttribute('role', 'tabpanel');
    panels[index].setAttribute('aria-labelledby', tab.id);
    panels[index].tabIndex = 0;

    tab.addEventListener('click', event => {
      event.preventDefault();
      activate(index);
    });
    tab.addEventListener('keydown', event => {
      let next;
      switch (event.key) {
        case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break;
        case 'ArrowRight': next = (index + 1) % tabs.length; break;
        case 'Home': next = 0; break;
        case 'End': next = tabs.length - 1; break;
        default: return;
      }
      event.preventDefault();
      activate(next);
      tabs[next].focus();
    });
  });

  activate(0);
  followFragment();
  window.addEventListener('hashchange', followFragment);
}

function setUpPlayers(example) {
  const target = example.querySelector('.video-pair');
  const panel = example.closest('.gallery-panel');
  const videos = [...example.querySelectorAll('video')];
  const durationOf = video => Number(video.dataset.duration);
  const leader = videos.reduce((longest, video) => durationOf(video) > durationOf(longest) ? video : longest);
  const follower = videos.find(video => video !== leader);
  const duration = durationOf(leader);
  const controls = example.querySelector('.pair-controls');
  const pauseButton = controls.querySelector('[data-pause]');
  const reset = controls.querySelector('[data-reset]');
  const scrubber = controls.querySelector('input');
  const timeLabel = controls.querySelector('.pair-time');
  const status = example.querySelector('.pair-status');
  const max = Number(scrubber.max);

  let visible = false;
  let preloaded = false;
  let manuallyPaused = false;
  let failed = false;
  let wantsPlayback = false;
  let playbackRevision = 0;

  function preload() {
    if (preloaded) return;
    preloaded = true;
    for (const video of videos) video.preload = 'auto';
  }

  function seek(time) {
    preload();
    for (const video of videos) {
      video.currentTime = Math.min(time, durationOf(video));
    }
    update();
  }

  function update() {
    const time = Math.min(leader.currentTime, duration);
    scrubber.value = Math.round(time / duration * max);
    scrubber.style.setProperty('--progress', `${Number(scrubber.value) / max * 100}%`);
    scrubber.setAttribute('aria-valuetext', `${time.toFixed(1)} of ${duration.toFixed(1)} seconds`);
    timeLabel.textContent = `${time.toFixed(1)} / ${duration.toFixed(1)} s`;
  }

  function refreshPlayback() {
    const play = visible && !panel.hidden && !document.hidden && !manuallyPaused && !failed;
    if (play === wantsPlayback) return;
    wantsPlayback = play;
    const revision = ++playbackRevision;
    if (!play) {
      for (const video of videos) video.pause();
      update();
      return;
    }

    preload();
    Promise.all(videos.map(video => video.play())).catch(error => {
      // Scrolling or changing tabs can cancel a previous play request.
      if (revision !== playbackRevision) return;
      manuallyPaused = true;
      pauseButton.textContent = 'Resume';
      status.textContent = error.name === 'NotAllowedError'
        ? 'Autoplay was blocked. Select Resume to play both clips.'
        : 'Could not start both clips. Check that the project folder was fully extracted.';
      refreshPlayback();
    });
  }

  function updateVisibility(entry) {
    // Use a lower threshold for leaving so playback is stable at the viewport edge.
    visible = entry.isIntersecting && entry.intersectionRatio >= (visible ? 0.08 : 0.30);
    refreshPlayback();
  }

  pauseButton.addEventListener('click', () => {
    manuallyPaused = !manuallyPaused;
    pauseButton.textContent = manuallyPaused ? 'Resume' : 'Pause';
    if (!manuallyPaused) status.textContent = '';
    refreshPlayback();
  });
  reset.addEventListener('click', () => seek(0));
  scrubber.addEventListener('input', () => seek(Number(scrubber.value) / max * duration));
  leader.addEventListener('timeupdate', () => {
    if (wantsPlayback && durationOf(follower) === duration && !leader.seeking &&
        !follower.paused && !follower.seeking && follower.readyState >= 2) {
      const drift = Math.abs(follower.currentTime - leader.currentTime);
      // A pair can momentarily straddle the loop boundary while staying in sync.
      if (Math.min(drift, duration - drift) > 0.20) follower.currentTime = leader.currentTime;
    }
    update();
  });

  ['pause', 'seeked', 'loadedmetadata'].forEach(event => leader.addEventListener(event, update));
  const showLoadError = () => {
    failed = true;
    refreshPlayback();
    pauseButton.disabled = true;
    status.textContent = 'A video could not be loaded. Open index.html from the extracted project folder.';
  };
  videos.forEach(video => {
    video.controls = false;
    video.muted = true;
    video.loop = true;
    video.addEventListener('error', showLoadError);
    video.querySelector('source').addEventListener('error', showLoadError);
  });
  update();
  controls.hidden = false;
  return {
    target, panel, preload, refreshPlayback, updateVisibility,
    isPreloaded: () => preloaded,
    leaveView() {
      visible = false;
      refreshPlayback();
    },
  };
}

const players = new Map();
document.querySelectorAll('[data-example]').forEach(example => {
  const player = setUpPlayers(example);
  players.set(player.target, player);
});

const playbackObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const player = players.get(entry.target);
    if (!player.panel.hidden) player.updateVisibility(entry);
  }
}, { rootMargin: '-58px 0px 0px', threshold: [0, 0.08, 0.30] });

const preloadObserver = new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) {
    const player = players.get(target);
    if (!isIntersecting || player.panel.hidden) continue;
    player.preload();
    preloadObserver.unobserve(target);
  }
}, { rootMargin: '240px 0px' });

function observePanel(panel, active) {
  for (const target of panel.querySelectorAll('.video-pair')) {
    const player = players.get(target);
    if (active) {
      playbackObserver.observe(target);
      if (!player.isPreloaded()) preloadObserver.observe(target);
    } else {
      playbackObserver.unobserve(target);
      preloadObserver.unobserve(target);
      player.leaveView();
    }
  }
}

document.addEventListener('visibilitychange', () => {
  for (const player of players.values()) player.refreshPlayback();
});
document.querySelectorAll('[data-tabs]').forEach(setUpTabs);
