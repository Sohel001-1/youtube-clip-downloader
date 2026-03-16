const toolStatus = document.getElementById("toolStatus");
const result = document.getElementById("result");
const form = document.getElementById("clipForm");
const submitButton = document.getElementById("submitButton");
let activePoll = null;
let autoDownloadedJobId = null;

function renderMessage(target, text, type) {
  target.innerHTML = `<div class="message ${type}">${text}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    const missing = (data.tools || []).filter((tool) => !tool.ok);

    if (missing.length === 0) {
      renderMessage(toolStatus, "Required tools are available. You can start clipping.", "success");
      return;
    }

    const missingNames = missing.map((tool) => escapeHtml(tool.name)).join(", ");
    renderMessage(
      toolStatus,
      `Missing tools: ${missingNames}. Install them first, then refresh this page.`,
      "error"
    );
  } catch (error) {
    renderMessage(toolStatus, "Could not verify local tools right now.", "error");
  }
}

function stopPolling() {
  if (activePoll) {
    clearInterval(activePoll);
    activePoll = null;
  }
}

function renderProgress(step, detail) {
  const match = String(detail || "").match(/(\d+(?:\.\d+)?)%/);
  const percent = match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
  const progressMarkup = percent !== null
    ? `<div class="progress" aria-hidden="true"><div class="progress-fill" style="width: ${percent}%"></div></div>
       <div class="progress-meta">${percent.toFixed(1)}%</div>`
    : "";

  renderMessage(
    result,
    `<strong>${escapeHtml(step)}</strong><br>${escapeHtml(detail || "Working...")}${progressMarkup}`,
    "success"
  );
}

function renderSuccess(resultData, jobId) {
  const modeLabel = resultData.mode === "full" ? "Video downloaded successfully." : "Clip created successfully.";
  const durationLine = resultData.duration
    ? `<br>Duration: <code>${escapeHtml(resultData.duration)}</code>`
    : "";
  const downloadUrl = `/api/download/${encodeURIComponent(jobId)}`;

  renderMessage(
    result,
    `${modeLabel}<br><br>File: <code>${escapeHtml(resultData.fileName)}</code><br>Saved to: <code>${escapeHtml(
      resultData.filePath
    )}</code>${durationLine}<br>Quality: <code>${escapeHtml(
      resultData.quality
    )}</code><br><br><a class="download-link" href="${downloadUrl}" download>Download file</a>`,
    "success"
  );

  if (autoDownloadedJobId !== jobId) {
    autoDownloadedJobId = jobId;
    const link = result.querySelector(".download-link");
    if (link) {
      link.click();
    }
  }
}

async function pollJob(jobId) {
  const response = await fetch(`/api/clip/${encodeURIComponent(jobId)}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not load clip progress.");
  }

  renderProgress(data.step || "Working", data.detail || "Working...");

  if (data.state === "completed") {
    stopPolling();
    renderSuccess(data.result, jobId);
    submitButton.disabled = false;
    submitButton.textContent = "Download Video / Clip";
  }

  if (data.state === "failed") {
    stopPolling();
    renderMessage(result, escapeHtml(data.detail || "Clip job failed."), "error");
    submitButton.disabled = false;
    submitButton.textContent = "Download Video / Clip";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  stopPolling();
  autoDownloadedJobId = null;
  result.innerHTML = "";
  submitButton.disabled = true;
  submitButton.textContent = "Processing...";
  renderProgress("Starting", "Creating a clip job.");

  const payload = {
    url: document.getElementById("url").value,
    startTime: document.getElementById("startTime").value,
    endTime: document.getElementById("endTime").value,
    quality: document.getElementById("quality").value,
  };

  try {
    const response = await fetch("/api/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      const details = data.details ? `<br><br>${escapeHtml(data.details)}` : "";
      renderMessage(result, `${escapeHtml(data.error || "Something went wrong.")}${details}`, "error");
      return;
    }

    renderProgress(data.step || "Queued", data.detail || "Waiting to start.");
    activePoll = setInterval(() => {
      pollJob(data.jobId).catch((error) => {
        stopPolling();
        renderMessage(result, escapeHtml(error.message || "Could not load clip progress."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "Download Video / Clip";
      });
    }, 1000);

    await pollJob(data.jobId);
  } catch (error) {
    renderMessage(result, "Request failed. Please try again.", "error");
  }
});

loadHealth();
