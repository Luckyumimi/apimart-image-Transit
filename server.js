const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const STATIC_DIR = __dirname;
const FIXED_BASE_URL = "https://api.apimart.ai";
const taskRegistry = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (requestUrl.pathname === "/api/generate" && req.method === "POST") {
      await handleGenerate(req, res);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/tasks/") && req.method === "GET") {
      await handleTaskStatus(req, res, requestUrl);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: { message: "Method not allowed" } });
      return;
    }

    serveStatic(requestUrl.pathname, res, req.method);
  } catch (error) {
    sendJson(res, 500, {
      error: {
        message: error.message || "Internal server error",
      },
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`APIMart Image Bridge running at http://${HOST}:${PORT}`);
});

async function handleGenerate(req, res) {
  const body = await readJsonBody(req);
  const apiKey = String(body.apiKey || "").trim();
  const payload = body.payload;

  if (!apiKey) {
    sendJson(res, 400, { error: { message: "apiKey is required" } });
    return;
  }

  if (!payload || typeof payload !== "object") {
    sendJson(res, 400, { error: { message: "payload is required" } });
    return;
  }

  const upstream = await fetch(`${FIXED_BASE_URL}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const result = await readUpstreamJson(upstream);
  const taskId =
    result.task_id ||
    result.id ||
    result.data?.task_id ||
    result.data?.[0]?.task_id ||
    result.data?.id;

  if (upstream.ok && taskId) {
    taskRegistry.set(String(taskId), {
      baseUrl: FIXED_BASE_URL,
      apiKey,
      createdAt: Date.now(),
    });
    pruneTaskRegistry();
  }

  sendJson(res, upstream.status, result);
}

async function handleTaskStatus(req, res, requestUrl) {
  const taskId = decodeURIComponent(requestUrl.pathname.replace("/api/tasks/", ""));
  const language = String(requestUrl.searchParams.get("language") || "zh").trim();
  const taskContext = taskRegistry.get(taskId);

  if (!taskId) {
    sendJson(res, 400, { error: { message: "taskId is required" } });
    return;
  }

  if (!taskContext) {
    sendJson(res, 404, { error: { message: "Task context not found. Please resubmit the generation request." } });
    return;
  }

  const upstream = await fetch(
    `${taskContext.baseUrl}/v1/tasks/${encodeURIComponent(taskId)}?language=${encodeURIComponent(language)}`,
    {
      headers: {
        Authorization: `Bearer ${taskContext.apiKey}`,
      },
    }
  );

  const result = await readUpstreamJson(upstream);
  sendJson(res, upstream.status, result);
}

function serveStatic(requestPath, res, method) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(STATIC_DIR, safePath));

  if (!filePath.startsWith(STATIC_DIR)) {
    sendJson(res, 403, { error: { message: "Forbidden" } });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendJson(res, 404, { error: { message: "Not found" } });
        return;
      }
      sendJson(res, 500, { error: { message: "Failed to read file" } });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });

    if (method === "HEAD") {
      res.end();
      return;
    }

    res.end(data);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function readUpstreamJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {
      error: {
        message: "Upstream returned a non-JSON response",
        raw: text,
      },
    };
  }
}

function pruneTaskRegistry() {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [taskId, context] of taskRegistry.entries()) {
    if (context.createdAt < cutoff) {
      taskRegistry.delete(taskId);
    }
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}
