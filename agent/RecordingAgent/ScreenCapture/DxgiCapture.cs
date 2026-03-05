using System.Runtime.InteropServices;
using SharpDX;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using Device = SharpDX.Direct3D11.Device;
using Resource = SharpDX.DXGI.Resource;

namespace RecordingAgent.ScreenCapture;

/// <summary>
/// Captures the desktop using the DXGI Desktop Duplication API.
/// Produces raw BGRA frames suitable for piping to FFmpeg.
/// Cursor is composited onto each frame before returning.
/// </summary>
public sealed class DxgiCapture : IDisposable
{
    private Device? _device;
    private Output1? _output;
    private OutputDuplication? _duplication;
    private Texture2D? _stagingTexture;

    private CursorState _cursor = new();

    public int Width  { get; private set; }
    public int Height { get; private set; }

    public void Initialize(int adapterIndex = 0, int outputIndex = 0)
    {
        using var factory = new Factory1();
        var adapter = factory.GetAdapter1(adapterIndex);
        _device = new Device(adapter);

        var output = adapter.GetOutput(outputIndex);
        var bounds = output.Description.DesktopBounds;
        Width  = bounds.Right  - bounds.Left;
        Height = bounds.Bottom - bounds.Top;

        _output = output.QueryInterface<Output1>();
        _duplication = _output.DuplicateOutput(_device);

        _stagingTexture = new Texture2D(_device, new Texture2DDescription
        {
            Width             = Width,
            Height            = Height,
            MipLevels         = 1,
            ArraySize         = 1,
            Format            = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0),
            Usage             = ResourceUsage.Staging,
            BindFlags         = BindFlags.None,
            CpuAccessFlags    = CpuAccessFlags.Read,
        });
    }

    /// <summary>
    /// Captures a frame. Returns raw BGRA bytes with cursor composited, or null if no new
    /// frame was available within <paramref name="timeoutMs"/>.
    /// </summary>
    public byte[]? CaptureFrame(int timeoutMs = 100)
    {
        if (_duplication is null || _device is null || _stagingTexture is null)
            throw new InvalidOperationException("Call Initialize() first.");

        try
        {
            _duplication.AcquireNextFrame(timeoutMs, out var frameInfo, out var screenResource);

            // Update stored cursor state if it changed this frame
            if (frameInfo.PointerPosition.Visible || frameInfo.PointerShapeBufferSize > 0)
                UpdateCursor(frameInfo);

            using (screenResource)
            using (var screenTexture = screenResource.QueryInterface<Texture2D>())
            {
                _device.ImmediateContext.CopyResource(screenTexture, _stagingTexture);
            }

            _duplication.ReleaseFrame();

            return ReadAndCompositeCursor();
        }
        catch (SharpDXException ex) when (ex.ResultCode == ResultCode.WaitTimeout)
        {
            return null;
        }
    }

    // ── Cursor handling ────────────────────────────────────────────────────────

    private void UpdateCursor(OutputDuplicateFrameInformation frameInfo)
    {
        _cursor.Visible = frameInfo.PointerPosition.Visible;
        _cursor.X       = frameInfo.PointerPosition.Position.X;
        _cursor.Y       = frameInfo.PointerPosition.Position.Y;

        if (frameInfo.PointerShapeBufferSize > 0)
        {
            var shapeBuffer = new byte[frameInfo.PointerShapeBufferSize];
            _duplication!.GetFramePointerShape(
                frameInfo.PointerShapeBufferSize,
                out var shapeData,
                out _,
                out var shapeInfo);

            Marshal.Copy(shapeData.Pointer, shapeBuffer, 0, shapeBuffer.Length);

            _cursor.Shape  = shapeBuffer;
            _cursor.ShapeW = shapeInfo.Width;
            _cursor.ShapeH = shapeInfo.Height;
            _cursor.Type   = shapeInfo.Type;
        }
    }

    private byte[] ReadAndCompositeCursor()
    {
        var dataBox = _device!.ImmediateContext
            .MapSubresource(_stagingTexture!, 0, MapMode.Read, MapFlags.None);

        int stride = Width * 4;
        var buffer = new byte[Height * stride];

        try
        {
            for (int row = 0; row < Height; row++)
            {
                Marshal.Copy(
                    dataBox.DataPointer + row * dataBox.RowPitch,
                    buffer,
                    row * stride,
                    stride);
            }
        }
        finally
        {
            _device.ImmediateContext.UnmapSubresource(_stagingTexture!, 0);
        }

        if (_cursor.Visible && _cursor.Shape is not null)
            CompositeCursor(buffer, stride);

        return buffer;
    }

    /// <summary>Alpha-blends the cursor shape onto the BGRA frame buffer.</summary>
    private void CompositeCursor(byte[] frame, int frameStride)
    {
        // Only BGRA (type 4) cursors are handled; masked cursors are skipped for brevity.
        if (_cursor.Type != 4 || _cursor.Shape is null) return;

        int cursorStride = _cursor.ShapeW * 4;

        for (int row = 0; row < _cursor.ShapeH; row++)
        {
            int dstY = _cursor.Y + row;
            if (dstY < 0 || dstY >= Height) continue;

            for (int col = 0; col < _cursor.ShapeW; col++)
            {
                int dstX = _cursor.X + col;
                if (dstX < 0 || dstX >= Width) continue;

                int srcIdx = row * cursorStride + col * 4;
                int dstIdx = dstY * frameStride  + dstX * 4;

                byte srcA = _cursor.Shape[srcIdx + 3];
                if (srcA == 0) continue;

                float alpha = srcA / 255f;
                float inv   = 1f - alpha;

                frame[dstIdx + 0] = (byte)(frame[dstIdx + 0] * inv + _cursor.Shape[srcIdx + 0] * alpha);
                frame[dstIdx + 1] = (byte)(frame[dstIdx + 1] * inv + _cursor.Shape[srcIdx + 1] * alpha);
                frame[dstIdx + 2] = (byte)(frame[dstIdx + 2] * inv + _cursor.Shape[srcIdx + 2] * alpha);
            }
        }
    }

    public void Dispose()
    {
        _stagingTexture?.Dispose();
        _duplication?.Dispose();
        _output?.Dispose();
        _device?.Dispose();
    }

    private sealed class CursorState
    {
        public bool   Visible { get; set; }
        public int    X       { get; set; }
        public int    Y       { get; set; }
        public byte[]? Shape  { get; set; }
        public int    ShapeW  { get; set; }
        public int    ShapeH  { get; set; }
        public int    Type    { get; set; }
    }
}
