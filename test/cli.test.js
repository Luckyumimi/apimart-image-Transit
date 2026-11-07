const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { main, parseArgs, buildPayload } = require("../cli");

test("CLI builds exact-size payloads and rejects dimensions outside the API contract", () => {
  const options = parseArgs(["--prompt", "A red kite", "--model", "flare", "--size", "1536x1024"]);
  options.server = "http://127.0.0.1:43888";
  const payload = buildPayload(options);
  assert.equal(payload.model, "gpt-image-2.6-flare");
  assert.equal(payload.size, "1536x1024");
  assert.equal("resolution" in payload, false);
  assert.throws(() => buildPayload({ ...options, size: "1024x400" }), /总像素数/);
});

test("CLI keeps Ext on the fixed 1K single-image contract", () => {
  const options = parseArgs(["--prompt", "A red kite"]);
  options.server = "http://127.0.0.1:43888";
  const payload = buildPayload(options);
  assert.equal(payload.model, "gpt-image-2.6-ext");
  assert.equal(payload.version, "flare");
  assert.equal(payload.resolution, "1k");
  assert.equal(payload.n, 1);
  assert.throws(() => buildPayload({ ...options, size: "3:1" }), /不支持该比例/);
  assert.throws(() => buildPayload({ ...options, count: 2 }), /仅支持生成 1 张/);
});

test("CLI uploads references, submits once, polls, and downloads through the website routes", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apimart-cli-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const referencePath = path.join(tempDir, "reference.png");
  const outputDir = path.join(tempDir, "generated");
  await fs.writeFile(referencePath, Buffer.from("reference image"));

  const calls = [];
  let pollCount = 0;
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ path: url.pathname, method: init.method || "GET" });
    if (url.pathname === "/api/uploads/images") {
      assert.equal(init.headers["x-api-key"], "test-key");
      assert.ok(init.body instanceof FormData);
      return new Response(JSON.stringify({ data: { url: "https://images.example/reference.png" } }));
    }
    if (url.pathname === "/api/generate") {
      const body = JSON.parse(init.body);
      assert.equal(body.apiKey, "test-key");
      assert.deepEqual(body.payload.image_urls, ["https://images.example/reference.png"]);
      assert.equal(body.payload.size, "1536x1024");
      return new Response(JSON.stringify({ task_id: "task_mock" }));
    }
    if (url.pathname === "/api/tasks/task_mock") {
      pollCount += 1;
      const result = pollCount === 1
        ? { status: "processing" }
        : { status: "completed", data: { images: [{ url: "https://images.example/result.png" }] } };
      return new Response(JSON.stringify(result));
    }
    if (url.pathname === "/api/download") {
      assert.equal(url.searchParams.get("url"), "https://images.example/result.png");
      return new Response(Buffer.from("generated image"), { headers: { "content-type": "image/png" } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const printed = [];

  const result = await main([
    "--prompt", "A red kite", "--server", "http://image-studio.test", "--model", "flare",
    "--size", "1536x1024", "--reference", referencePath, "--output", outputDir,
    "--initial-delay-ms", "0", "--poll-interval-ms", "1", "--timeout-ms", "5000",
  ], {
    env: { APIMART_API_KEY: "test-key" },
    fetch,
    delay: async () => {},
    print: (message) => printed.push(message),
    cwd: tempDir,
  });

  assert.equal(result.taskId, "task_mock");
  assert.equal(result.files.length, 1);
  assert.deepEqual(calls.map((call) => call.path), [
    "/api/uploads/images", "/api/generate", "/api/tasks/task_mock", "/api/tasks/task_mock", "/api/download",
  ]);
  assert.equal((await fs.readFile(result.files[0])).toString(), "generated image");
  assert.ok(printed.some((line) => line.includes("任务已提交")));
});

test("CLI can resume polling an existing task without resubmitting or requiring a key", async () => {
  const paths = [];
  const result = await main(["--task", "task_existing", "--server", "http://image-studio.test", "--initial-delay-ms", "0"], {
    env: {},
    fetch: async (input) => {
      const url = new URL(input);
      paths.push(url.pathname);
      return new Response(JSON.stringify({ status: "completed", data: { images: [{ url: "https://images.example/final.png" }] } }));
    },
    delay: async () => {},
    print: () => {},
  });
  assert.deepEqual(paths, ["/api/tasks/task_existing"]);
  assert.equal(result.taskId, "task_existing");
  assert.deepEqual(result.imageUrls, ["https://images.example/final.png"]);
});
