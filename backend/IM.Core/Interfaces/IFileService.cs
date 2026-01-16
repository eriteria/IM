using IM.Core.Entities;

namespace IM.Core.Interfaces;

public interface IFileService
{
    Task<MediaFile> UploadFileAsync(Guid userId, Stream fileStream, string fileName, string mimeType);
    Task<MediaFile?> GetFileByIdAsync(Guid fileId);
    Task<Stream?> DownloadFileAsync(Guid fileId);
    Task<Stream?> DownloadFileByPathAsync(string relativePath);
    Task<bool> DeleteFileAsync(Guid fileId, Guid userId);
    Task<string> GenerateThumbnailAsync(Stream fileStream, string mimeType);
    Task<IEnumerable<MediaFile>> GetConversationMediaAsync(Guid conversationId, Guid userId, int page = 1, int pageSize = 20);

    /// <summary>
    /// Creates a new copy of a file with forwarder watermark applied (for PDF documents)
    /// </summary>
    Task<string?> CreateForwardedCopyWithWatermarkAsync(string originalFileUrl, Guid forwarderId, string? forwarderServiceNumber, string? forwarderName, int forwardOrder);
}
