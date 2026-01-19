using IM.Core.Entities;
using IM.Core.Enums;

namespace IM.Core.Interfaces;

public interface IMessageService
{
    Task<Message> SendMessageAsync(Guid conversationId, Guid senderId, MessageType type, string? content, string? mediaUrl = null, Guid? replyToMessageId = null);
    Task<Message?> GetMessageByIdAsync(Guid messageId);
    Task<IEnumerable<Message>> GetConversationMessagesAsync(Guid conversationId, int page = 1, int pageSize = 50);
    Task<bool> UpdateMessageStatusAsync(Guid messageId, Guid userId, MessageStatus status);
    Task<bool> MarkAsDeliveredAsync(Guid messageId, Guid userId);
    Task<bool> MarkAsReadAsync(Guid messageId, Guid userId);
    Task<int> MarkConversationAsReadAsync(Guid conversationId, Guid userId);
    Task<bool> DeleteMessageAsync(Guid messageId, Guid userId, bool forEveryone = false);
    Task<Message?> EditMessageAsync(Guid messageId, Guid userId, string newContent);
    Task<IEnumerable<Message>> SearchMessagesAsync(Guid userId, string query, int page = 1, int pageSize = 20);
    Task CleanupExpiredMessagesAsync();
    Task<Message> UpdateMessageAsync(Message message);

    // Enhanced Delete with Audit Trail
    Task<bool> DeleteMessageWithAuditAsync(Guid messageId, Guid userId, DeleteType deleteType, string? reason = null);
    Task<IEnumerable<DeletedMessage>> GetDeletedMessagesAsync(Guid conversationId, int page = 1, int pageSize = 50);

    // Forward Message
    Task<Message> ForwardMessageAsync(Guid originalMessageId, Guid forwarderId, Guid toConversationId);
    Task<IEnumerable<MessageForwardChain>> GetMessageForwardChainAsync(Guid messageId);

    // Reactions
    Task<MessageReaction> AddReactionAsync(Guid messageId, Guid userId, string emoji);
    Task<bool> RemoveReactionAsync(Guid messageId, Guid userId, string emoji);
    Task<IEnumerable<MessageReaction>> GetMessageReactionsAsync(Guid messageId);

    // Star/Bookmark Messages
    Task<StarredMessage> StarMessageAsync(Guid messageId, Guid userId);
    Task<bool> UnstarMessageAsync(Guid messageId, Guid userId);
    Task<IEnumerable<StarredMessage>> GetStarredMessagesAsync(Guid userId, int page = 1, int pageSize = 50);

    // Pin Messages
    Task<PinnedMessage> PinMessageAsync(Guid conversationId, Guid messageId, Guid pinnedById);
    Task<bool> UnpinMessageAsync(Guid conversationId, Guid messageId, Guid unpinnedById);
    Task<IEnumerable<PinnedMessage>> GetPinnedMessagesAsync(Guid conversationId);
}
