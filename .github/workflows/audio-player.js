/*
DJ Tentstok Custom Audio Unit
*/

const players = document.querySelectorAll(".cool-player");

players.forEach((player) => {
  const audio = player.querySelector("audio");
  const canvas = player.querySelector("canvas");
  const playButton = player.querySelector(".play-button");
  const timeDisplay = player.querySelector(".time-display");
  const ctx = canvas.getContext("2d");

  let audioBuffer = null;
  let levels = [];
  let cachedBarCount = 0;
  let waveformIsLoading = true;
  let waveformError = false;
  let animationFrame = null;

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  }

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    cachedBarCount = 0;
  }

  function getAudioUrl() {
    const source = audio.querySelector("source");
    return audio.currentSrc || (source ? source.src : audio.src);
  }

  function drawMessage(message) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.fillStyle = "#0b0620";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#ffff00";
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(message, width / 2, height / 2);
  }

  /*
    Calculate RMS volume for each part of the actual MP3.
    RMS (average loudness) produces a calmer waveform than using the
    highest individual sample, which is why it no longer fills the whole box.
  */
  function buildLevels(barCount) {
    const channels = Array.from(
      { length: audioBuffer.numberOfChannels },
      (_, index) => audioBuffer.getChannelData(index)
    );
    const samplesPerBar = Math.max(1, Math.floor(audioBuffer.length / barCount));

    const rawLevels = Array.from({ length: barCount }, (_, bar) => {
      const start = bar * samplesPerBar;
      const end = Math.min(audioBuffer.length, start + samplesPerBar);
      let sumOfSquares = 0;
      let measurements = 0;

      for (let sample = start; sample < end; sample += 1) {
        for (const channel of channels) {
          sumOfSquares += channel[sample] * channel[sample];
          measurements += 1;
        }
      }

      return Math.sqrt(sumOfSquares / Math.max(1, measurements));
    });

    /* Normalise against a high percentile, so one extreme beat does not flatten every bar. */
    const sorted = [...rawLevels].sort((a, b) => a - b);
    const reference = sorted[Math.floor(sorted.length * 0.9)] || 1;
    levels = rawLevels.map((level) => Math.min(1, level / reference));
    cachedBarCount = barCount;
  }

  function neonColour(bar, time) {
    /* A continuously travelling neon colour wave. */
    const wave = Math.sin(bar * 0.19 + time * 0.0024);
    const hue = 185 + (wave + 1) * 72; // cyan → blue → pink → violet
    const lightness = 57 + Math.sin(bar * 0.33 - time * 0.004) * 10;
    return `hsl(${hue}, 100%, ${lightness}%)`;
  }

  function drawWaveform() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (waveformIsLoading) return drawMessage("WAVEFORM LADEN...");
    if (waveformError || !audioBuffer) return drawMessage("WAVEFORM KON NIET LADEN");

    const barWidth = 5;
    const gap = 2;
    const barCount = Math.max(1, Math.floor(width / (barWidth + gap)));
    if (barCount !== cachedBarCount) buildLevels(barCount);

    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#080022");
    background.addColorStop(0.55, "#10103a");
    background.addColorStop(1, "#160b25");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const progress = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.currentTime / audio.duration
      : 0;
    const playedBars = Math.floor(progress * barCount);
    const now = performance.now();

    levels.forEach((level, bar) => {
      const isPlayed = bar <= playedBars;
      const x = bar * (barWidth + gap);

      /* Cap bars at roughly 64% of the panel: a less bloated waveform. */
      const baseHeight = 4 + Math.pow(level, 0.78) * (height * 0.60);
      const shimmer = isPlayed && !audio.paused
        ? Math.sin(bar * 0.48 + now * 0.008) * (1 + level * 2)
        : 0;
      const barHeight = Math.max(4, baseHeight + shimmer);
      const y = height - barHeight - 7;

      if (isPlayed) {
        const neon = neonColour(bar, now);
        const glow = 8 + (Math.sin(bar * 0.32 - now * 0.006) + 1) * 5;

        ctx.shadowBlur = glow;
        ctx.shadowColor = neon;
        ctx.fillStyle = neon;
        ctx.fillRect(x, y, barWidth, barHeight);

        /* Small bright cap makes the glow look more electric. */
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fillRect(x, y, barWidth, 1.5);
      } else {
        const grey = ctx.createLinearGradient(0, y, 0, y + barHeight);
        grey.addColorStop(0, "#a8a8b5");
        grey.addColorStop(1, "#454552");
        ctx.shadowBlur = 0;
        ctx.fillStyle = grey;
        ctx.fillRect(x, y, barWidth, barHeight);
      }
    });

    const markerX = progress * width;
    const markerColour = neonColour(playedBars, now);
    ctx.fillStyle = "#ffffff";
    ctx.shadowBlur = 16;
    ctx.shadowColor = markerColour;
    ctx.fillRect(markerX, 0, 2, height);
    ctx.shadowBlur = 0;
  }

  function animate() {
    drawWaveform();
    if (!audio.paused && !audio.ended) {
      animationFrame = requestAnimationFrame(animate);
    }
  }

  async function loadRealWaveform() {
    try {
      const response = await fetch(getAudioUrl());
      if (!response.ok) throw new Error("MP3 could not be fetched");

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio API unavailable");

      const decoder = new AudioContextClass();
      audioBuffer = await decoder.decodeAudioData(await response.arrayBuffer());
      await decoder.close();

      waveformIsLoading = false;
      drawWaveform();
    } catch (error) {
      console.warn("DJ Tentstok waveform error:", error);
      waveformIsLoading = false;
      waveformError = true;
      drawWaveform();
    }
  }

  function updateTime() {
    timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
  }

  playButton.addEventListener("click", async () => {
    if (audio.paused) {
      try {
        await audio.play();
      } catch (error) {
        console.warn("Audio could not start:", error);
      }
    } else {
      audio.pause();
    }
  });

  canvas.addEventListener("click", (event) => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const rectangle = canvas.getBoundingClientRect();
    const position = (event.clientX - rectangle.left) / rectangle.width;
    audio.currentTime = Math.max(0, Math.min(audio.duration, position * audio.duration));
    updateTime();
    drawWaveform();
  });

  audio.addEventListener("play", () => {
    playButton.textContent = "❚❚ PAUZE";
    cancelAnimationFrame(animationFrame);
    animate();
  });

  audio.addEventListener("pause", () => {
    playButton.textContent = "▶ PLAY";
    cancelAnimationFrame(animationFrame);
    drawWaveform();
  });

  audio.addEventListener("loadedmetadata", () => {
    updateTime();
    drawWaveform();
  });

  audio.addEventListener("timeupdate", updateTime);

  audio.addEventListener("ended", () => {
    audio.currentTime = 0;
    updateTime();
    drawWaveform();
  });

  window.addEventListener("resize", () => {
    resizeCanvas();
    drawWaveform();
  });

  resizeCanvas();
  drawWaveform();
  loadRealWaveform();
});
