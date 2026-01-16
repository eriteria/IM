using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using IM.Core.Entities;
using IM.Core.Interfaces;
using IM.Infrastructure.Data;

namespace IM.Infrastructure.Services;

public class FileService : IFileService
{
    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly IDocumentWatermarkService _watermarkService;
    private readonly ILogger<FileService> _logger;
    private readonly string _uploadPath;
    private readonly string _baseUrl;

    public FileService(
        ApplicationDbContext context,
        IConfiguration configuration,
        IDocumentWatermarkService watermarkService,
        ILogger<FileService> logger)
    {
        _context = context;
        _configuration = configuration;
        _watermarkService = watermarkService;
        _logger = logger;
        _uploadPath = _configuration["FileStorage:UploadPath"] ?? "uploads";
        _baseUrl = _configuration["FileStorage:BaseUrl"] ?? "/api/files";

        // Ensure upload directory exists
        if (!Directory.Exists(_uploadPath))
        {
            Directory.CreateDirectory(_uploadPath);
        }
    }

    public async Task<MediaFile> UploadFileAsync(Guid userId, Stream fileStream, string fileName, string mimeType)
    {
        var fileId = Guid.NewGuid();
        var extension = Path.GetExtension(fileName);
        var storedFileName = $"{fileId}{extension}";
        var relativePath = Path.Combine(DateTime.UtcNow.ToString("yyyy/MM/dd"), storedFileName);
        var fullPath = Path.Combine(_uploadPath, relativePath);

        // Create directory if not exists
        var directory = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
        {
            Directory.CreateDirectory(directory);
        }

        // Get user's service number for watermarking
        var user = await _context.Users
            .Include(u => u.NominalRoll)
            .FirstOrDefaultAsync(u => u.Id == userId);

        var serviceNumber = user?.NominalRoll?.ServiceNumber;
        var uploaderName = user?.DisplayName ?? user?.NominalRoll?.FullName;

        // Apply watermark to PDF documents
        Stream streamToSave = fileStream;
        if (_watermarkService.CanWatermark(mimeType, fileName) && !string.IsNullOrEmpty(serviceNumber))
        {
            try
            {
                _logger.LogInformation("Adding uploader watermark to PDF: {FileName} by {ServiceNumber}", fileName, serviceNumber);
                streamToSave = await _watermarkService.AddUploaderWatermarkAsync(fileStream, serviceNumber, uploaderName);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to watermark PDF, saving original file");
                // Continue with original stream if watermarking fails
                if (fileStream.CanSeek)
                    fileStream.Position = 0;
                streamToSave = fileStream;
            }
        }

        // Save file
        using (var fs = new FileStream(fullPath, FileMode.Create))
        {
            await streamToSave.CopyToAsync(fs);
        }

        // Dispose watermarked stream if it's different from original
        if (streamToSave != fileStream)
        {
            await streamToSave.DisposeAsync();
        }

        var fileInfo = new FileInfo(fullPath);

        var mediaFile = new MediaFile
        {
            Id = fileId,
            UploadedById = userId,
            FileName = fileName,
            FileUrl = $"{_baseUrl}/{relativePath.Replace("\\", "/")}",
            MimeType = mimeType,
            FileSize = fileInfo.Length
        };

        // Generate thumbnail for images
        if (mimeType.StartsWith("image/"))
        {
            try
            {
                fileStream.Position = 0;
                var thumbnailUrl = await GenerateThumbnailAsync(fileStream, mimeType);
                mediaFile.ThumbnailUrl = thumbnailUrl;
            }
            catch
            {
                // Ignore thumbnail generation errors
            }
        }

        await _context.MediaFiles.AddAsync(mediaFile);
        await _context.SaveChangesAsync();

        return mediaFile;
    }

    public async Task<MediaFile?> GetFileByIdAsync(Guid fileId)
    {
        return await _context.MediaFiles.FindAsync(fileId);
    }

    public async Task<Stream?> DownloadFileAsync(Guid fileId)
    {
        var mediaFile = await _context.MediaFiles.FindAsync(fileId);
        if (mediaFile == null)
            return null;

        var relativePath = mediaFile.FileUrl.Replace(_baseUrl + "/", "");
        var fullPath = Path.Combine(_uploadPath, relativePath);

        if (!File.Exists(fullPath))
            return null;

        return new FileStream(fullPath, FileMode.Open, FileAccess.Read);
    }

    public Task<Stream?> DownloadFileByPathAsync(string relativePath)
    {
        var fullPath = Path.Combine(_uploadPath, relativePath);

        if (!File.Exists(fullPath))
            return Task.FromResult<Stream?>(null);

        return Task.FromResult<Stream?>(new FileStream(fullPath, FileMode.Open, FileAccess.Read));
    }

    public async Task<bool> DeleteFileAsync(Guid fileId, Guid userId)
    {
        var mediaFile = await _context.MediaFiles.FindAsync(fileId);
        if (mediaFile == null || mediaFile.UploadedById != userId)
            return false;

        var relativePath = mediaFile.FileUrl.Replace(_baseUrl + "/", "");
        var fullPath = Path.Combine(_uploadPath, relativePath);

        if (File.Exists(fullPath))
        {
            File.Delete(fullPath);
        }

        // Delete thumbnail if exists
        if (!string.IsNullOrEmpty(mediaFile.ThumbnailUrl))
        {
            var thumbnailPath = mediaFile.ThumbnailUrl.Replace(_baseUrl + "/", "");
            var fullThumbnailPath = Path.Combine(_uploadPath, thumbnailPath);
            if (File.Exists(fullThumbnailPath))
            {
                File.Delete(fullThumbnailPath);
            }
        }

        _context.MediaFiles.Remove(mediaFile);
        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<string> GenerateThumbnailAsync(Stream fileStream, string mimeType)
    {
        // For now, return empty - thumbnail generation would require a library like ImageSharp
        // In production, you would use a library to resize images
        await Task.CompletedTask;
        return string.Empty;
    }

    public async Task<IEnumerable<MediaFile>> GetConversationMediaAsync(Guid conversationId, Guid userId, int page = 1, int pageSize = 20)
    {
        // Verify user is a participant
        var isParticipant = await _context.ConversationParticipants
            .AnyAsync(p => p.ConversationId == conversationId && p.UserId == userId && p.IsActive);

        if (!isParticipant)
            return Enumerable.Empty<MediaFile>();

        return await _context.MediaFiles
            .Include(m => m.Message)
            .Where(m => m.Message != null && m.Message.ConversationId == conversationId && !m.Message.IsDeleted)
            .OrderByDescending(m => m.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();
    }

    public async Task<string?> CreateForwardedCopyWithWatermarkAsync(
        string originalFileUrl,
        Guid forwarderId,
        string? forwarderServiceNumber,
        string? forwarderName,
        int forwardOrder)
    {
        // Only process if we have a service number and the file is a PDF
        if (string.IsNullOrEmpty(forwarderServiceNumber))
        {
            _logger.LogDebug("No service number provided for forwarding watermark");
            return null;
        }

        // Extract the relative path from the URL
        var relativePath = originalFileUrl.Replace(_baseUrl + "/", "");
        var fullPath = Path.Combine(_uploadPath, relativePath);

        if (!File.Exists(fullPath))
        {
            _logger.LogWarning("Original file not found for watermarking: {Path}", fullPath);
            return null;
        }

        // Check if it's a PDF
        var extension = Path.GetExtension(fullPath).ToLowerInvariant();
        if (extension != ".pdf")
        {
            _logger.LogDebug("File is not a PDF, skipping watermark: {Extension}", extension);
            return null;
        }

        try
        {
            // Read the original file
            using var originalStream = new FileStream(fullPath, FileMode.Open, FileAccess.Read);

            // Apply watermark
            var watermarkedStream = await _watermarkService.AddForwarderWatermarkAsync(
                originalStream,
                forwarderServiceNumber,
                forwarderName,
                forwardOrder);

            // Create new file with watermark
            var newFileId = Guid.NewGuid();
            var newFileName = $"{newFileId}{extension}";
            var newRelativePath = Path.Combine(DateTime.UtcNow.ToString("yyyy/MM/dd"), newFileName);
            var newFullPath = Path.Combine(_uploadPath, newRelativePath);

            // Ensure directory exists
            var directory = Path.GetDirectoryName(newFullPath);
            if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            // Save the watermarked file
            using (var fs = new FileStream(newFullPath, FileMode.Create))
            {
                await watermarkedStream.CopyToAsync(fs);
            }

            await watermarkedStream.DisposeAsync();

            var newUrl = $"{_baseUrl}/{newRelativePath.Replace("\\", "/")}";
            _logger.LogInformation("Created forwarded copy with watermark: {Url} by {ServiceNumber}", newUrl, forwarderServiceNumber);

            return newUrl;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create forwarded copy with watermark");
            return null;
        }
    }
}
