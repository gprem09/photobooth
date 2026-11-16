const SHOTS = 4;
const FRAME_W = 600;
const FRAME_H = 800;
const SIDE = 36;
const TOP = 84;
const GAP = 98;
const STRIP_W = FRAME_W + 2 * SIDE;
const STRIP_H = 2 * TOP + SHOTS * FRAME_H + (SHOTS - 1) * GAP;

const LOOK = {
  paper: [236, 224, 200],
  paperTexture: 2,
  sharpen: 0.8,
  filter: { sepia: 0.45, contrast: 1.55, brightness: 0.9 },
  edge: { width: 4.5, inset: 1.5, corner: 5 },
};

const LUMA = [0.2126, 0.7152, 0.0722];
const SEPIA = [0.393 + 0.769 + 0.189, 0.349 + 0.686 + 0.168, 0.272 + 0.534 + 0.131];

const CAMERA_ERRORS = {
  NotAllowedError: 'Camera access is blocked. Allow it for this site in your browser settings, then try again.',
  NotFoundError: 'No camera was found on this device.',
  NotReadableError: 'The camera is being used by another app. Close that app, then try again.',
};

const $ = (id) => document.getElementById(id);
const ui = {
  video: $('video'),
  countdown: $('countdown'),
  flash: $('flash'),
  dots: $('dots'),
  shutter: $('shutter'),
  strip: $('strip'),
  download: $('download'),
  message: $('message'),
};

let stream = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const smoothstep = (t) => clamp(t, 0, 1) ** 2 * (3 - 2 * clamp(t, 0, 1));
const show = (view) => { document.body.dataset.view = view; };

async function startCamera() {
  show('camera');
  ui.shutter.disabled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    ui.video.srcObject = stream;
    await ui.video.play();
    ui.shutter.disabled = false;
  } catch (error) {
    stopCamera();
    ui.message.textContent = window.isSecureContext
      ? CAMERA_ERRORS[error.name] ?? 'The camera could not be started.'
      : 'The camera only works on http://localhost or HTTPS. Open this page from there.';
    show('error');
  }
}

function stopCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  ui.video.srcObject = null;
}

async function runSession() {
  ui.shutter.disabled = true;
  const sheet = makePaper();
  for (let shot = 0; shot < SHOTS; shot++) {
    await countdown();
    const frame = captureFrame();
    flash();
    ui.dots.children[shot].classList.add('done');
    await sleep(50);
    developFrame(frame, sheet, SIDE, TOP + shot * (FRAME_H + GAP));
    await sleep(450);
  }
  const canvas = Object.assign(document.createElement('canvas'), { width: STRIP_W, height: STRIP_H });
  canvas.getContext('2d').putImageData(sheet, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  stopCamera();
  ui.strip.src = ui.download.href = URL.createObjectURL(blob);
  ui.download.download = `photobooth-${timestamp()}.png`;
  await ui.strip.decode();
  show('result');
}

async function countdown() {
  for (let count = 3; count > 0; count--) {
    ui.countdown.textContent = count;
    ui.countdown.animate({ opacity: [0, 1], transform: ['scale(1.3)', 'scale(1)'] }, { duration: 250, easing: 'ease-out' });
    await sleep(1000);
  }
  ui.countdown.textContent = '';
}

function flash() {
  const peak = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.2 : 0.85;
  ui.flash.animate({ opacity: [peak, 0] }, { duration: 450, easing: 'ease-out' });
}

function captureFrame() {
  const { videoWidth, videoHeight } = ui.video;
  const cropW = Math.min(videoWidth, (videoHeight * FRAME_W) / FRAME_H);
  const cropH = (cropW * FRAME_H) / FRAME_W;
  const canvas = Object.assign(document.createElement('canvas'), { width: FRAME_W, height: FRAME_H });
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(-1, 0, 0, 1, FRAME_W, 0);
  ctx.drawImage(ui.video, (videoWidth - cropW) / 2, (videoHeight - cropH) / 2, cropW, cropH, 0, 0, FRAME_W, FRAME_H);
  return ctx.getImageData(0, 0, FRAME_W, FRAME_H);
}

function retake() {
  URL.revokeObjectURL(ui.download.href);
  ui.download.removeAttribute('href');
  ui.strip.removeAttribute('src');
  for (const dot of ui.dots.children) dot.classList.remove('done');
  startCamera();
}

function timestamp() {
  const now = new Date();
  const pad = (number) => String(number).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function makePaper() {
  const sheet = new ImageData(STRIP_W, STRIP_H);
  const mottle = smoothNoise(STRIP_W, STRIP_H, 40);
  for (let i = 0, out = 0; i < mottle.length; i++, out += 4) {
    const shade = LOOK.paperTexture * (Math.random() - 0.5 + mottle[i] / 2);
    for (let c = 0; c < 3; c++) sheet.data[out + c] = LOOK.paper[c] + shade;
    sheet.data[out + 3] = 255;
  }
  return sheet;
}

function developFrame(frame, sheet, left, top) {
  const w = frame.width;
  const h = frame.height;
  const { sepia, contrast, brightness } = LOOK.filter;
  const tone = SEPIA.map((channel) => 1 - sepia + sepia * channel);
  const edge = frameEdge(w, h);
  const grey = sharpen(greyscale(frame.data, w, h), w, h);

  for (let y = 0, i = 0; y < h; y++) {
    let out = ((top + y) * sheet.width + left) * 4;
    for (let x = 0; x < w; x++, i++, out += 4) {
      for (let c = 0; c < 3; c++) {
        let v = Math.min(1, grey[i] * tone[c]);
        v = clamp((v - 0.5) * contrast + 0.5, 0, 1);
        v = Math.min(1, v * brightness) * (1 - edge.shade[i]) * 255;
        sheet.data[out + c] += (v - sheet.data[out + c]) * edge.cover[i];
      }
    }
  }
}

function greyscale(rgba, w, h) {
  const grey = new Float32Array(w * h);
  for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
    grey[i] = (rgba[p] * LUMA[0] + rgba[p + 1] * LUMA[1] + rgba[p + 2] * LUMA[2]) / 255;
  }
  return grey;
}

function sharpen(grey, w, h) {
  const sharp = new Float32Array(grey.length);
  for (let y = 0, i = 0; y < h; y++) {
    const rows = [Math.max(y - 1, 0) * w, y * w, Math.min(y + 1, h - 1) * w];
    for (let x = 0; x < w; x++, i++) {
      const l = Math.max(x - 1, 0);
      const r = Math.min(x + 1, w - 1);
      let around = 0;
      for (const row of rows) around += grey[row + l] + grey[row + x] + grey[row + r];
      sharp[i] = clamp(grey[i] + LOOK.sharpen * (grey[i] - around / 9), 0, 1);
    }
  }
  return sharp;
}

function smoothNoise(w, h, cell) {
  const columns = Math.ceil(w / cell) + 2;
  const grid = Float32Array.from({ length: columns * (Math.ceil(h / cell) + 2) }, () => Math.random() * 2 - 1);
  const noise = new Float32Array(w * h);
  for (let y = 0, i = 0; y < h; y++) {
    const row = Math.floor(y / cell);
    const ty = smoothstep(y / cell - row);
    for (let x = 0; x < w; x++, i++) {
      const g = row * columns + Math.floor(x / cell);
      const tx = smoothstep((x / cell) % 1);
      const upper = grid[g] + (grid[g + 1] - grid[g]) * tx;
      const lower = grid[g + columns] + (grid[g + columns + 1] - grid[g + columns]) * tx;
      noise[i] = upper + (lower - upper) * ty;
    }
  }
  return noise;
}

function wobble(length) {
  const waves = [[61, 0.4], [17, 0.25], [4.3, 0.15], [1.5, 0.12], [0.9, 0.08]]
    .map(([scale, weight]) => [scale * (0.8 + 0.4 * Math.random()), weight, Math.random() * 2 * Math.PI]);
  return Float32Array.from({ length }, (_, i) =>
    waves.reduce((sum, [scale, weight, phase]) => sum + weight * Math.sin(i / scale + phase), 0));
}

function frameEdge(w, h) {
  const { width, inset, corner } = LOOK.edge;
  const band = Math.ceil(2 * inset + 1.6 * width);
  const cover = new Float32Array(w * h).fill(1);
  const shade = new Float32Array(w * h);
  const [top, bottom, left, right] = [w, w, h, h].map((length) => {
    const drift = wobble(length);
    const spread = wobble(length);
    const fade = wobble(length);
    const dark = 0.3 + 0.6 * Math.random();
    return {
      depth: (at, distance) => distance - inset * (1 + drift[at]),
      line: (at, depth) => dark * (0.6 + 0.4 * fade[at]) * (1 - smoothstep(depth / (width * (1 + 0.6 * spread[at])))),
    };
  });

  for (let y = 0; y < h; y++) {
    const core = y >= band && y < h - band;
    for (let x = 0; x < w; x++) {
      if (core && x === band) x = w - band;
      const t = top.depth(x, y + 0.5);
      const b = bottom.depth(x, h - y - 0.5);
      const l = left.depth(y, x + 0.5);
      const r = right.depth(y, w - x - 0.5);
      const v = Math.min(t, b);
      const s = Math.min(l, r);
      const inside = v < corner && s < corner ? corner - Math.hypot(corner - v, corner - s) : Math.min(v, s);
      cover[y * w + x] = clamp(inside / 1.5 + 0.5, 0, 1);
      shade[y * w + x] = Math.max(top.line(x, t), bottom.line(x, b), left.line(y, l), right.line(y, r));
    }
  }
  return { cover, shade };
}

ui.dots.replaceChildren(...Array.from({ length: SHOTS }, () => document.createElement('i')));
ui.shutter.addEventListener('click', runSession);
$('print').addEventListener('click', () => window.print());
$('retake').addEventListener('click', retake);
$('retry').addEventListener('click', startCamera);
startCamera();
