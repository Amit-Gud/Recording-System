using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace RecordingAgent.LocalBuffer;

/// <summary>
/// Manages the local 24-hour circular buffer.
///
/// Storage layout:
///   {BufferPath}/
///     index.db           — SQLite index of all segments
///     segments/          — .ts files written by FFmpeg
///       seg_YYYYMMDD_HHMMSS.ts
///
/// Thread-safe: AddSegment, MarkUploaded, GetPendingUploads, and Cleanup
/// may be called from different threads simultaneously.
/// </summary>
public sealed class BufferManager : IDisposable
{
    public string SegmentsDirectory { get; }

    private readonly string _dbPath;
    private readonly int    _maxHours;
    private readonly ILogger<BufferManager> _logger;
    private readonly object _lock = new();
    private SqliteConnection? _conn;

    public BufferManager(string bufferPath, int maxHours, ILogger<BufferManager> logger)
    {
        SegmentsDirectory = Path.Combine(bufferPath, "segments");
        _dbPath   = Path.Combine(bufferPath, "index.db");
        _maxHours = maxHours;
        _logger   = logger;

        Directory.CreateDirectory(SegmentsDirectory);
    }

    public void Initialize()
    {
        _conn = new SqliteConnection($"Data Source={_dbPath};Pooling=False");
        _conn.Open();

        Execute(@"
            CREATE TABLE IF NOT EXISTS segments (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                filename   TEXT    NOT NULL UNIQUE,
                start_time TEXT    NOT NULL,
                end_time   TEXT    NOT NULL,
                uploaded   INTEGER NOT NULL DEFAULT 0
            )");

        Execute("PRAGMA journal_mode=WAL");
        _logger.LogInformation("[buffer] initialized at {Path}", _dbPath);
    }

    /// <summary>Records a newly created segment file.</summary>
    public void AddSegment(string filename, DateTime startTime, DateTime endTime)
    {
        lock (_lock)
        {
            Execute(@"
                INSERT OR IGNORE INTO segments (filename, start_time, end_time)
                VALUES ($fn, $start, $end)",
                ("$fn",    filename),
                ("$start", startTime.ToUniversalTime().ToString("O")),
                ("$end",   endTime.ToUniversalTime().ToString("O")));
        }

        _logger.LogDebug("[buffer] added {Filename}", filename);
    }

    /// <summary>Marks a segment as successfully uploaded to the server.</summary>
    public void MarkUploaded(long id)
    {
        lock (_lock)
        {
            Execute("UPDATE segments SET uploaded = 1 WHERE id = $id", ("$id", id));
        }
    }

    /// <summary>Returns all segments not yet uploaded, ordered by start_time.</summary>
    public IReadOnlyList<SegmentRecord> GetPendingUploads()
    {
        lock (_lock)
        {
            return Query(@"
                SELECT id, filename, start_time, end_time
                FROM segments
                WHERE uploaded = 0
                ORDER BY start_time");
        }
    }

    /// <summary>
    /// Deletes segments older than <see cref="_maxHours"/> hours.
    /// Unuploaded segments that must be evicted are logged as warnings.
    /// </summary>
    public void Cleanup()
    {
        var cutoff = DateTime.UtcNow.AddHours(-_maxHours);

        IReadOnlyList<SegmentRecord> stale;
        lock (_lock)
        {
            stale = Query(@"
                SELECT id, filename, start_time, end_time
                FROM segments
                WHERE start_time < $cutoff
                ORDER BY start_time",
                ("$cutoff", cutoff.ToString("O")));
        }

        if (stale.Count == 0) return;

        int deleted = 0, failed = 0;

        foreach (var seg in stale)
        {
            var fullPath = Path.Combine(SegmentsDirectory, seg.Filename);

            bool isUploaded;
            lock (_lock)
            {
                isUploaded = IsUploaded(seg.Id);
            }

            if (!isUploaded)
                _logger.LogWarning("[buffer] evicting unuploaded segment {File} — server unreachable too long", seg.Filename);

            try
            {
                if (File.Exists(fullPath))
                    File.Delete(fullPath);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[buffer] failed to delete {File}", fullPath);
                failed++;
                continue;
            }

            lock (_lock)
            {
                Execute("DELETE FROM segments WHERE id = $id", ("$id", seg.Id));
            }

            deleted++;
        }

        _logger.LogInformation("[buffer] cleanup: deleted {Deleted}, failed {Failed}", deleted, failed);
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private bool IsUploaded(long id)
    {
        using var cmd = _conn!.CreateCommand();
        cmd.CommandText = "SELECT uploaded FROM segments WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        var val = cmd.ExecuteScalar();
        return val is long l && l == 1;
    }

    private void Execute(string sql, params (string Name, object Value)[] parameters)
    {
        using var cmd = _conn!.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
            cmd.Parameters.AddWithValue(name, value);
        cmd.ExecuteNonQuery();
    }

    private IReadOnlyList<SegmentRecord> Query(string sql, params (string Name, object Value)[] parameters)
    {
        using var cmd = _conn!.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
            cmd.Parameters.AddWithValue(name, value);

        using var reader = cmd.ExecuteReader();
        var result = new List<SegmentRecord>();
        while (reader.Read())
        {
            result.Add(new SegmentRecord(
                reader.GetInt64(0),
                reader.GetString(1),
                DateTime.Parse(reader.GetString(2)).ToUniversalTime(),
                DateTime.Parse(reader.GetString(3)).ToUniversalTime()));
        }
        return result;
    }

    public void Dispose() => _conn?.Dispose();
}

public sealed record SegmentRecord(long Id, string Filename, DateTime StartTime, DateTime EndTime);
