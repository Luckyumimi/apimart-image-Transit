---
name: cliapi
description: Invoke APIMart Image Studio generation through this repository's Node CLI or existing website HTTP routes. Use for scripted image generation, reference uploads, task polling, and result downloads; the CLI itself is not an HTTP server.
---

# APIMart Image Studio CLI and API

Use this skill when a user asks to generate images from a terminal, script, or HTTP client using this repository. Work from the repository root and check `node cli.js --help` for the current option list before relying on flags.

## Choose the Caller

- For shell or script automation, run `cli.js` or `npm run image`. The CLI is an HTTP client for the website's existing `/api/*` routes.
- For a caller that already speaks HTTP, call the website routes directly.
- There is no HTTP route that launches `cli.js` as a child process. Do not describe the CLI as an API server or add a process-execution endpoint unless the user separately requests that architecture and its security implications are addressed.

## Prepare

The website server must already be running. The default address is `http://127.0.0.1:43888`; override it with `IMAGE_STUDIO_URL` or `--server`. Use Node.js 20 or newer.

Set the API key in the current PowerShell session without placing it in a command argument:

```powershell
$secureKey = Read-Host "APIMart API Key" -AsSecureString
$env:APIMART_API_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password
$env:IMAGE_STUDIO_URL = "http://127.0.0.1:43888"
```

The CLI sends the key to the configured website instance, which then proxies APIMart requests. Use only a trusted instance; use HTTPS for a remote server. Never add a real key to source files, command arguments, logs, or examples.

## Run the CLI

Basic generation uses the fixed-price Ext Flare variant by default:

```powershell
npm run image -- --prompt "雨夜中的红色跑车" --size 16:9 --output .\generated
```

The main model choices are `ext-flare`, `ext-sunburst`, `flare`, and `sunburst`. The ordinary Flare and Sunburst variants use token-based billing; use them only when the user explicitly chooses that billing mode. The CLI does not retry or switch models automatically.

Add local reference images by repeating `--reference`:

```powershell
npm run image -- --prompt "保留人物姿势，改成水彩风格" --model ext-flare --reference .\person.png --output .\generated
```

The CLI uploads references sequentially through the website and accepts up to 16 JPEG, PNG, GIF, or WebP files, each no larger than 19 MiB. Reference files and output directories are resolved relative to the shell's current directory.

For ordinary models, `--size` accepts `auto`, a documented ratio, or an exact size such as `1536x1024`. The ratio choices are `1:1`, `3:2`, `2:3`, `16:9`, `9:16`, `4:3`, `3:4`, `5:4`, `4:5`, `2:1`, `1:2`, `21:9`, `9:21`, `3:1`, and `1:3`. Exact width and height must be multiples of 16, each no greater than 3840, total pixels between 655,360 and 8,294,400, and the long-to-short ratio no greater than 3:1. Exact dimensions omit the `resolution` field. Ext supports only 1K, one output image, and `auto`, `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `5:4`, `4:5`, `16:9`, `9:16`, or `21:9`; it rejects exact dimensions. GIF requires `auto`; SVG does not accept references and produces one image.

Choose `--output <directory>` to download each result through the website. Without it, the CLI prints the image URLs. To return immediately after submission, use `--no-wait`; the printed task ID can be resumed against the same running server:

```powershell
npm run image -- --task task_123456 --output .\generated
```

`--task` needs no API key, but the server's in-memory task context must still exist. After the website server restarts, resubmit the generation request. The default first-poll delay is 6000 ms; adjust it with `--initial-delay-ms`, `--poll-interval-ms`, and `--timeout-ms`.

## Call the Website API Directly

Direct HTTP callers use the same server routes as `cli.js`:

| Operation | Route | Authentication and body |
|---|---|---|
| Submit generation | `POST /api/generate` | JSON `{ "apiKey": "...", "payload": { ... } }` |
| Upload one reference | `POST /api/uploads/images` | `x-api-key` header and `multipart/form-data` field `file` |
| Poll a task | `GET /api/tasks/:taskId?language=zh` | No key header; task context is held by the server process |
| Download an image | `GET /api/download?url=<encoded-image-url>` | The URL is encoded as a query parameter |

For image-to-image requests, upload each local file first, read its returned image URL, and place those URLs in the generation payload's `image_urls` array. Then submit once, extract the task ID from the response, poll until a terminal status, and download each returned image URL if local files are needed.

**Download URL safety:** `/api/download` fetches the supplied URL server-side and currently has no host allowlist. Only pass image URLs returned by the APIMart task response. Never forward arbitrary URLs supplied by users or another untrusted source; doing so can turn the website into an SSRF request path.

PowerShell 7 end-to-end image-to-image example (upload, submit, poll, then download):

```powershell
$referencePath = ".\reference.png"
$upload = Invoke-RestMethod -Method Post `
  -Uri "$($env:IMAGE_STUDIO_URL)/api/uploads/images" `
  -Headers @{ "x-api-key" = $env:APIMART_API_KEY } `
  -Form @{ file = Get-Item $referencePath }
$referenceUrl = $upload.url
if (-not $referenceUrl) { $referenceUrl = $upload.data.url }
if (-not $referenceUrl) { throw "Upload response did not contain an image URL." }

$payload = @{
  model = "gpt-image-2.6-ext"
  version = "flare"
  prompt = "保留人物姿势，改成水彩风格"
  size = "16:9"
  resolution = "1k"
  n = 1
  image_urls = @($referenceUrl)
}
$body = @{ apiKey = $env:APIMART_API_KEY; payload = $payload } | ConvertTo-Json -Depth 8
$response = Invoke-RestMethod -Method Post `
  -Uri "$($env:IMAGE_STUDIO_URL)/api/generate" `
  -ContentType "application/json" `
  -Body $body

$taskId = $response.task_id
if (-not $taskId) { $taskId = $response.id }
if (-not $taskId) { $taskId = $response.data.task_id }
if (-not $taskId -and $response.data -is [array]) { $taskId = $response.data[0].task_id }
if (-not $taskId) { $taskId = $response.data.id }
if (-not $taskId) { throw "Generation response did not contain a task ID." }

Start-Sleep -Milliseconds 6000
$completed = $false
$successStates = @("succeeded", "success", "completed", "finished")
$failureStates = @("failed", "error", "cancelled", "canceled")
for ($attempt = 0; $attempt -lt 40; $attempt++) {
  if ($attempt -gt 0) { Start-Sleep -Seconds 3 }
  $encodedTaskId = [uri]::EscapeDataString([string]$taskId)
  $task = Invoke-RestMethod -Uri "$($env:IMAGE_STUDIO_URL)/api/tasks/$encodedTaskId?language=zh"
  $status = $task.status
  if (-not $status) { $status = $task.data.status }
  if (-not $status -and $task.data -is [array]) { $status = $task.data[0].status }
  if (-not $status) { $status = $task.data.task.status }
  if (-not $status) { $status = $task.task.status }
  $status = ([string]$status).ToLowerInvariant()
  if ($successStates -contains $status) { $completed = $true; break }
  if ($failureStates -contains $status) { throw "Generation task failed: $status" }
}
if (-not $completed) { throw "Task polling timed out. Resume with the same task ID." }

$imageCandidates = @(
  $task.image_urls, $task.data.image_urls, $task.data.output.image_urls,
  $task.data.result.image_urls, $task.output.image_urls, $task.result.image_urls,
  $task.data.result.images, $task.data.images, $task.images,
  $task.data.result.files, $task.data.files, $task.result.files, $task.files
)
$imageUrls = foreach ($candidate in $imageCandidates) {
  foreach ($image in @($candidate)) {
    if ($image -is [string]) { $image }
    elseif ($image.url -is [string]) { $image.url }
    elseif ($image.image_url -is [string]) { $image.image_url }
    elseif ($image.url -is [array]) { $image.url }
  }
}
if (-not $imageUrls) { throw "Completed task response did not contain an image URL." }

$index = 1
foreach ($imageUrl in $imageUrls | Select-Object -Unique) {
  $encodedImageUrl = [uri]::EscapeDataString([string]$imageUrl)
  Invoke-WebRequest `
    -Uri "$($env:IMAGE_STUDIO_URL)/api/download?url=$encodedImageUrl" `
    -OutFile ".\generated-$index.png"
  $index++
}
```

The example uses the common Ext Flare response shape and extracts other image URL forms handled by `cli.js`. For text-to-image, omit the upload block and `image_urls`. Task status routes do not require an API key header; upload and generation do. Task and image response shapes can vary, so use `server.js` and the extraction helpers in `cli.js` as the source of truth. Only download URLs from the final task response. These routes do not launch the `cli.js` process.

## Request and Cost Behavior

One generation submits one `POST /api/generate`. Each reference adds one upload request. Polling adds one `GET /api/tasks/:taskId` per poll until completion or timeout. With `--output`, each result adds one `/api/download` request. Automatic retries and model fallbacks are zero. Do not run a real generation merely to validate the CLI; use `npm test`, which mocks all website routes and never calls APIMart.

If the website returns `Task context not found`, the server process that accepted the task has restarted or lost its in-memory task registry. The CLI checks `APIMART_API_KEY` before uploading or submitting, so that specific error is safe to fix and rerun. If `/api/generate` was sent but the connection failed before a task ID arrived, do not blindly resubmit: the route has no idempotency key, so inspect server or upstream logs before deciding whether to retry. When a task ID is available, resume it with `--task`.

## References

- CLI options: `node cli.js --help`
- Project usage and setup: `README.md`
- Standard model generation: https://docs.apimart.ai/cn/api-reference/images/gpt-image-2.6/generation
- Ext model generation: https://docs.apimart.ai/cn/api-reference/images/gpt-image-2.6-ext/generation
