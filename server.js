const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DOWNLOADS_DIR = path.join(ROOT, "downloads");
const jobs = new Map();

fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "File not found." });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    };

    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
    });
    res.end(data);
  });
}

function sendDownload(res, filePath, downloadName) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      sendJson(res, 404, { error: "Download file not found." });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": stats.size,
      "Content-Disposition": `attachment; filename="${path.basename(downloadName)}"`,
    });

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Could not read the download file." });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function parseTimeToSeconds(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value !== "string") {
    return NaN;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return NaN;
  }

  const dottedLikeTime = trimmed.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (dottedLikeTime) {
    const normalized = trimmed.replace(/\./g, ":");
    return parseTimeToSeconds(normalized);
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return NaN;
  }

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((num) => !Number.isFinite(num) || num < 0)) {
    return NaN;
  }

  if (parts.length === 2) {
    return numbers[0] * 60 + numbers[1];
  }

  return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

function formatDuration(totalSeconds) {
  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  }

  return [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function safeFilePart(value) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function timestampPart(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function createJob() {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const job = {
    id,
    state: "queued",
    step: "Queued",
    detail: "Waiting to start.",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  Object.assign(job, patch, { updatedAt: Date.now() });
}

function completeJob(jobId, payload) {
  updateJob(jobId, {
    state: "completed",
    step: "Done",
    detail: "Clip created successfully.",
    result: payload,
  });
}

function failJob(jobId, errorMessage) {
  updateJob(jobId, {
    state: "failed",
    step: "Failed",
    detail: errorMessage,
  });
}

function cleanupJobs() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [jobId, job] of jobs.entries()) {
    if (job.updatedAt < cutoff) {
      jobs.delete(jobId);
    }
  }
}

setInterval(cleanupJobs, 15 * 60 * 1000).unref();

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (onProgress) {
        onProgress(text, "stdout");
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onProgress) {
        onProgress(text, "stderr");
      }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}\n${stderr || stdout}`));
    });
  });
}

async function checkDependencies() {
  const results = [];

  for (const toolName of ["yt-dlp", "ffmpeg"]) {
    try {
      const args = toolName === "ffmpeg" ? ["-version"] : ["--version"];
      const result = await runCommand(toolName, args);
      results.push({
        name: toolName,
        ok: true,
        version: (result.stdout || result.stderr).split(/\r?\n/)[0].trim(),
      });
    } catch (error) {
      results.push({
        name: toolName,
        ok: false,
        error: error.message,
      });
    }
  }

  return results;
}

async function getVideoTitle(url) {
  const result = await runCommand("yt-dlp", ["--print", "%(title)s", "--no-warnings", url]);
  return result.stdout.trim().split(/\r?\n/).pop() || "clip";
}

function getFormatForQuality(quality) {
  const formats = {
    best: "bestvideo*+bestaudio/best",
    high: "bv*[height<=1080]+ba/b[height<=1080]/best",
    medium: "bv*[height<=720]+ba/b[height<=720]/best",
    low: "bv*[height<=480]+ba/b[height<=480]/best",
  };

  return formats[quality] || formats.best;
}

function buildProgressSummary(text, fallback = "Working...") {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (/\[download\]/i.test(line) || /\[Merger\]/i.test(line) || /frame=\s*\d+/i.test(line)) {
      return line;
    }
  }

  return lines[lines.length - 1] || fallback;
}

async function downloadVideo(url, targetPath, quality, onProgress) {
  const args = [
    "-f",
    getFormatForQuality(quality),
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "-o",
    targetPath,
    url,
  ];
  await runCommand("yt-dlp", args, { onProgress });
}

async function downloadClipDirect(url, targetPath, startTime, endTime, quality, onProgress) {
  const args = [
    "-f",
    getFormatForQuality(quality),
    "--merge-output-format",
    "mp4",
    "--force-keyframes-at-cuts",
    "--download-sections",
    `*${startTime}-${endTime}`,
    "--no-playlist",
    "-o",
    targetPath,
    url,
  ];
  await runCommand("yt-dlp", args, { onProgress });
}

async function createClip(sourcePath, outputPath, startTime, duration, onProgress) {
  const args = [
    "-y",
    "-ss",
    String(startTime),
    "-i",
    sourcePath,
    "-t",
    String(duration),
    "-c",
    "copy",
    outputPath,
  ];

  try {
    await runCommand("ffmpeg", args, { onProgress });
  } catch (error) {
    // Fallback to re-encoding if stream copy fails around keyframes.
    await runCommand("ffmpeg", [
      "-y",
      "-ss",
      String(startTime),
      "-i",
      sourcePath,
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      outputPath,
    ], { onProgress });
  }
}

function validateClipRequest(body) {
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const rawStartTime = typeof body.startTime === "string" ? body.startTime.trim() : "";
  const rawEndTime = typeof body.endTime === "string" ? body.endTime.trim() : "";
  const hasStartTime = rawStartTime.length > 0;
  const hasEndTime = rawEndTime.length > 0;
  const startSeconds = hasStartTime ? parseTimeToSeconds(rawStartTime) : null;
  const endSeconds = hasEndTime ? parseTimeToSeconds(rawEndTime) : null;
  const quality = typeof body.quality === "string" ? body.quality.trim().toLowerCase() : "best";

  if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
    return { error: "Please enter a valid YouTube URL." };
  }

  if (hasStartTime !== hasEndTime) {
    return { error: "Enter both From and To for a clip, or leave both empty to download the full video." };
  }

  if (hasStartTime && (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds))) {
    return { error: "Start and end times must be valid numbers or mm:ss values." };
  }

  if (hasStartTime && (startSeconds < 0 || endSeconds <= startSeconds)) {
    return { error: "End time must be greater than start time." };
  }

  if (!["best", "high", "medium", "low"].includes(quality)) {
    return { error: "Quality must be one of: best, high, medium, low." };
  }

  return {
    url,
    startSeconds,
    endSeconds,
    quality,
    mode: hasStartTime ? "clip" : "full",
  };
}

async function processClipJob(jobId, payload) {
  try {
    const { url, startSeconds, endSeconds, quality, mode } = payload;

    updateJob(jobId, {
      state: "running",
      step: "Checking tools",
      detail: "Verifying yt-dlp and ffmpeg.",
    });

    const dependencyStatus = await checkDependencies();
    const missing = dependencyStatus.filter((tool) => !tool.ok);
    if (missing.length > 0) {
      failJob(jobId, `Missing required tools: ${missing.map((tool) => tool.name).join(", ")}`);
      return;
    }

    updateJob(jobId, {
      step: "Fetching info",
      detail: "Getting video details from YouTube.",
    });

    const title = safeFilePart(await getVideoTitle(url)) || "clip";
    const stamp = timestampPart();
    const baseName = mode === "clip"
      ? `${title}_${formatDuration(startSeconds).replace(/:/g, "-")}_to_${formatDuration(endSeconds).replace(/:/g, "-")}_${stamp}`
      : `${title}_full_${stamp}`;
    const tempPath = path.join(DOWNLOADS_DIR, `${baseName}_full.%(ext)s`);
    const downloadedPath = path.join(DOWNLOADS_DIR, `${baseName}_full.mp4`);
    const outputPath = mode === "clip"
      ? path.join(DOWNLOADS_DIR, `${baseName}_clip.mp4`)
      : path.join(DOWNLOADS_DIR, `${baseName}.mp4`);

    if (mode === "clip") {
      const duration = endSeconds - startSeconds;

      try {
        updateJob(jobId, {
          step: "Downloading clip",
          detail: "Trying direct partial download.",
        });

        await downloadClipDirect(url, outputPath, startSeconds, endSeconds, quality, (text) => {
          updateJob(jobId, {
            step: "Downloading clip",
            detail: buildProgressSummary(text, "Downloading requested section."),
          });
        });
      } catch (directError) {
        updateJob(jobId, {
          step: "Downloading full video",
          detail: "Direct clip mode was not available. Falling back to full download.",
        });

        await downloadVideo(url, tempPath, quality, (text) => {
          updateJob(jobId, {
            step: "Downloading full video",
            detail: buildProgressSummary(text, "Downloading full video."),
          });
        });

        updateJob(jobId, {
          step: "Trimming clip",
          detail: "Cutting the requested segment with ffmpeg.",
        });

        await createClip(downloadedPath, outputPath, startSeconds, duration, (text) => {
          updateJob(jobId, {
            step: "Trimming clip",
            detail: buildProgressSummary(text, "Trimming video."),
          });
        });

        if (fs.existsSync(downloadedPath)) {
          fs.unlinkSync(downloadedPath);
        }
      }
    } else {
      updateJob(jobId, {
        step: "Downloading full video",
        detail: "Downloading the full video because no clip times were provided.",
      });

      await downloadVideo(url, outputPath, quality, (text) => {
        updateJob(jobId, {
          step: "Downloading full video",
          detail: buildProgressSummary(text, "Downloading full video."),
        });
      });
    }

    completeJob(jobId, {
      success: true,
      fileName: path.basename(outputPath),
      filePath: outputPath,
      duration: mode === "clip" ? formatDuration(endSeconds - startSeconds) : null,
      quality,
      mode,
    });
  } catch (error) {
    failJob(jobId, error.message || "Could not create the clip.");
  }
}

async function handleClipRequest(req, res) {
  try {
    const body = await readRequestBody(req);
    const payload = validateClipRequest(body);

    if (payload.error) {
      sendJson(res, 400, { error: payload.error });
      return;
    }

    const job = createJob();
    sendJson(res, 202, {
      success: true,
      jobId: job.id,
      state: job.state,
      step: job.step,
      detail: job.detail,
    });

    processClipJob(job.id, payload);
  } catch (error) {
    sendJson(res, 500, {
      error: "Could not start the clip job.",
      details: error.message,
    });
  }
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    checkDependencies()
      .then((tools) => sendJson(res, 200, { tools }))
      .catch((error) => sendJson(res, 500, { error: error.message }));
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/clip") {
    handleClipRequest(req, res);
    return;
  }

  if (req.method === "GET" && requestUrl.pathname.startsWith("/api/clip/")) {
    const jobId = requestUrl.pathname.split("/").pop();
    const job = jobs.get(jobId);

    if (!job) {
      sendJson(res, 404, { error: "Clip job not found." });
      return;
    }

    sendJson(res, 200, job);
    return;
  }

  if (req.method === "GET" && requestUrl.pathname.startsWith("/api/download/")) {
    const jobId = requestUrl.pathname.split("/").pop();
    const job = jobs.get(jobId);

    if (!job || job.state !== "completed" || !job.result || !job.result.filePath) {
      sendJson(res, 404, { error: "Download is not ready for this job." });
      return;
    }

    const normalizedPath = path.normalize(job.result.filePath);
    if (!normalizedPath.startsWith(DOWNLOADS_DIR)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    sendDownload(res, normalizedPath, job.result.fileName || path.basename(normalizedPath));
    return;
  }

  if (req.method === "GET") {
    const relativePath = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1);
    const filePath = path.join(PUBLIC_DIR, relativePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    sendFile(res, filePath);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`YT clip downloader running at http://localhost:${PORT}`);
});
