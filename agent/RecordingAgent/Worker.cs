using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RecordingAgent.Configuration;
using RecordingAgent.Encoder;
using RecordingAgent.LocalBuffer;
using RecordingAgent.ScreenCapture;
using RecordingAgent.Uploader;

namespace RecordingAgent;

/// <summary>
/// Main background service. Coordinates all components:
///   1. DXGI screen capture
///   2. FFmpeg H.264 encoding → RTSP (live) + .ts segments (storage)
///   3. Local 24-hour circular buffer management
///   4. Segment upload to ingest-service
///   5. Agent registration / heartbeat
/// </summary>
public sealed class Worker : BackgroundService
{
    private readonly AgentConfig _config;
    private readonly ILogger<Worker> _logger;
    private readonly ILoggerFactory _loggerFactory;

    public Worker(IOptions<AgentConfig> config, ILogger<Worker> logger, ILoggerFactory loggerFactory)
    {
        _config        = config.Value;
        _logger        = logger;
        _loggerFactory = loggerFactory;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var agentId = _config.ResolvedAgentId;
        _logger.LogInformation("[agent] starting as {AgentId}", agentId);

        // ── Local buffer ────────────────────────────────────────────────────────
        await using var buffer = new BufferManager(
            _config.BufferPath,
            _config.BufferHours,
            _loggerFactory.CreateLogger<BufferManager>());
        buffer.Initialize();

        // ── DXGI screen capture ─────────────────────────────────────────────────
        using var capture = new DxgiCapture();
        capture.Initialize();
        _logger.LogInformation("[agent] capture initialized: {W}x{H}", capture.Width, capture.Height);

        // ── FFmpeg encoder ──────────────────────────────────────────────────────
        using var encoder = new FfmpegEncoder();
        var segmentPattern = Path.Combine(buffer.SegmentsDirectory, "seg_%Y%m%d_%H%M%S.ts");
        var rtspUrl        = $"{_config.MediaServerUrl.TrimEnd('/')}/{agentId}";

        StartEncoder(encoder, capture, rtspUrl, segmentPattern);

        // ── FileSystemWatcher — detects new segments as FFmpeg creates them ─────
        using var watcher = new FileSystemWatcher(buffer.SegmentsDirectory, "*.ts")
        {
            EnableRaisingEvents = true,
        };
        watcher.Created += (_, e) => OnSegmentCreated(buffer, e.FullPath);

        // ── HTTP client + uploader ──────────────────────────────────────────────
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
        var uploader = new SegmentUploader(
            http, _config.ServerUrl, agentId, buffer,
            _loggerFactory.CreateLogger<SegmentUploader>());

        // ── Register with server ────────────────────────────────────────────────
        await RegisterAsync(http, agentId, stoppingToken);

        // ── Run all loops concurrently ──────────────────────────────────────────
        _logger.LogInformation("[agent] running");

        await Task.WhenAll(
            CaptureLoopAsync(encoder, capture, stoppingToken),
            UploadLoopAsync(uploader, stoppingToken),
            CleanupLoopAsync(buffer, stoppingToken),
            HeartbeatLoopAsync(http, agentId, stoppingToken));
    }

    // ── Capture loop ───────────────────────────────────────────────────────────

    private async Task CaptureLoopAsync(FfmpegEncoder encoder, DxgiCapture capture, CancellationToken ct)
    {
        var frameInterval = TimeSpan.FromSeconds(1.0 / _config.TargetFps);

        while (!ct.IsCancellationRequested)
        {
            var sw = Stopwatch.StartNew();

            try
            {
                if (!encoder.IsRunning)
                {
                    _logger.LogWarning("[agent] FFmpeg exited unexpectedly — restarting in 3s");
                    await Task.Delay(3_000, ct);
                    StartEncoder(encoder, capture,
                        $"{_config.MediaServerUrl.TrimEnd('/')}/{_config.ResolvedAgentId}",
                        Path.Combine(_config.BufferPath, "segments", "seg_%Y%m%d_%H%M%S.ts"));
                }

                var frame = capture.CaptureFrame(timeoutMs: 90);
                if (frame is not null)
                    encoder.WriteFrame(frame);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "[agent] capture error");
            }

            var remaining = frameInterval - sw.Elapsed;
            if (remaining > TimeSpan.Zero)
                await Task.Delay(remaining, ct).ConfigureAwait(false);
        }
    }

    // ── Upload loop — polls every 5 seconds ───────────────────────────────────

    private async Task UploadLoopAsync(SegmentUploader uploader, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await uploader.UploadPendingAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "[agent] upload loop error");
            }

            await Task.Delay(TimeSpan.FromSeconds(5), ct).ConfigureAwait(false);
        }
    }

    // ── Cleanup loop — runs every minute ─────────────────────────────────────

    private async Task CleanupLoopAsync(BufferManager buffer, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                buffer.Cleanup();
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "[agent] cleanup loop error");
            }

            await Task.Delay(TimeSpan.FromMinutes(1), ct).ConfigureAwait(false);
        }
    }

    // ── Heartbeat — re-registers every 5 minutes ─────────────────────────────

    private async Task HeartbeatLoopAsync(HttpClient http, string agentId, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromMinutes(5), ct).ConfigureAwait(false);
            await RegisterAsync(http, agentId, ct);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private void StartEncoder(FfmpegEncoder encoder, DxgiCapture capture, string rtspUrl, string segmentPattern)
    {
        encoder.Start(
            capture.Width,
            capture.Height,
            _config.TargetFps,
            _config.VideoBitrateKbps,
            rtspUrl,
            segmentPattern,
            _config.FfmpegPath);

        _logger.LogInformation("[agent] FFmpeg started → RTSP: {Rtsp}", rtspUrl);
    }

    private void OnSegmentCreated(BufferManager buffer, string fullPath)
    {
        var filename = Path.GetFileName(fullPath);

        // Parse start time from filename: seg_YYYYMMDD_HHMMSS.ts
        if (!TryParseSegmentTime(filename, out var startTime))
        {
            _logger.LogWarning("[agent] unrecognised segment filename: {File}", filename);
            return;
        }

        var endTime = startTime.AddSeconds(_config.SegmentDurationSeconds);
        buffer.AddSegment(filename, startTime, endTime);
    }

    private static bool TryParseSegmentTime(string filename, out DateTime startTime)
    {
        startTime = default;
        // Expected: seg_YYYYMMDD_HHMMSS.ts
        if (!filename.StartsWith("seg_") || !filename.EndsWith(".ts"))
            return false;

        var datePart = filename[4..^3]; // YYYYMMDD_HHMMSS
        return DateTime.TryParseExact(
            datePart,
            "yyyyMMdd_HHmmss",
            null,
            System.Globalization.DateTimeStyles.AssumeUniversal,
            out startTime);
    }

    private async Task RegisterAsync(HttpClient http, string agentId, CancellationToken ct)
    {
        try
        {
            var payload = new
            {
                agent_id = agentId,
                hostname = Environment.MachineName,
                ip       = GetLocalIp(),
            };

            var resp = await http.PostAsJsonAsync(
                $"{_config.ServerUrl.TrimEnd('/')}/ingest/register",
                payload,
                ct);

            if (resp.IsSuccessStatusCode)
                _logger.LogInformation("[agent] registered with server");
            else
                _logger.LogWarning("[agent] registration returned {Status}", resp.StatusCode);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning("[agent] registration failed: {Msg}", ex.Message);
        }
    }

    private static string GetLocalIp()
    {
        var host = Dns.GetHostEntry(Dns.GetHostName());
        return host.AddressList
            .FirstOrDefault(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
            ?.ToString() ?? "unknown";
    }
}
