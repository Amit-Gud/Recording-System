using System.Diagnostics;

namespace RecordingAgent.Encoder;

/// <summary>
/// Wraps an FFmpeg child process.
/// Accepts raw BGRA frames via stdin and simultaneously outputs:
///   1. An RTSP stream to mediamtx (for live WebRTC viewing)
///   2. Segmented MPEG-TS files to disk (for local buffer + upload)
/// </summary>
public sealed class FfmpegEncoder : IDisposable
{
    private Process?  _process;
    private Stream?   _stdin;
    private bool      _disposed;

    public bool IsRunning => _process is { HasExited: false };

    /// <param name="width">Frame width in pixels.</param>
    /// <param name="height">Frame height in pixels.</param>
    /// <param name="fps">Target frames per second.</param>
    /// <param name="bitrateKbps">H.264 target bitrate in kbps.</param>
    /// <param name="rtspUrl">Full RTSP push URL, e.g. rtsp://server:8554/DESKTOP-01</param>
    /// <param name="segmentPattern">
    /// Absolute path pattern for output segments.
    /// Must end with %Y%m%d_%H%M%S.ts, e.g. C:\...\buffer\segments\seg_%Y%m%d_%H%M%S.ts
    /// </param>
    public void Start(int width, int height, int fps, int bitrateKbps, string rtspUrl, string segmentPattern)
    {
        // The tee muxer outputs simultaneously to RTSP and segmented files.
        // Each output can have per-muxer options in [brackets].
        var teeOutput =
            $"[f=rtsp:rtsp_transport=tcp]{rtspUrl}" +
            $"|[f=segment:segment_time=60:segment_format=mpegts:strftime=1:reset_timestamps=1]{segmentPattern}";

        var psi = new ProcessStartInfo
        {
            FileName         = "ffmpeg",
            UseShellExecute  = false,
            RedirectStandardInput = true,
            CreateNoWindow   = true,
        };

        // Using ArgumentList avoids all shell-quoting issues on Windows
        foreach (var arg in BuildArguments(width, height, fps, bitrateKbps, teeOutput))
            psi.ArgumentList.Add(arg);

        _process = new Process { StartInfo = psi };
        _process.Exited += (_, _) => OnProcessExited();
        _process.EnableRaisingEvents = true;
        _process.Start();

        _stdin = _process.StandardInput.BaseStream;
    }

    /// <summary>Writes one raw BGRA frame to the encoder stdin pipe.</summary>
    public void WriteFrame(byte[] frame)
    {
        if (_stdin is null || !IsRunning) return;

        try
        {
            _stdin.Write(frame);
        }
        catch (IOException)
        {
            // FFmpeg closed the pipe — caller should detect IsRunning == false and restart
        }
    }

    private static IEnumerable<string> BuildArguments(
        int width, int height, int fps, int bitrateKbps, string teeOutput)
    {
        // Input: raw video from stdin
        yield return "-f";         yield return "rawvideo";
        yield return "-pix_fmt";   yield return "bgra";
        yield return "-s";         yield return $"{width}x{height}";
        yield return "-r";         yield return fps.ToString();
        yield return "-i";         yield return "pipe:0";

        // Encoding
        yield return "-c:v";       yield return "libx264";
        yield return "-preset";    yield return "ultrafast";
        yield return "-tune";      yield return "zerolatency";
        yield return "-b:v";       yield return $"{bitrateKbps}k";
        yield return "-maxrate";   yield return $"{bitrateKbps + 100}k";
        yield return "-bufsize";   yield return $"{bitrateKbps * 2}k";

        // Pixel format compatible with most players
        yield return "-pix_fmt";   yield return "yuv420p";

        // Dual output via tee muxer
        yield return "-f";         yield return "tee";
        yield return teeOutput;
    }

    private void OnProcessExited()
    {
        // Logged by Worker — no action needed here
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _stdin?.Close(); } catch { /* ignore */ }
        _process?.WaitForExit(5_000);
        _process?.Dispose();
    }
}
