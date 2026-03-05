using Microsoft.Extensions.Logging;
using RecordingAgent.LocalBuffer;

namespace RecordingAgent.Uploader;

/// <summary>
/// Polls the local buffer for unuploaded segments and POSTs them to ingest-service.
/// Retries up to 4 times with exponential backoff (2s → 4s → 8s → 16s).
/// </summary>
public sealed class SegmentUploader
{
    private static readonly int[] BackoffMs = { 2_000, 4_000, 8_000, 16_000 };

    private readonly HttpClient _http;
    private readonly string     _serverUrl;
    private readonly string     _agentId;
    private readonly BufferManager _buffer;
    private readonly ILogger<SegmentUploader> _logger;

    public SegmentUploader(
        HttpClient http,
        string serverUrl,
        string agentId,
        BufferManager buffer,
        ILogger<SegmentUploader> logger)
    {
        _http      = http;
        _serverUrl = serverUrl.TrimEnd('/');
        _agentId   = agentId;
        _buffer    = buffer;
        _logger    = logger;
    }

    /// <summary>Uploads all pending segments. Called every few seconds from the Worker loop.</summary>
    public async Task UploadPendingAsync(CancellationToken ct)
    {
        var pending = _buffer.GetPendingUploads();
        foreach (var seg in pending)
        {
            if (ct.IsCancellationRequested) return;

            var fullPath = Path.Combine(_buffer.SegmentsDirectory, seg.Filename);

            if (!File.Exists(fullPath))
            {
                // File was cleaned up externally — mark done and skip
                _buffer.MarkUploaded(seg.Id);
                continue;
            }

            var success = await UploadWithRetryAsync(seg, fullPath, ct);
            if (success)
            {
                _buffer.MarkUploaded(seg.Id);
                _logger.LogInformation("[upload] uploaded {Filename}", seg.Filename);
            }
        }
    }

    private async Task<bool> UploadWithRetryAsync(
        SegmentRecord seg, string fullPath, CancellationToken ct)
    {
        for (int attempt = 0; attempt <= BackoffMs.Length; attempt++)
        {
            try
            {
                await using var stream = File.OpenRead(fullPath);

                using var form = new MultipartFormDataContent();
                form.Add(new StringContent(_agentId),                 "agent_id");
                form.Add(new StringContent(seg.StartTime.ToString("O")), "start_time");
                form.Add(new StringContent(seg.EndTime.ToString("O")),   "end_time");
                form.Add(new StreamContent(stream), "segment", seg.Filename);

                var response = await _http.PostAsync(
                    $"{_serverUrl}/ingest/segment", form, ct);

                if (response.IsSuccessStatusCode) return true;

                _logger.LogWarning("[upload] attempt {Attempt}/{Max} failed with {Status} for {File}",
                    attempt + 1, BackoffMs.Length + 1, response.StatusCode, seg.Filename);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "[upload] attempt {Attempt}/{Max} error for {File}",
                    attempt + 1, BackoffMs.Length + 1, seg.Filename);
            }

            if (attempt < BackoffMs.Length)
                await Task.Delay(BackoffMs[attempt], ct);
        }

        _logger.LogError("[upload] all attempts exhausted for {File} — will retry next cycle", seg.Filename);
        return false;
    }
}
