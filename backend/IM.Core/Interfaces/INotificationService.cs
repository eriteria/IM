using IM.Core.Entities;

namespace IM.Core.Interfaces;

public class NotificationServiceStatus
{
    public bool IsFirebaseEnabled { get; set; }
    public bool IsApnsEnabled { get; set; }
    public string? FirebaseError { get; set; }
    public string? ApnsError { get; set; }
    public DateTime LastChecked { get; set; }
}

public interface INotificationService
{
    Task SendMessageNotificationAsync(Message message, IEnumerable<Guid> recipientIds);
    Task SendCallNotificationAsync(Call call, IEnumerable<Guid> recipientIds);
    Task SendCallEndedNotificationAsync(Guid callId, IEnumerable<Guid> recipientIds, string? callerName = null, string? callType = null, Guid? conversationId = null);
    Task SendGroupNotificationAsync(Conversation conversation, string message, IEnumerable<Guid> recipientIds);
    Task RegisterDeviceTokenAsync(Guid userId, string token, string platform, string? deviceId);
    Task RegisterVoipTokenAsync(Guid userId, string token, string platform, string? deviceId);
    Task UnregisterDeviceTokenAsync(Guid userId, string token);
    Task SendBroadcastNotificationAsync(string title, string body);
    Task SendPTTNotificationAsync(Guid conversationId, Guid senderId, string senderName, IEnumerable<Guid> recipientIds);
    Task SendChannelPostNotificationAsync(Guid channelId, string channelName, Guid postId, string authorName, string? postPreview, IEnumerable<Guid> followerIds);
    Task SendForceLogoutNotificationAsync(Guid userId, string reason);

    /// <summary>
    /// Get the current status of notification services (Firebase and APNs)
    /// </summary>
    NotificationServiceStatus GetServiceStatus();
}
