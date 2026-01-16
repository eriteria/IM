using iText.Kernel.Colors;
using iText.Kernel.Font;
using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas;
using iText.Kernel.Pdf.Extgstate;
using iText.Layout;
using iText.Layout.Element;
using iText.Layout.Properties;
using IM.Core.Interfaces;
using Microsoft.Extensions.Logging;

namespace IM.Infrastructure.Services;

public class DocumentWatermarkService : IDocumentWatermarkService
{
    private readonly ILogger<DocumentWatermarkService> _logger;

    public DocumentWatermarkService(ILogger<DocumentWatermarkService> logger)
    {
        _logger = logger;
    }

    public bool CanWatermark(string mimeType, string fileName)
    {
        // Only watermark PDF files
        return mimeType.Equals("application/pdf", StringComparison.OrdinalIgnoreCase) ||
               fileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase);
    }

    public async Task<Stream> AddUploaderWatermarkAsync(Stream inputStream, string serviceNumber, string? uploaderName = null)
    {
        return await Task.Run(() =>
        {
            try
            {
                var outputStream = new MemoryStream();

                // Copy input to a MemoryStream since we need seekable stream
                var inputMemory = new MemoryStream();
                inputStream.CopyTo(inputMemory);
                inputMemory.Position = 0;

                using (var pdfReader = new PdfReader(inputMemory))
                using (var pdfWriter = new PdfWriter(outputStream))
                {
                    // Keep output stream open after PdfDocument is disposed
                    pdfWriter.SetCloseStream(false);

                    using (var pdfDoc = new PdfDocument(pdfReader, pdfWriter))
                    {
                        var watermarkText = $"Uploaded by: {serviceNumber}";
                        if (!string.IsNullOrEmpty(uploaderName))
                        {
                            watermarkText = $"Uploaded by: {uploaderName} ({serviceNumber})";
                        }

                        var timestamp = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC");
                        var fullWatermark = $"{watermarkText} | {timestamp}";

                        AddFooterWatermark(pdfDoc, fullWatermark, 0);
                    }
                }

                outputStream.Position = 0;
                return (Stream)outputStream;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to add uploader watermark to PDF");
                // Return original stream if watermarking fails
                inputStream.Position = 0;
                var fallbackStream = new MemoryStream();
                inputStream.CopyTo(fallbackStream);
                fallbackStream.Position = 0;
                return fallbackStream;
            }
        });
    }

    public async Task<Stream> AddForwarderWatermarkAsync(Stream inputStream, string forwarderServiceNumber, string? forwarderName = null, int forwardOrder = 1)
    {
        return await Task.Run(() =>
        {
            try
            {
                var outputStream = new MemoryStream();

                // Copy input to a MemoryStream since we need seekable stream
                var inputMemory = new MemoryStream();
                inputStream.CopyTo(inputMemory);
                inputMemory.Position = 0;

                using (var pdfReader = new PdfReader(inputMemory))
                using (var pdfWriter = new PdfWriter(outputStream))
                {
                    // Keep output stream open after PdfDocument is disposed
                    pdfWriter.SetCloseStream(false);

                    using (var pdfDoc = new PdfDocument(pdfReader, pdfWriter))
                    {
                        var forwardLabel = forwardOrder == 1 ? "1st" :
                                          forwardOrder == 2 ? "2nd" :
                                          forwardOrder == 3 ? "3rd" :
                                          $"{forwardOrder}th";

                        var watermarkText = $"{forwardLabel} Forward by: {forwarderServiceNumber}";
                        if (!string.IsNullOrEmpty(forwarderName))
                        {
                            watermarkText = $"{forwardLabel} Forward by: {forwarderName} ({forwarderServiceNumber})";
                        }

                        var timestamp = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC");
                        var fullWatermark = $"{watermarkText} | {timestamp}";

                        // Add forward watermark on a new line below existing watermarks
                        AddFooterWatermark(pdfDoc, fullWatermark, forwardOrder);
                    }
                }

                outputStream.Position = 0;
                return (Stream)outputStream;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to add forwarder watermark to PDF");
                // Return original stream if watermarking fails
                inputStream.Position = 0;
                var fallbackStream = new MemoryStream();
                inputStream.CopyTo(fallbackStream);
                fallbackStream.Position = 0;
                return fallbackStream;
            }
        });
    }

    private void AddFooterWatermark(PdfDocument pdfDoc, string watermarkText, int lineIndex)
    {
        var numberOfPages = pdfDoc.GetNumberOfPages();
        var font = PdfFontFactory.CreateFont(iText.IO.Font.Constants.StandardFonts.HELVETICA);
        var fontSize = 8f;
        var lineHeight = 12f;
        var bottomMargin = 10f + (lineIndex * lineHeight);

        for (int i = 1; i <= numberOfPages; i++)
        {
            var page = pdfDoc.GetPage(i);
            var pageSize = page.GetPageSize();
            var canvas = new PdfCanvas(page);

            // Set transparency for watermark
            var gs1 = new PdfExtGState();
            gs1.SetFillOpacity(0.6f);
            canvas.SetExtGState(gs1);

            // Draw gray background rectangle for watermark
            canvas.SaveState();
            canvas.SetFillColor(ColorConstants.LIGHT_GRAY);
            canvas.Rectangle(0, bottomMargin - 2, pageSize.GetWidth(), lineHeight);
            canvas.Fill();
            canvas.RestoreState();

            // Reset opacity for text
            var gs2 = new PdfExtGState();
            gs2.SetFillOpacity(1f);
            canvas.SetExtGState(gs2);

            // Add watermark text
            canvas.BeginText();
            canvas.SetFontAndSize(font, fontSize);
            canvas.SetFillColor(new DeviceRgb(80, 80, 80)); // Dark gray text
            canvas.MoveText(10, bottomMargin);
            canvas.ShowText(watermarkText);
            canvas.EndText();
        }
    }
}
