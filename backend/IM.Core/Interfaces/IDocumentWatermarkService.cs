namespace IM.Core.Interfaces;

public interface IDocumentWatermarkService
{
    /// <summary>
    /// Adds a watermark to a PDF document with the uploader's service number
    /// </summary>
    /// <param name="inputStream">The original PDF stream</param>
    /// <param name="serviceNumber">The service number to watermark</param>
    /// <param name="uploaderName">Optional name of the uploader</param>
    /// <returns>A new stream with the watermarked PDF</returns>
    Task<Stream> AddUploaderWatermarkAsync(Stream inputStream, string serviceNumber, string? uploaderName = null);

    /// <summary>
    /// Adds a forwarding watermark to a PDF document
    /// </summary>
    /// <param name="inputStream">The PDF stream (may already have watermarks)</param>
    /// <param name="forwarderServiceNumber">The service number of the person forwarding</param>
    /// <param name="forwarderName">Optional name of the forwarder</param>
    /// <param name="forwardOrder">The order in the forward chain (1st forward, 2nd forward, etc.)</param>
    /// <returns>A new stream with the updated watermarks</returns>
    Task<Stream> AddForwarderWatermarkAsync(Stream inputStream, string forwarderServiceNumber, string? forwarderName = null, int forwardOrder = 1);

    /// <summary>
    /// Checks if a file is a PDF that can be watermarked
    /// </summary>
    bool CanWatermark(string mimeType, string fileName);
}
