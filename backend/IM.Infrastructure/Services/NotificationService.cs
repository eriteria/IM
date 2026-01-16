using FirebaseAdmin;
using FirebaseAdmin.Messaging;
using Google.Apis.Auth.OAuth2;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using IM.Core.Entities;
using IM.Core.Enums;
using IM.Core.Interfaces;
using IM.Infrastructure.Data;
using FirebaseMessage = FirebaseAdmin.Messaging.Message;

namespace IM.Infrastructure.Services;

public class NotificationService : INotificationService
{
    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly ILogger<NotificationService> _logger;
    private readonly FirebaseMessaging? _firebaseMessaging;

    public NotificationService(ApplicationDbContext context, IConfiguration configuration, ILogger<NotificationService> logger)
    {
        _context = context;
        _configuration = configuration;
        _logger = logger;

        // Initialize Firebase if not already initialized
        try
        {
            var firebaseCredentialsPath = _configuration["Firebase:CredentialsPath"];
            _logger.LogInformation("Firebase credentials path from config: {Path}", firebaseCredentialsPath ?? "NULL");

            if (string.IsNullOrEmpty(firebaseCredentialsPath))
            {
                _logger.LogWarning("Firebase credentials path is not configured. Push notifications will be disabled.");
                return;
            }

            // Try to resolve the path - it might be relative to the app directory
            var fullPath = Path.IsPathRooted(firebaseCredentialsPath)
                ? firebaseCredentialsPath
                : Path.Combine(AppContext.BaseDirectory, firebaseCredentialsPath);

            _logger.LogInformation("Checking Firebase credentials at: {FullPath}", fullPath);

            if (!File.Exists(fullPath))
            {
                _logger.LogWarning("Firebase credentials file not found at: {Path}. Push notifications will be disabled.", fullPath);
                return;
            }

            if (FirebaseApp.DefaultInstance == null)
            {
                _logger.LogInformation("Initializing Firebase with credentials from: {Path}", fullPath);
                FirebaseApp.Create(new AppOptions
                {
                    Credential = GoogleCredential.FromFile(fullPath)
                });
            }
            _firebaseMessaging = FirebaseMessaging.DefaultInstance;
            _logger.LogInformation("Firebase initialized successfully. Push notifications are enabled.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initialize Firebase. Push notifications will be disabled.");
        }
    }

    public async Task SendMessageNotificationAsync(IM.Core.Entities.Message message, IEnumerable<Guid> recipientIds)
    {
        if (_firebaseMessaging == null)
            return;

        var devices = await _context.UserDevices
            .Where(d => recipientIds.Contains(d.UserId) && d.IsActive)
            .ToListAsync();

        if (!devices.Any())
            return;

        var sender = await _context.Users
            .Include(u => u.NominalRoll)
            .FirstAsync(u => u.Id == message.SenderId);

        // Get conversation to check if it's a group
        var conversation = await _context.Conversations
            .FirstOrDefaultAsync(c => c.Id == message.ConversationId);

        var senderName = sender.DisplayName ?? sender.NominalRoll.FullName;
        var messagePreview = message.Type == MessageType.Text
            ? (message.Content?.Length > 100 ? message.Content[..100] + "..." : message.Content)
            : GetMessageTypePreview(message.Type);

        // For group messages, show "GroupName: SenderName: message"
        // For private messages, show "SenderName: message"
        var isGroup = conversation?.Type == ConversationType.Group;
        var groupName = isGroup ? conversation?.Name ?? "Group" : null;
        var notificationTitle = isGroup ? groupName : senderName;
        var notificationBody = isGroup
            ? $"{senderName}: {messagePreview ?? "New message"}"
            : messagePreview ?? "New message";
        var channelId = isGroup ? "groups" : "messages";

        // Include both Notification and Data payloads
        // Notification payload ensures system displays notification even when app is killed
        // Data payload provides additional info for app to handle when opened
        var notifications = devices.Select(device => new FirebaseMessage
        {
            Token = device.DeviceToken,
            // Notification payload - displayed by system when app is in background/killed
            Notification = new Notification
            {
                Title = notificationTitle,
                Body = notificationBody
            },
            // Data payload - for app to process when notification is tapped
            Data = new Dictionary<string, string>
            {
                { "type", isGroup ? "group" : "message" },
                { "conversationId", message.ConversationId.ToString() },
                { "messageId", message.Id.ToString() },
                { "senderId", message.SenderId.ToString() },
                { "senderName", senderName },
                { "messagePreview", messagePreview ?? "New message" },
                { "messageType", message.Type.ToString() },
                { "groupName", groupName ?? "" },
                { "isGroup", isGroup.ToString() }
            },
            Android = new AndroidConfig
            {
                // High priority ensures immediate delivery even when device is in Doze mode
                Priority = Priority.High,
                // Short TTL for messages - they should be delivered promptly
                TimeToLive = TimeSpan.FromHours(1),
                // Android-specific notification settings
                Notification = new AndroidNotification
                {
                    ChannelId = channelId,
                    Icon = "ic_notification",
                    Color = "#128C7E",
                    Sound = "default",
                    Priority = NotificationPriority.HIGH,
                    Visibility = NotificationVisibility.PUBLIC,
                    DefaultSound = true,
                    DefaultVibrateTimings = true,
                    DefaultLightSettings = true
                }
            },
            Apns = new ApnsConfig
            {
                Headers = new Dictionary<string, string>
                {
                    { "apns-priority", "10" }, // High priority
                    { "apns-push-type", "alert" } // Alert type shows visible notification
                },
                Aps = new Aps
                {
                    Alert = new ApsAlert
                    {
                        Title = notificationTitle,
                        Body = notificationBody
                    },
                    Sound = "default",
                    ContentAvailable = true,
                    MutableContent = true
                }
            }
        }).ToList();

        foreach (var notification in notifications)
        {
            try
            {
                await _firebaseMessaging.SendAsync(notification);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send push notification");
            }
        }
    }

    public async Task SendCallNotificationAsync(Call call, IEnumerable<Guid> recipientIds)
    {
        if (_firebaseMessaging == null)
        {
            _logger.LogWarning("Firebase messaging not initialized, cannot send call notification");
            return;
        }

        var devices = await _context.UserDevices
            .Where(d => recipientIds.Contains(d.UserId) && d.IsActive)
            .ToListAsync();

        if (!devices.Any())
        {
            _logger.LogWarning("No active devices found for call notification recipients");
            return;
        }

        var initiator = await _context.Users
            .Include(u => u.NominalRoll)
            .FirstAsync(u => u.Id == call.InitiatorId);

        var callerName = initiator.DisplayName ?? initiator.NominalRoll.FullName;
        var callTypeText = call.Type == CallType.Video ? "video" : "voice";

        _logger.LogInformation("Sending call notification to {DeviceCount} devices for call {CallId}", devices.Count, call.Id);

        foreach (var device in devices)
        {
            try
            {
                // For Android: Use data-only message with high priority
                // This ensures the app's background message handler is invoked
                // and can display a high-priority notification that wakes the device
                var firebaseMessage = new FirebaseMessage
                {
                    Token = device.DeviceToken,
                    // Data-only message for background handling
                    Data = new Dictionary<string, string>
                    {
                        { "type", "call" },
                        { "callId", call.Id.ToString() },
                        { "callerId", call.InitiatorId.ToString() },
                        { "callerName", callerName },
                        { "callType", call.Type.ToString() },
                        { "conversationId", call.ConversationId.ToString() }
                    },
                    Android = new AndroidConfig
                    {
                        // High priority ensures the message is delivered immediately
                        Priority = Priority.High,
                        // Short TTL for calls - they're time-sensitive
                        TimeToLive = TimeSpan.FromSeconds(30)
                    },
                    Apns = new ApnsConfig
                    {
                        Headers = new Dictionary<string, string>
                        {
                            { "apns-push-type", "voip" },
                            { "apns-priority", "10" },
                            { "apns-expiration", "30" }
                        },
                        Aps = new Aps
                        {
                            ContentAvailable = true,
                            Sound = "ringtone.caf",
                            MutableContent = true
                        }
                    }
                };

                var messageId = await _firebaseMessaging.SendAsync(firebaseMessage);
                _logger.LogInformation("Call notification sent successfully. MessageId: {MessageId}, Device: {DeviceToken}",
                    messageId, device.DeviceToken[..20] + "...");
            }
            catch (FirebaseMessagingException fex)
            {
                _logger.LogError(fex, "Firebase error sending call notification. Code: {Code}, Message: {Message}",
                    fex.ErrorCode, fex.Message);

                // If token is invalid, mark device as inactive
                if (fex.ErrorCode == ErrorCode.NotFound || fex.ErrorCode == ErrorCode.InvalidArgument)
                {
                    device.IsActive = false;
                    await _context.SaveChangesAsync();
                    _logger.LogWarning("Marked device as inactive due to invalid token");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send call notification to device");
            }
        }
    }

    public async Task SendCallEndedNotificationAsync(Guid callId, IEnumerable<Guid> recipientIds, string? callerName = null, string? callType = null, Guid? conversationId = null)
    {
        if (_firebaseMessaging == null)
        {
            _logger.LogWarning("Firebase messaging not initialized, cannot send call ended notification");
            return;
        }

        var devices = await _context.UserDevices
            .Where(d => recipientIds.Contains(d.UserId) && d.IsActive)
            .ToListAsync();

        if (!devices.Any())
        {
            _logger.LogWarning("No active devices found for call ended notification recipients");
            return;
        }

        _logger.LogInformation("Sending call ended notification to {DeviceCount} devices for call {CallId}", devices.Count, callId);

        foreach (var device in devices)
        {
            try
            {
                // Data-only message to cancel the incoming call and show missed call
                var dataPayload = new Dictionary<string, string>
                {
                    { "type", "call_ended" },
                    { "callId", callId.ToString() }
                };

                // Add caller info for missed call notification if provided
                if (!string.IsNullOrEmpty(callerName))
                {
                    dataPayload["callerName"] = callerName;
                }
                if (!string.IsNullOrEmpty(callType))
                {
                    dataPayload["callType"] = callType;
                }
                if (conversationId.HasValue)
                {
                    dataPayload["conversationId"] = conversationId.Value.ToString();
                }

                var firebaseMessage = new FirebaseMessage
                {
                    Token = device.DeviceToken,
                    Data = dataPayload,
                    Android = new AndroidConfig
                    {
                        Priority = Priority.High,
                        TimeToLive = TimeSpan.FromSeconds(10)
                    },
                    Apns = new ApnsConfig
                    {
                        Headers = new Dictionary<string, string>
                        {
                            { "apns-priority", "10" },
                            { "apns-expiration", "10" }
                        },
                        Aps = new Aps
                        {
                            ContentAvailable = true
                        }
                    }
                };

                var messageId = await _firebaseMessaging.SendAsync(firebaseMessage);
                _logger.LogInformation("Call ended notification sent successfully. MessageId: {MessageId}, CallId: {CallId}",
                    messageId, callId);
            }
            catch (FirebaseMessagingException fex)
            {
                _logger.LogError(fex, "Firebase error sending call ended notification. Code: {Code}", fex.ErrorCode);

                if (fex.ErrorCode == ErrorCode.NotFound || fex.ErrorCode == ErrorCode.InvalidArgument)
                {
                    device.IsActive = false;
                    await _context.SaveChangesAsync();
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send call ended notification to device");
            }
        }
    }

    public async Task SendGroupNotificationAsync(Conversation conversation, string message, IEnumerable<Guid> recipientIds)
    {
        if (_firebaseMessaging == null)
            return;

        var devices = await _context.UserDevices
            .Where(d => recipientIds.Contains(d.UserId) && d.IsActive)
            .ToListAsync();

        if (!devices.Any())
            return;

        var groupName = conversation.Name ?? "Group";

        foreach (var device in devices)
        {
            try
            {
                var firebaseNotification = new FirebaseMessage
                {
                    Token = device.DeviceToken,
                    // Notification payload for system display
                    Notification = new Notification
                    {
                        Title = groupName,
                        Body = message
                    },
                    // Data payload for app handling
                    Data = new Dictionary<string, string>
                    {
                        { "type", "group" },
                        { "conversationId", conversation.Id.ToString() },
                        { "groupName", groupName },
                        { "message", message }
                    },
                    Android = new AndroidConfig
                    {
                        Priority = Priority.High,
                        TimeToLive = TimeSpan.FromHours(1),
                        Notification = new AndroidNotification
                        {
                            ChannelId = "groups",
                            Icon = "ic_notification",
                            Color = "#128C7E",
                            Sound = "default",
                            Priority = NotificationPriority.HIGH,
                            Visibility = NotificationVisibility.PUBLIC
                        }
                    },
                    Apns = new ApnsConfig
                    {
                        Headers = new Dictionary<string, string>
                        {
                            { "apns-priority", "10" },
                            { "apns-push-type", "alert" }
                        },
                        Aps = new Aps
                        {
                            Alert = new ApsAlert
                            {
                                Title = groupName,
                                Body = message
                            },
                            Sound = "default",
                            ContentAvailable = true,
                            MutableContent = true
                        }
                    }
                };

                await _firebaseMessaging.SendAsync(firebaseNotification);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send group notification");
            }
        }
    }

    public async Task RegisterDeviceTokenAsync(Guid userId, string token, string platform, string? deviceId)
    {
        var existingDevice = await _context.UserDevices
            .FirstOrDefaultAsync(d => d.DeviceToken == token);

        if (existingDevice != null)
        {
            existingDevice.UserId = userId;
            existingDevice.IsActive = true;
            existingDevice.LastActiveAt = DateTime.UtcNow;
        }
        else
        {
            var device = new UserDevice
            {
                UserId = userId,
                DeviceToken = token,
                Platform = Enum.Parse<DevicePlatform>(platform, true),
                DeviceId = deviceId,
                IsActive = true,
                LastActiveAt = DateTime.UtcNow
            };

            await _context.UserDevices.AddAsync(device);
        }

        await _context.SaveChangesAsync();
    }

    public async Task RegisterVoipTokenAsync(Guid userId, string token, string platform, string? deviceId)
    {
        // VoIP tokens are stored separately or with a special flag
        // For iOS, VoIP pushes use a different APNS topic and certificate
        var existingDevice = await _context.UserDevices
            .FirstOrDefaultAsync(d => d.DeviceToken == token);

        if (existingDevice != null)
        {
            existingDevice.UserId = userId;
            existingDevice.IsActive = true;
            existingDevice.LastActiveAt = DateTime.UtcNow;
            existingDevice.IsVoipToken = true;
        }
        else
        {
            var device = new UserDevice
            {
                UserId = userId,
                DeviceToken = token,
                Platform = Enum.Parse<DevicePlatform>(platform, true),
                DeviceId = deviceId,
                IsActive = true,
                IsVoipToken = true,
                LastActiveAt = DateTime.UtcNow
            };

            await _context.UserDevices.AddAsync(device);
        }

        await _context.SaveChangesAsync();
        _logger.LogInformation("Registered VoIP token for user {UserId}", userId);
    }

    public async Task UnregisterDeviceTokenAsync(Guid userId, string token)
    {
        var device = await _context.UserDevices
            .FirstOrDefaultAsync(d => d.UserId == userId && d.DeviceToken == token);

        if (device != null)
        {
            device.IsActive = false;
            await _context.SaveChangesAsync();
        }
    }

    public async Task SendBroadcastNotificationAsync(string title, string body)
    {
        if (_firebaseMessaging == null)
            return;

        var devices = await _context.UserDevices
            .Where(d => d.IsActive)
            .ToListAsync();

        foreach (var device in devices)
        {
            try
            {
                var firebaseMessage = new FirebaseMessage
                {
                    Token = device.DeviceToken,
                    // Notification payload for system display
                    Notification = new Notification
                    {
                        Title = title,
                        Body = body
                    },
                    // Data payload for app handling
                    Data = new Dictionary<string, string>
                    {
                        { "type", "broadcast" },
                        { "title", title },
                        { "body", body }
                    },
                    Android = new AndroidConfig
                    {
                        Priority = Priority.High,
                        TimeToLive = TimeSpan.FromHours(24),
                        Notification = new AndroidNotification
                        {
                            ChannelId = "general",
                            Icon = "ic_notification",
                            Color = "#128C7E",
                            Sound = "default",
                            Priority = NotificationPriority.HIGH,
                            Visibility = NotificationVisibility.PUBLIC
                        }
                    },
                    Apns = new ApnsConfig
                    {
                        Headers = new Dictionary<string, string>
                        {
                            { "apns-priority", "10" },
                            { "apns-push-type", "alert" }
                        },
                        Aps = new Aps
                        {
                            Alert = new ApsAlert
                            {
                                Title = title,
                                Body = body
                            },
                            Sound = "default",
                            ContentAvailable = true,
                            MutableContent = true
                        }
                    }
                };

                await _firebaseMessaging.SendAsync(firebaseMessage);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send broadcast notification");
            }
        }
    }

    public async Task SendPTTNotificationAsync(Guid conversationId, Guid senderId, string senderName, IEnumerable<Guid> recipientIds)
    {
        if (_firebaseMessaging == null)
        {
            _logger.LogWarning("Firebase messaging not initialized, cannot send PTT notification");
            return;
        }

        var devices = await _context.UserDevices
            .Where(d => recipientIds.Contains(d.UserId) && d.IsActive)
            .ToListAsync();

        if (!devices.Any())
        {
            _logger.LogWarning("No active devices found for PTT notification recipients");
            return;
        }

        _logger.LogInformation("Sending PTT notification to {DeviceCount} devices for conversation {ConversationId}", devices.Count, conversationId);

        foreach (var device in devices)
        {
            try
            {
                // Data-only message with high priority to wake the device
                var firebaseMessage = new FirebaseMessage
                {
                    Token = device.DeviceToken,
                    Data = new Dictionary<string, string>
                    {
                        { "type", "ptt" },
                        { "conversationId", conversationId.ToString() },
                        { "senderId", senderId.ToString() },
                        { "senderName", senderName }
                    },
                    Android = new AndroidConfig
                    {
                        // High priority ensures the message is delivered immediately
                        Priority = Priority.High,
                        // Short TTL for PTT - they're time-sensitive
                        TimeToLive = TimeSpan.FromSeconds(15)
                    },
                    Apns = new ApnsConfig
                    {
                        Headers = new Dictionary<string, string>
                        {
                            { "apns-priority", "10" },
                            { "apns-expiration", "15" }
                        },
                        Aps = new Aps
                        {
                            ContentAvailable = true,
                            Sound = "default"
                        }
                    }
                };

                var messageId = await _firebaseMessaging.SendAsync(firebaseMessage);
                _logger.LogInformation("PTT notification sent successfully. MessageId: {MessageId}, Device: {DeviceToken}",
                    messageId, device.DeviceToken[..Math.Min(20, device.DeviceToken.Length)] + "...");
            }
            catch (FirebaseMessagingException fex)
            {
                _logger.LogError(fex, "Firebase error sending PTT notification. Code: {Code}, Message: {Message}",
                    fex.ErrorCode, fex.Message);

                if (fex.ErrorCode == ErrorCode.NotFound || fex.ErrorCode == ErrorCode.InvalidArgument)
                {
                    device.IsActive = false;
                    await _context.SaveChangesAsync();
                    _logger.LogWarning("Marked device as inactive due to invalid token");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send PTT notification to device");
            }
        }
    }

    public async Task SendChannelPostNotificationAsync(Guid channelId, string channelName, Guid postId, string authorName, string? postPreview, IEnumerable<Guid> followerIds)
    {
        if (_firebaseMessaging == null)
        {
            _logger.LogWarning("Firebase messaging not initialized, cannot send channel post notification");
            return;
        }

        var devices = await _context.UserDevices
            .Where(d => followerIds.Contains(d.UserId) && d.IsActive)
            .ToListAsync();

        if (!devices.Any())
        {
            _logger.LogWarning("No active devices found for channel post notification recipients");
            return;
        }

        _logger.LogInformation("Sending channel post notification to {DeviceCount} devices for channel {ChannelId}", devices.Count, channelId);

        var preview = string.IsNullOrWhiteSpace(postPreview)
            ? "New post"
            : (postPreview.Length > 100 ? postPreview[..100] + "..." : postPreview);

        foreach (var device in devices)
        {
            try
            {
                var firebaseMessage = new FirebaseMessage
                {
                    Token = device.DeviceToken,
                    // Notification payload for system display
                    Notification = new Notification
                    {
                        Title = channelName,
                        Body = $"{authorName}: {preview}"
                    },
                    // Data payload for app handling
                    Data = new Dictionary<string, string>
                    {
                        { "type", "channel_post" },
                        { "channelId", channelId.ToString() },
                        { "channelName", channelName },
                        { "postId", postId.ToString() },
                        { "authorName", authorName },
                        { "postPreview", preview }
                    },
                    Android = new AndroidConfig
                    {
                        Priority = Priority.High,
                        TimeToLive = TimeSpan.FromHours(4),
                        Notification = new AndroidNotification
                        {
                            ChannelId = "general",
                            Icon = "ic_notification",
                            Color = "#128C7E",
                            Sound = "default",
                            Priority = NotificationPriority.HIGH,
                            Visibility = NotificationVisibility.PUBLIC
                        }
                    },
                    Apns = new ApnsConfig
                    {
                        Headers = new Dictionary<string, string>
                        {
                            { "apns-priority", "10" },
                            { "apns-push-type", "alert" }
                        },
                        Aps = new Aps
                        {
                            Alert = new ApsAlert
                            {
                                Title = channelName,
                                Body = $"{authorName}: {preview}"
                            },
                            Sound = "default",
                            ContentAvailable = true,
                            MutableContent = true
                        }
                    }
                };

                var messageId = await _firebaseMessaging.SendAsync(firebaseMessage);
                _logger.LogInformation("Channel post notification sent successfully. MessageId: {MessageId}, Channel: {ChannelName}",
                    messageId, channelName);
            }
            catch (FirebaseMessagingException fex)
            {
                _logger.LogError(fex, "Firebase error sending channel post notification. Code: {Code}, Message: {Message}",
                    fex.ErrorCode, fex.Message);

                if (fex.ErrorCode == ErrorCode.NotFound || fex.ErrorCode == ErrorCode.InvalidArgument)
                {
                    device.IsActive = false;
                    await _context.SaveChangesAsync();
                    _logger.LogWarning("Marked device as inactive due to invalid token");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send channel post notification to device");
            }
        }
    }

    private static string GetMessageTypePreview(MessageType type)
    {
        return type switch
        {
            MessageType.Image => "📷 Photo",
            MessageType.Video => "🎥 Video",
            MessageType.Audio => "🎵 Audio",
            MessageType.Document => "📄 Document",
            MessageType.Location => "📍 Location",
            MessageType.Contact => "👤 Contact",
            MessageType.Sticker => "🎨 Sticker",
            _ => "New message"
        };
    }
}
