namespace RecordingAgent.Configuration;

public sealed class AgentConfig
{
    /// <summary>Unique identifier sent to the server. Defaults to machine name if empty.</summary>
    public string AgentId { get; set; } = string.Empty;

    /// <summary>Base URL of the Recording Server API gateway, e.g. http://192.168.1.10</summary>
    public string ServerUrl { get; set; } = "http://localhost";

    /// <summary>Base URL of the mediamtx RTSP server, e.g. rtsp://192.168.1.10:8554</summary>
    public string MediaServerUrl { get; set; } = "rtsp://localhost:8554";

    /// <summary>Directory for the local 24-hour circular buffer.</summary>
    public string BufferPath { get; set; } = @"C:\ProgramData\RecordingAgent\buffer";

    /// <summary>Target capture frame rate.</summary>
    public int TargetFps { get; set; } = 10;

    /// <summary>How many hours of recordings to keep in the local buffer.</summary>
    public int BufferHours { get; set; } = 24;

    /// <summary>Duration of each segment file in seconds.</summary>
    public int SegmentDurationSeconds { get; set; } = 60;

    /// <summary>Target H.264 encode bitrate in kbps.</summary>
    public int VideoBitrateKbps { get; set; } = 500;

    /// <summary>Resolved agent ID — machine name fallback applied at startup.</summary>
    public string ResolvedAgentId => string.IsNullOrWhiteSpace(AgentId)
        ? Environment.MachineName
        : AgentId;
}
