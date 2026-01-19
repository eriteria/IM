using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using IM.Core.Entities;
using IM.Core.Enums;
using IM.Core.Interfaces;
using IM.Infrastructure.Data;

namespace IM.Infrastructure.Services;

public class MessageService : IMessageService
{
    private readonly ApplicationDbContext _context;
    private readonly IEncryptionService _encryptionService;
    private readonly IFileService _fileService;
    private readonly ILogger<MessageService> _logger;

    public MessageService(
        ApplicationDbContext context,
        IEncryptionService encryptionService,
        IFileService fileService,
        ILogger<MessageService> logger)
    {
        _context = context;
        _encryptionService = encryptionService;
        _fileService = fileService;
        _logger = logger;
    }

    public async Task<Message> SendMessageAsync(Guid conversationId, Guid senderId, MessageType type, string? content, string? mediaUrl = null, Guid? replyToMessageId = null)
    {
        var conversation = await _context.Conversations
            .Include(c => c.Participants)
            .FirstOrDefaultAsync(c => c.Id == conversationId);

        if (conversation == null)
            throw new InvalidOperationException("Conversation not found");

        var participant = conversation.Participants.FirstOrDefault(p => p.UserId == senderId && p.IsActive);
        if (participant == null)
            throw new InvalidOperationException("User is not a participant of this conversation");

        // Get sender's Service Number for watermark
        var sender = await _context.Users
            .Include(u => u.NominalRoll)
            .FirstOrDefaultAsync(u => u.Id == senderId);
        var senderServiceNumber = sender?.NominalRoll?.ServiceNumber;

        DateTime? expiresAt = null;
        if (conversation.DefaultMessageExpiry != MessageExpiry.Never)
        {
            expiresAt = DateTime.UtcNow.AddHours((int)conversation.DefaultMessageExpiry);
        }

        // Encrypt content before saving to database
        string? encryptedContent = content;
        if (!string.IsNullOrEmpty(content))
        {
            _logger.LogInformation("Encrypting message content. Original length: {Length}", content.Length);
            encryptedContent = _encryptionService.Encrypt(content);
            _logger.LogInformation("Message encrypted. Encrypted length: {Length}, IsEncrypted: {IsEncrypted}",
                encryptedContent?.Length ?? 0, encryptedContent != content);
        }

        var message = new Message
        {
            ConversationId = conversationId,
            SenderId = senderId,
            Type = type,
            Content = encryptedContent,
            MediaUrl = mediaUrl,
            ReplyToMessageId = replyToMessageId,
            ExpiryDuration = conversation.DefaultMessageExpiry,
            ExpiresAt = expiresAt,
            // Service Number watermarks
            SenderServiceNumber = senderServiceNumber,
            MediaOriginatorServiceNumber = mediaUrl != null ? senderServiceNumber : null
        };

        await _context.Messages.AddAsync(message);

        // Create message status for all participants except sender
        var recipientIds = conversation.Participants
            .Where(p => p.UserId != senderId && p.IsActive)
            .Select(p => p.UserId);

        foreach (var recipientId in recipientIds)
        {
            await _context.MessageStatuses.AddAsync(new MessageStatusEntity
            {
                MessageId = message.Id,
                UserId = recipientId,
                Status = MessageStatus.Sent
            });
        }

        // Update conversation last message time
        conversation.LastMessageAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();

        // Load the reply message if exists
        if (replyToMessageId.HasValue)
        {
            message.ReplyToMessage = await _context.Messages
                .Include(m => m.Sender)
                    .ThenInclude(s => s.NominalRoll)
                .FirstOrDefaultAsync(m => m.Id == replyToMessageId.Value);

            if (message.ReplyToMessage != null)
            {
                DecryptMessage(message.ReplyToMessage);
            }
        }

        // Decrypt content before returning
        if (!string.IsNullOrEmpty(message.Content))
        {
            message.Content = _encryptionService.Decrypt(message.Content);
        }

        return message;
    }

    private void DecryptMessage(Message message)
    {
        if (!string.IsNullOrEmpty(message.Content))
        {
            message.Content = _encryptionService.Decrypt(message.Content);
        }
    }

    public async Task<Message?> GetMessageByIdAsync(Guid messageId)
    {
        var message = await _context.Messages
            .Include(m => m.Sender)
                .ThenInclude(s => s.NominalRoll)
            .Include(m => m.Statuses)
            .Include(m => m.ReplyToMessage)
            .FirstOrDefaultAsync(m => m.Id == messageId && !m.IsDeleted);

        if (message != null)
        {
            DecryptMessage(message);
        }

        return message;
    }

    public async Task<IEnumerable<Message>> GetConversationMessagesAsync(Guid conversationId, int page = 1, int pageSize = 50)
    {
        var messages = await _context.Messages
            .Include(m => m.Sender)
                .ThenInclude(s => s.NominalRoll)
            .Include(m => m.Statuses)
            .Include(m => m.ReplyToMessage)
                .ThenInclude(r => r!.Sender)
                    .ThenInclude(s => s.NominalRoll)
            .Where(m => m.ConversationId == conversationId && !m.IsDeleted)
            .OrderByDescending(m => m.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        // Decrypt all messages in parallel for better performance
        await Task.Run(() =>
        {
            Parallel.ForEach(messages, message =>
            {
                DecryptMessage(message);
                if (message.ReplyToMessage != null)
                {
                    DecryptMessage(message.ReplyToMessage);
                }
            });
        });

        return messages;
    }

    public async Task<bool> UpdateMessageStatusAsync(Guid messageId, Guid userId, MessageStatus status)
    {
        var messageStatus = await _context.MessageStatuses
            .FirstOrDefaultAsync(ms => ms.MessageId == messageId && ms.UserId == userId);

        if (messageStatus == null)
            return false;

        messageStatus.Status = status;

        if (status == MessageStatus.Delivered)
            messageStatus.DeliveredAt = DateTime.UtcNow;
        else if (status == MessageStatus.Read)
            messageStatus.ReadAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<bool> MarkAsDeliveredAsync(Guid messageId, Guid userId)
    {
        return await UpdateMessageStatusAsync(messageId, userId, MessageStatus.Delivered);
    }

    public async Task<bool> MarkAsReadAsync(Guid messageId, Guid userId)
    {
        return await UpdateMessageStatusAsync(messageId, userId, MessageStatus.Read);
    }

    /// <summary>
    /// Marks all unread messages in a conversation as read for a user in a single batch operation.
    /// This is much more efficient than marking messages one by one.
    /// </summary>
    public async Task<int> MarkConversationAsReadAsync(Guid conversationId, Guid userId)
    {
        var now = DateTime.UtcNow;

        // Get all unread message statuses for this user in this conversation
        var unreadStatuses = await _context.MessageStatuses
            .Include(ms => ms.Message)
            .Where(ms => ms.UserId == userId
                && ms.Message.ConversationId == conversationId
                && ms.Status != MessageStatus.Read)
            .ToListAsync();

        if (unreadStatuses.Count == 0)
            return 0;

        // Batch update all statuses
        foreach (var status in unreadStatuses)
        {
            status.Status = MessageStatus.Read;
            status.ReadAt = now;
        }

        await _context.SaveChangesAsync();
        return unreadStatuses.Count;
    }

    public async Task<bool> DeleteMessageAsync(Guid messageId, Guid userId, bool forEveryone = false)
    {
        var message = await _context.Messages.FindAsync(messageId);
        if (message == null)
            return false;

        if (forEveryone)
        {
            if (message.SenderId != userId)
                return false;

            message.IsDeleted = true;
            message.DeletedAt = DateTime.UtcNow;
            message.Content = null;
            message.MediaUrl = null;
        }
        else
        {
            // For local delete, we could add a separate table for deleted messages per user
            // For now, we'll just mark as deleted for everyone if user is sender
            if (message.SenderId == userId)
            {
                message.IsDeleted = true;
                message.DeletedAt = DateTime.UtcNow;
            }
        }

        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<Message?> EditMessageAsync(Guid messageId, Guid userId, string newContent)
    {
        var message = await _context.Messages.FindAsync(messageId);
        if (message == null || message.SenderId != userId || message.IsDeleted)
            return null;

        // Can only edit text messages
        if (message.Type != MessageType.Text)
            return null;

        // Encrypt the new content
        message.Content = _encryptionService.Encrypt(newContent);
        message.IsEdited = true;
        message.EditedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();

        // Decrypt before returning
        message.Content = newContent; // Return the plain text to the client

        return message;
    }

    public async Task<IEnumerable<Message>> SearchMessagesAsync(Guid userId, string query, int page = 1, int pageSize = 20)
    {
        var userConversationIds = await _context.ConversationParticipants
            .Where(p => p.UserId == userId && p.IsActive)
            .Select(p => p.ConversationId)
            .ToListAsync();

        // Note: For production, consider using a separate search index or searchable encryption
        // This approach decrypts all messages which is not efficient for large datasets
        var allMessages = await _context.Messages
            .Include(m => m.Sender)
            .Include(m => m.Conversation)
            .Where(m => userConversationIds.Contains(m.ConversationId) &&
                       !m.IsDeleted &&
                       m.Type == MessageType.Text &&
                       m.Content != null)
            .OrderByDescending(m => m.CreatedAt)
            .ToListAsync();

        // Decrypt and filter
        var matchingMessages = new List<Message>();
        foreach (var message in allMessages)
        {
            var decryptedContent = _encryptionService.Decrypt(message.Content!);
            if (decryptedContent.Contains(query, StringComparison.OrdinalIgnoreCase))
            {
                message.Content = decryptedContent;
                matchingMessages.Add(message);
            }

            if (matchingMessages.Count >= (page * pageSize))
                break;
        }

        return matchingMessages
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToList();
    }

    public async Task CleanupExpiredMessagesAsync()
    {
        var expiredMessages = await _context.Messages
            .Where(m => m.ExpiresAt != null && m.ExpiresAt <= DateTime.UtcNow && !m.IsDeleted)
            .ToListAsync();

        foreach (var message in expiredMessages)
        {
            message.IsDeleted = true;
            message.DeletedAt = DateTime.UtcNow;
            message.Content = null;
            message.MediaUrl = null;
        }

        await _context.SaveChangesAsync();
    }

    public async Task<Message> UpdateMessageAsync(Message message)
    {
        _context.Messages.Update(message);
        await _context.SaveChangesAsync();
        return message;
    }

    // Enhanced Delete with Audit Trail
    public async Task<bool> DeleteMessageWithAuditAsync(Guid messageId, Guid userId, DeleteType deleteType, string? reason = null)
    {
        var message = await _context.Messages
            .Include(m => m.Sender)
                .ThenInclude(s => s.NominalRoll)
            .FirstOrDefaultAsync(m => m.Id == messageId);

        if (message == null)
            return false;

        // Get deleter's Service Number
        var deleter = await _context.Users
            .Include(u => u.NominalRoll)
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (deleter == null)
            return false;

        // For ForEveryone delete, only sender can delete (unless admin)
        if (deleteType == DeleteType.ForEveryone && message.SenderId != userId)
        {
            // Check if user is admin in the conversation
            var participant = await _context.ConversationParticipants
                .FirstOrDefaultAsync(p => p.ConversationId == message.ConversationId && p.UserId == userId);
            if (participant?.Role != ParticipantRole.Admin && participant?.Role != ParticipantRole.Owner)
                return false;
            deleteType = DeleteType.AdminDelete;
        }

        // Decrypt content before saving to audit table
        string? decryptedContent = null;
        if (!string.IsNullOrEmpty(message.Content))
        {
            decryptedContent = _encryptionService.Decrypt(message.Content);
        }

        // Create audit record
        var deletedMessage = new DeletedMessage
        {
            OriginalMessageId = message.Id,
            ConversationId = message.ConversationId,
            SenderId = message.SenderId,
            SenderServiceNumber = message.SenderServiceNumber ?? message.Sender?.NominalRoll?.ServiceNumber ?? "",
            OriginalContent = decryptedContent != null ? _encryptionService.Encrypt(decryptedContent) : null,
            OriginalMediaUrl = message.MediaUrl,
            OriginalMediaThumbnailUrl = message.MediaThumbnailUrl,
            OriginalMediaMimeType = message.MediaMimeType,
            OriginalMediaSize = message.MediaSize,
            OriginalMediaDuration = message.MediaDuration,
            OriginalType = message.Type,
            WasForwarded = message.IsForwarded,
            OriginalSenderServiceNumber = message.OriginalSenderServiceNumber,
            MediaOriginatorServiceNumber = message.MediaOriginatorServiceNumber,
            DeletedById = userId,
            DeletedByServiceNumber = deleter.NominalRoll?.ServiceNumber ?? "",
            DeletedAt = DateTime.UtcNow,
            DeleteType = deleteType,
            DeletionReason = reason,
            OriginalCreatedAt = message.CreatedAt,
            OriginalEditedAt = message.EditedAt,
            OriginalReplyToMessageId = message.ReplyToMessageId
        };

        await _context.DeletedMessages.AddAsync(deletedMessage);

        // Soft delete the original message
        message.IsDeleted = true;
        message.DeletedAt = DateTime.UtcNow;
        if (deleteType != DeleteType.ForMe)
        {
            message.Content = null;
            message.MediaUrl = null;
        }

        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<IEnumerable<DeletedMessage>> GetDeletedMessagesAsync(Guid conversationId, int page = 1, int pageSize = 50)
    {
        return await _context.DeletedMessages
            .Include(dm => dm.Sender)
                .ThenInclude(s => s.NominalRoll)
            .Include(dm => dm.DeletedBy)
                .ThenInclude(d => d.NominalRoll)
            .Where(dm => dm.ConversationId == conversationId)
            .OrderByDescending(dm => dm.DeletedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();
    }

    // Forward Message with Service Number tracking
    public async Task<Message> ForwardMessageAsync(Guid originalMessageId, Guid forwarderId, Guid toConversationId)
    {
        var originalMessage = await _context.Messages
            .Include(m => m.Sender)
                .ThenInclude(s => s.NominalRoll)
            .FirstOrDefaultAsync(m => m.Id == originalMessageId && !m.IsDeleted);

        if (originalMessage == null)
            throw new InvalidOperationException("Original message not found or has been deleted");

        var toConversation = await _context.Conversations
            .Include(c => c.Participants)
            .FirstOrDefaultAsync(c => c.Id == toConversationId);

        if (toConversation == null)
            throw new InvalidOperationException("Target conversation not found");

        var forwarder = await _context.Users
            .Include(u => u.NominalRoll)
            .FirstOrDefaultAsync(u => u.Id == forwarderId);

        if (forwarder == null)
            throw new InvalidOperationException("Forwarder not found");

        var forwarderServiceNumber = forwarder.NominalRoll?.ServiceNumber;

        // Determine the original sender's service number (for chain of custody)
        var originalSenderServiceNumber = originalMessage.OriginalSenderServiceNumber
            ?? originalMessage.SenderServiceNumber
            ?? originalMessage.Sender?.NominalRoll?.ServiceNumber;

        // Get the root original message ID
        var rootOriginalMessageId = originalMessage.OriginalMessageId ?? originalMessage.Id;

        // Decrypt content if exists
        string? decryptedContent = null;
        if (!string.IsNullOrEmpty(originalMessage.Content))
        {
            decryptedContent = _encryptionService.Decrypt(originalMessage.Content);
        }

        // Encrypt for new message
        var encryptedContent = !string.IsNullOrEmpty(decryptedContent)
            ? _encryptionService.Encrypt(decryptedContent)
            : null;

        DateTime? expiresAt = null;
        if (toConversation.DefaultMessageExpiry != MessageExpiry.Never)
        {
            expiresAt = DateTime.UtcNow.AddHours((int)toConversation.DefaultMessageExpiry);
        }

        // For PDF documents, create a new copy with forwarder watermark
        var forwardOrder = originalMessage.ForwardCount + 1;
        var mediaUrlToUse = originalMessage.MediaUrl;

        if (originalMessage.Type == MessageType.Document && !string.IsNullOrEmpty(originalMessage.MediaUrl))
        {
            var forwarderName = forwarder.DisplayName ?? forwarder.NominalRoll?.FullName;
            var watermarkedUrl = await _fileService.CreateForwardedCopyWithWatermarkAsync(
                originalMessage.MediaUrl,
                forwarderId,
                forwarderServiceNumber,
                forwarderName,
                forwardOrder);

            if (!string.IsNullOrEmpty(watermarkedUrl))
            {
                mediaUrlToUse = watermarkedUrl;
                _logger.LogInformation("Created watermarked copy for forwarded document: {Url}", watermarkedUrl);
            }
        }

        // Create forwarded message
        var forwardedMessage = new Message
        {
            ConversationId = toConversationId,
            SenderId = forwarderId,
            Type = originalMessage.Type,
            Content = encryptedContent,
            MediaUrl = mediaUrlToUse,
            MediaThumbnailUrl = originalMessage.MediaThumbnailUrl,
            MediaMimeType = originalMessage.MediaMimeType,
            MediaSize = originalMessage.MediaSize,
            MediaDuration = originalMessage.MediaDuration,
            IsForwarded = true,
            ForwardedFromMessageId = originalMessage.Id,
            ExpiryDuration = toConversation.DefaultMessageExpiry,
            ExpiresAt = expiresAt,
            // Service Number watermarks
            SenderServiceNumber = forwarderServiceNumber,
            OriginalSenderServiceNumber = originalSenderServiceNumber,
            MediaOriginatorServiceNumber = originalMessage.MediaOriginatorServiceNumber ?? originalSenderServiceNumber,
            OriginalMessageId = rootOriginalMessageId,
            ForwardCount = forwardOrder,
            OriginalCreatedAt = originalMessage.OriginalCreatedAt ?? originalMessage.CreatedAt
        };

        await _context.Messages.AddAsync(forwardedMessage);

        // Create message status for all participants except forwarder
        var recipientIds = toConversation.Participants
            .Where(p => p.UserId != forwarderId && p.IsActive)
            .Select(p => p.UserId);

        foreach (var recipientId in recipientIds)
        {
            await _context.MessageStatuses.AddAsync(new MessageStatusEntity
            {
                MessageId = forwardedMessage.Id,
                UserId = recipientId,
                Status = MessageStatus.Sent
            });
        }

        // Create forward chain entry
        var forwardChain = new MessageForwardChain
        {
            MessageId = forwardedMessage.Id,
            OriginalMessageId = rootOriginalMessageId,
            ForwarderId = forwarderId,
            ForwarderServiceNumber = forwarderServiceNumber ?? "",
            FromConversationId = originalMessage.ConversationId,
            ToConversationId = toConversationId,
            ForwardedAt = DateTime.UtcNow,
            ForwardOrder = originalMessage.ForwardCount + 1
        };

        await _context.MessageForwardChains.AddAsync(forwardChain);

        // Update conversation last message time
        toConversation.LastMessageAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();

        // Decrypt content before returning
        if (!string.IsNullOrEmpty(forwardedMessage.Content))
        {
            forwardedMessage.Content = decryptedContent;
        }

        return forwardedMessage;
    }

    public async Task<IEnumerable<MessageForwardChain>> GetMessageForwardChainAsync(Guid messageId)
    {
        // Get the original message ID if this is a forwarded message
        var message = await _context.Messages.FirstOrDefaultAsync(m => m.Id == messageId);
        if (message == null)
            return Enumerable.Empty<MessageForwardChain>();

        var rootMessageId = message.OriginalMessageId ?? messageId;

        return await _context.MessageForwardChains
            .Include(fc => fc.Forwarder)
                .ThenInclude(f => f.NominalRoll)
            .Where(fc => fc.OriginalMessageId == rootMessageId)
            .OrderBy(fc => fc.ForwardOrder)
            .ToListAsync();
    }

    // Reactions
    public async Task<MessageReaction> AddReactionAsync(Guid messageId, Guid userId, string emoji)
    {
        var message = await _context.Messages.FirstOrDefaultAsync(m => m.Id == messageId && !m.IsDeleted);
        if (message == null)
            throw new InvalidOperationException("Message not found");

        // Check if user already has this reaction
        var existingReaction = await _context.MessageReactions
            .FirstOrDefaultAsync(r => r.MessageId == messageId && r.UserId == userId && r.Emoji == emoji);

        if (existingReaction != null)
            return existingReaction;

        var reaction = new MessageReaction
        {
            MessageId = messageId,
            UserId = userId,
            Emoji = emoji
        };

        await _context.MessageReactions.AddAsync(reaction);
        await _context.SaveChangesAsync();

        return reaction;
    }

    public async Task<bool> RemoveReactionAsync(Guid messageId, Guid userId, string emoji)
    {
        var reaction = await _context.MessageReactions
            .FirstOrDefaultAsync(r => r.MessageId == messageId && r.UserId == userId && r.Emoji == emoji);

        if (reaction == null)
            return false;

        _context.MessageReactions.Remove(reaction);
        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<IEnumerable<MessageReaction>> GetMessageReactionsAsync(Guid messageId)
    {
        return await _context.MessageReactions
            .Include(r => r.User)
                .ThenInclude(u => u.NominalRoll)
            .Where(r => r.MessageId == messageId)
            .ToListAsync();
    }

    // Star/Bookmark Messages
    public async Task<StarredMessage> StarMessageAsync(Guid messageId, Guid userId)
    {
        var message = await _context.Messages.FirstOrDefaultAsync(m => m.Id == messageId && !m.IsDeleted);
        if (message == null)
            throw new InvalidOperationException("Message not found");

        // Check if already starred
        var existing = await _context.StarredMessages
            .FirstOrDefaultAsync(s => s.MessageId == messageId && s.UserId == userId);

        if (existing != null)
            return existing;

        var starred = new StarredMessage
        {
            UserId = userId,
            MessageId = messageId,
            StarredAt = DateTime.UtcNow
        };

        await _context.StarredMessages.AddAsync(starred);
        await _context.SaveChangesAsync();

        return starred;
    }

    public async Task<bool> UnstarMessageAsync(Guid messageId, Guid userId)
    {
        var starred = await _context.StarredMessages
            .FirstOrDefaultAsync(s => s.MessageId == messageId && s.UserId == userId);

        if (starred == null)
            return false;

        _context.StarredMessages.Remove(starred);
        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<IEnumerable<StarredMessage>> GetStarredMessagesAsync(Guid userId, int page = 1, int pageSize = 50)
    {
        return await _context.StarredMessages
            .Include(s => s.Message)
                .ThenInclude(m => m.Sender)
                    .ThenInclude(u => u.NominalRoll)
            .Include(s => s.Message)
                .ThenInclude(m => m.Conversation)
            .Where(s => s.UserId == userId && !s.Message.IsDeleted)
            .OrderByDescending(s => s.StarredAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();
    }

    // Pin Messages
    public async Task<PinnedMessage> PinMessageAsync(Guid conversationId, Guid messageId, Guid pinnedById)
    {
        var message = await _context.Messages
            .FirstOrDefaultAsync(m => m.Id == messageId && m.ConversationId == conversationId && !m.IsDeleted);

        if (message == null)
            throw new InvalidOperationException("Message not found in this conversation");

        // Check if already pinned
        var existing = await _context.PinnedMessages
            .FirstOrDefaultAsync(p => p.MessageId == messageId && p.ConversationId == conversationId);

        if (existing != null)
            return existing;

        var pinned = new PinnedMessage
        {
            ConversationId = conversationId,
            MessageId = messageId,
            PinnedById = pinnedById,
            PinnedAt = DateTime.UtcNow
        };

        await _context.PinnedMessages.AddAsync(pinned);
        await _context.SaveChangesAsync();

        return pinned;
    }

    public async Task<bool> UnpinMessageAsync(Guid conversationId, Guid messageId, Guid unpinnedById)
    {
        var pinned = await _context.PinnedMessages
            .FirstOrDefaultAsync(p => p.MessageId == messageId && p.ConversationId == conversationId);

        if (pinned == null)
            return false;

        _context.PinnedMessages.Remove(pinned);
        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<IEnumerable<PinnedMessage>> GetPinnedMessagesAsync(Guid conversationId)
    {
        return await _context.PinnedMessages
            .Include(p => p.Message)
                .ThenInclude(m => m.Sender)
                    .ThenInclude(u => u.NominalRoll)
            .Include(p => p.PinnedBy)
                .ThenInclude(u => u.NominalRoll)
            .Where(p => p.ConversationId == conversationId && !p.Message.IsDeleted)
            .OrderByDescending(p => p.PinnedAt)
            .ToListAsync();
    }
}
