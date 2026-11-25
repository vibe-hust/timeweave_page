'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const hero = $('hero-video');
  let scenes = [], selected = null, comparison = null;
  const timestamp = n => {
    const t = Math.max(0, n || 0);
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  };
  function renderCues(container, scene, time) {
    if (!scene) return;
    const t = Math.min(Math.max(0, time), scene.duration - 0.001);
    const active = scene.events.filter(e => e.start <= t && t < e.end);
    const key = JSON.stringify([scene.id, active]);
    if (container.dataset.key === key) return;
    container.dataset.key = key;
    container.replaceChildren();
    active.forEach(event => {
      const cue = el('div', undefined, 'cue');
      cue.append(el('span', event.start + '–' + event.end + ' s', 'cue-time'), el('p', event.text));
      container.append(cue);
    });
    if (!active.length) container.append(el('p', 'No event interval is active. The scene and participant descriptions remain in effect.', 'prompt-note'));
  }
  function ready(video, predicate, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    if (video.error) return Promise.reject(new Error('The video could not be loaded.'));
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const events = ['loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'progress', 'timeupdate'];
      const finish = error => {
        clearTimeout(timer);
        events.forEach(event => video.removeEventListener(event, check));
        video.removeEventListener('error', fail);
        signal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const check = () => { if (predicate()) finish(); };
      const fail = () => finish(new Error('The video could not be loaded.'));
      const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('Loading took too long. Please try again.')), 45000);
      events.forEach(event => video.addEventListener(event, check));
      video.addEventListener('error', fail);
      signal?.addEventListener('abort', abort, {once: true});
    });
  }
  function paintHero() {
    if (!selected) return;
    const t = Math.min(hero.currentTime || 0, selected.duration);
    if (hero.currentTime >= selected.duration && !hero.paused) hero.pause();
    $('hero-clock').textContent = timestamp(t) + ' / ' + timestamp(selected.duration);
    renderCues($('hero-cues'), selected, t);
    document.querySelectorAll('#hero-timeline .interval').forEach(button => {
      const active = Number(button.dataset.start) <= t && t < Number(button.dataset.end);
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'true' : 'false');
    });
  }
  function chooseScene(scene) {
    selected = scene;
    hero.pause();
    hero.src = scene.video;
    hero.setAttribute('aria-label', 'Our generated video: ' + scene.title);
    hero.load();
    $('hero-direct').href = scene.video;
    $('hero-error').hidden = true;
    $('scene-name').textContent = scene.title;
    $('scene-description').textContent = scene.scene;
    $('scene-actors').replaceChildren(...scene.actors.map(actor => el('p', actor.text)));
    $('compare-scene').value = scene.id;
    document.querySelectorAll('.scene-pick').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scene === scene.id)));
    const tracks = [];
    scene.events.forEach((event, index) => {
      let track = tracks.find(row => row.subject === event.subject && row.end <= event.start);
      if (!track) { track = {subject: event.subject, end: 0, events: []}; tracks.push(track); }
      track.end = event.end;
      track.events.push({...event, index});
    });
    $('hero-timeline').replaceChildren();
    tracks.forEach(track => {
      const row = el('div', undefined, 'timeline-track');
      row.setAttribute('aria-label', 'Subject ' + track.subject + ' event timeline');
      track.events.forEach(event => {
        const button = el('button', String(event.index + 1).padStart(2, '0'), 'interval');
        button.type = 'button';
        button.style.left = event.start / scene.duration * 100 + '%';
        button.style.width = (event.end - event.start) / scene.duration * 100 + '%';
        button.dataset.start = event.start;
        button.dataset.end = event.end;
        button.title = event.start + '–' + event.end + ' s: ' + event.text;
        button.setAttribute('aria-label', 'Seek to ' + event.start + ' seconds: ' + event.text);
        button.addEventListener('click', async () => {
          try {
            await ready(hero, () => hero.readyState >= 1);
            if (selected === scene) { hero.currentTime = event.start; paintHero(); }
          } catch { if (selected === scene) $('hero-error').hidden = false; }
        });
        row.append(button);
      });
      $('hero-timeline').append(row);
    });
    comparison?.setScene(scene);
    paintHero();
  }
  class SynchronizedComparison {
    constructor() {
      this.videos = [...document.querySelectorAll('.comparison-card video')];
      this.playing = false;
      this.busy = false;
      this.time = 0;
      this.frame = 0;
      this.scrubbing = false;
      this.controller = null;
      $('compare-play').addEventListener('click', () => this.playing ? this.pause() : this.position(this.time >= this.scene.duration - 0.07 ? 0 : this.time, true));
      $('compare-restart').addEventListener('click', () => this.position(0, true));
      $('compare-progress').addEventListener('input', event => {
        if (!this.scrubbing) {
          this.resumeAfterSeek = this.playing;
          this.cancel();
          this.scrubbing = true;
        }
        this.paint(Number(event.target.value));
      });
      $('compare-progress').addEventListener('change', event => {
        this.scrubbing = false;
        this.position(Number(event.target.value), this.resumeAfterSeek);
      });
      this.videos.forEach(video => {
        video.addEventListener('waiting', () => {
          if (this.playing && !this.busy) this.position(this.videos[0].currentTime, true);
        });
        video.addEventListener('ended', () => {
          if (this.playing) { this.pause(); this.paint(this.scene.duration); }
        });
        video.addEventListener('error', () => {
          if (!video.getAttribute('src')) return;
          this.pause();
          $('compare-status').textContent = video.dataset.method + ' could not load. Press play to retry.';
        });
        video.closest('figure').querySelector('.fullscreen').addEventListener('click', () => {
          const request = video.requestFullscreen?.() || video.webkitEnterFullscreen?.();
          request?.catch?.(() => {});
        });
      });
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    }
    halt() {
      this.playing = false;
      cancelAnimationFrame(this.frame);
      this.videos.forEach(video => video.pause());
    }
    cancel() {
      this.controller?.abort();
      this.controller = null;
      this.busy = false;
      this.halt();
    }
    pause() {
      this.cancel();
      if (this.scene) this.paint(this.videos[0].currentTime || 0);
    }
    setScene(scene) {
      this.cancel();
      this.scene = scene;
      this.scrubbing = false;
      this.videos.forEach(video => {
        video.removeAttribute('src');
        video.dataset.src = scene.videos[video.dataset.key];
        video.setAttribute('aria-label', video.dataset.method + ': ' + scene.title);
        video.load();
      });
      $('comparison-scenario').textContent = scene.title;
      $('compare-progress').max = String(scene.duration);
      $('compare-status').textContent = 'All four videos use the same clock and play at normal speed.';
      this.paint(0);
    }
    async position(time, play) {
      this.cancel();
      const controller = new AbortController();
      this.controller = controller;
      const {signal} = controller;
      const target = Math.max(0, Math.min(this.scene.duration - 1 / 16, time || 0));
      this.busy = true;
      this.paint(target);
      hero.pause();
      $('compare-status').textContent = 'Loading and synchronizing all four videos…';
      try {
        this.videos.forEach(video => {
          if (!video.getAttribute('src') || video.error) { video.src = video.dataset.src; video.load(); }
        });
        await Promise.all(this.videos.map(video => ready(video, () => video.readyState >= 1, signal)));
        if (signal.aborted) return;
        this.videos.forEach(video => {
          video.playbackRate = 1;
          if (Math.abs(video.currentTime - target) > 0.003) video.currentTime = target;
        });
        await Promise.all(this.videos.map(video => ready(video, () => !video.seeking && video.readyState >= 3 && Math.abs(video.currentTime - target) < 0.07, signal)));
        if (signal.aborted) return;
        if (play) {
          await Promise.all(this.videos.map(video => video.play()));
          if (signal.aborted) return;
          this.playing = true;
        }
        this.busy = false;
        this.paint(target);
        $('compare-status').textContent = 'All four videos use the same clock and play at normal speed.';
        if (this.playing) this.tick();
      } catch (error) {
        if (signal.aborted) return;
        this.pause();
        $('compare-status').textContent = error.message + ' Press play to retry.';
      }
    }
    tick() {
      if (!this.playing) return;
      const time = this.videos[0].currentTime;
      this.paint(time);
      if (time >= this.scene.duration - 0.02) {
        this.pause();
        this.paint(this.scene.duration);
        $('compare-status').textContent = 'Playback complete. Replay, or seek to inspect an interval.';
        return;
      }
      if (this.videos.some(video => Math.abs(video.currentTime - time) > 0.22)) { this.position(time, true); return; }
      this.frame = requestAnimationFrame(() => this.tick());
    }
    paint(time) {
      if (!this.scene) return;
      this.time = Math.min(this.scene.duration, Math.max(0, time || 0));
      $('compare-clock').textContent = timestamp(this.time) + ' / ' + timestamp(this.scene.duration);
      if (!this.scrubbing) $('compare-progress').value = String(this.time);
      $('compare-play').disabled = this.busy;
      $('compare-restart').disabled = this.busy;
      $('compare-play').textContent = this.busy ? 'Synchronizing…' : this.playing ? 'Ⅱ Pause all' : '▷ Play all four';
      renderCues($('compare-cues'), this.scene, this.time);
    }
  }
  hero.addEventListener('timeupdate', paintHero);
  hero.addEventListener('seeked', paintHero);
  hero.addEventListener('play', () => comparison?.pause());
  hero.addEventListener('error', () => { $('hero-error').hidden = false; });
  $('compare-scene').addEventListener('change', event => {
    const scene = scenes.find(item => item.id === event.target.value);
    if (scene) chooseScene(scene);
  });
  fetch('scenes.json?v=ontime12', {cache: 'no-cache'}).then(response => {
    if (!response.ok) throw new Error('Unable to load prompts');
    return response.json();
  }).then(data => {
    scenes = data.scenes;
    scenes.forEach((scene, index) => {
      const button = el('button', undefined, 'scene-pick');
      button.type = 'button';
      button.dataset.scene = scene.id;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', 'Show scene: ' + scene.title);
      button.append(el('span', String(index + 1).padStart(2, '0'), 'scene-number'), el('span', scene.title, 'scene-title'), el('span', scene.duration + ' s · ' + scene.events.length + ' events', 'scene-meta'));
      button.addEventListener('click', () => chooseScene(scene));
      $('scene-picker').append(button);
      const option = el('option', String(index + 1).padStart(2, '0') + ' / ' + scene.title);
      option.value = scene.id;
      $('compare-scene').append(option);
    });
    comparison = new SynchronizedComparison();
    chooseScene(scenes[0]);
  }).catch(() => {
    $('hero-cues').textContent = 'The prompt timeline could not load. Please refresh the page. The video remains available above.';
    $('compare-status').textContent = 'Please refresh to load the comparison controls.';
  });
})();
