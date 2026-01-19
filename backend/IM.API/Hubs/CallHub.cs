using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using IM.API.DTOs;
using IM.Core.Enums;
using IM.Core.Interfaces;
using Microsoft.Extensions.Configuration;

namespace IM.API.Hubs;

[Authorize]
public class CallHub : Hub
{
    private readonly ICallService _callService;
    private readonly IConversationService _conversationService;
    private readonly IUserService _userService;
    private readonly INotificationService _notificationService;
    private readonly ILogger<CallHub> _logger;
    private readonly IConfiguration _configuration;
    private static readonly Dictionary<string, HashSet<string>> _userConnections = new();
    private static readonly Dictionary<Guid, HashSet<Guid>> _activeCallParticipants = new();

    public CallHub(
        ICallService callService,
        IConversationService conversationService,
        IUserService userService,
        INotificationService notificationService,
        ILogger<CallHub> logger,
        IConfiguration configuration)
    {
        _callService = callService;
        _conversationService = conversationService;
        _userService = userService;
        _notificationService = notificationService;
        _logger = logger;
        _configuration = configuration;
    }

    private Guid GetUserId()
    {
        var userIdClaim = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim))
        {
            _logger.LogWarning("User ID claim is null or empty in CallHub");
            throw new HubException("User not authenticated");
        }

        if (!Guid.TryParse(userIdClaim, out var userId))
        {
            _logger.LogWarning("Failed to parse user ID claim in CallHub: {Claim}", userIdClaim);
            throw new HubException("Invalid user ID");
        }

        return userId;
    }

    public override async Task OnConnectedAsync()
    {
        try
        {
            var userId = GetUserId();
            var connectionId = Context.ConnectionId;

            _logger.LogInformation("CallHub: User {UserId} connecting", userId);

            lock (_userConnections)
            {
                if (!_userConnections.ContainsKey(userId.ToString()))
                {
                    _userConnections[userId.ToString()] = new HashSet<string>();
                }
                _userConnections[userId.ToString()].Add(connectionId);
            }

            _logger.LogInformation("CallHub: User {UserId} connected successfully", userId);
            await base.OnConnectedAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in CallHub OnConnectedAsync");
            throw;
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var userId = GetUserId();
        var connectionId = Context.ConnectionId;

        lock (_userConnections)
        {
            if (_userConnections.ContainsKey(userId.ToString()))
            {
                _userConnections[userId.ToString()].Remove(connectionId);
                if (_userConnections[userId.ToString()].Count == 0)
                {
                    _userConnections.Remove(userId.ToString());
                }
            }
        }

        // Leave any active calls
        var callsToLeave = new List<Guid>();
        lock (_activeCallParticipants)
        {
            foreach (var call in _activeCallParticipants)
            {
                if (call.Value.Contains(userId))
                {
                    callsToLeave.Add(call.Key);
                }
            }
        }

        foreach (var callId in callsToLeave)
        {
            await LeaveCall(callId);
        }

        await base.OnDisconnectedAsync(exception);
    }

    public async Task<InitiateCallResponse?> InitiateCall(InitiateCallRequest request)
    {
        var userId = GetUserId();

        try
        {
            var (call, roomToken) = await _callService.InitiateCallAsync(
                request.ConversationId,
                userId,
                request.Type);

            // Join call room
            await Groups.AddToGroupAsync(Context.ConnectionId, $"call_{call.Id}");

            lock (_activeCallParticipants)
            {
                if (!_activeCallParticipants.ContainsKey(call.Id))
                {
                    _activeCallParticipants[call.Id] = new HashSet<Guid>();
                }
                _activeCallParticipants[call.Id].Add(userId);
            }

            var callDto = await MapCallToDto(call);

            // Notify other participants
            var participants = await _conversationService.GetParticipantsAsync(request.ConversationId);
            var otherParticipantIds = participants
                .Where(p => p.UserId != userId)
                .Select(p => p.UserId)
                .ToList();

            // Send to online users via SignalR
            foreach (var participantId in otherParticipantIds)
            {
                var connections = GetUserConnectionIds(participantId);
                _logger.LogInformation("Sending IncomingCall to user {ParticipantId}, connections: {Count}", participantId, connections.Count());
                foreach (var connectionId in connections)
                {
                    _logger.LogInformation("Sending IncomingCall event to connection {ConnectionId}, Call ID: {CallId}, Type: {CallType}", connectionId, callDto.Id, callDto.Type);
                    await Clients.Client(connectionId).SendAsync("IncomingCall", callDto);
                    _logger.LogInformation("IncomingCall event sent successfully");
                }
            }

            // Send push notifications to ALL other participants
            // This ensures the device wakes up even if the app is in background
            // SignalR connection might be active but the app could be in background
            if (otherParticipantIds.Any())
            {
                _logger.LogInformation("Sending push notification to {Count} participants for call {CallId}", otherParticipantIds.Count, call.Id);
                await _notificationService.SendCallNotificationAsync(call, otherParticipantIds);
            }

            var liveKitUrl = _configuration.GetSection("LiveKit")["Host"] ?? "http://localhost:7880";

            return new InitiateCallResponse
            {
                Call = callDto,
                RoomToken = roomToken,
                LiveKitUrl = liveKitUrl
            };
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("CallError", ex.Message);
            return null;
        }
    }

    public async Task<JoinCallResponse?> JoinCall(Guid callId)
    {
        var userId = GetUserId();

        var (success, roomToken) = await _callService.JoinCallAsync(callId, userId);

        if (!success || roomToken == null)
        {
            await Clients.Caller.SendAsync("CallError", "Failed to join call");
            return null;
        }

        var call = await _callService.GetCallByIdAsync(callId);
        if (call == null)
        {
            return null;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, $"call_{callId}");

        lock (_activeCallParticipants)
        {
            if (!_activeCallParticipants.ContainsKey(callId))
            {
                _activeCallParticipants[callId] = new HashSet<Guid>();
            }
            _activeCallParticipants[callId].Add(userId);
        }

        var user = await _userService.GetUserByIdAsync(userId);

        // Notify others that user joined
        await Clients.OthersInGroup($"call_{callId}").SendAsync("UserJoinedCall", callId, new CallParticipantDto
        {
            UserId = userId,
            DisplayName = user?.DisplayName ?? user?.NominalRoll.FullName,
            ProfilePictureUrl = user?.ProfilePictureUrl,
            Status = CallStatus.Ongoing,
            IsMuted = false,
            IsVideoEnabled = call.Type == CallType.Video,
            JoinedAt = DateTime.UtcNow
        });

        var liveKitUrl = _configuration.GetSection("LiveKit")["Host"] ?? "http://localhost:7880";

        return new JoinCallResponse
        {
            RoomToken = roomToken,
            RoomId = call.RoomId!,
            LiveKitUrl = liveKitUrl
        };
    }

    public async Task DeclineCall(Guid callId)
    {
        var userId = GetUserId();
        _logger.LogInformation("DeclineCall called: callId={CallId}, userId={UserId}", callId, userId);

        var declineResult = await _callService.DeclineCallAsync(callId, userId);
        _logger.LogInformation("DeclineCallAsync result: {Result}", declineResult);

        var call = await _callService.GetCallByIdAsync(callId);
        if (call != null)
        {
            _logger.LogInformation("Sending CallDeclined to group call_{CallId}", callId);
            await Clients.Group($"call_{callId}").SendAsync("CallDeclined", callId, userId);
            _logger.LogInformation("CallDeclined sent successfully");
        }
        else
        {
            _logger.LogWarning("Call not found after decline: {CallId}", callId);
        }
    }

    public async Task LeaveCall(Guid callId)
    {
        var userId = GetUserId();
        bool shouldEndCall = false;

        lock (_activeCallParticipants)
        {
            if (_activeCallParticipants.ContainsKey(callId))
            {
                _activeCallParticipants[callId].Remove(userId);
                if (_activeCallParticipants[callId].Count == 0)
                {
                    _activeCallParticipants.Remove(callId);
                    shouldEndCall = true;
                }
            }
        }

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"call_{callId}");
        await Clients.OthersInGroup($"call_{callId}").SendAsync("UserLeftCall", callId, userId);

        // End the call in database when last participant leaves
        if (shouldEndCall)
        {
            var success = await _callService.EndCallAsync(callId, userId);
            if (success)
            {
                _logger.LogInformation("Call {CallId} ended automatically - all participants left", callId);
                await Clients.Group($"call_{callId}").SendAsync("CallEnded", callId, userId);
            }
        }
    }

    public async Task EndCall(Guid callId)
    {
        var userId = GetUserId();

        // Get the call before ending it to know who to notify
        var call = await _callService.GetCallByIdAsync(callId);

        var success = await _callService.EndCallAsync(callId, userId);

        if (success)
        {
            await Clients.Group($"call_{callId}").SendAsync("CallEnded", callId, userId);

            // Send push notification to all other participants to cancel their incoming call
            // This is important when the receiver's device is locked and showing native incoming call UI
            if (call != null)
            {
                var otherParticipantIds = call.Participants
                    .Where(p => p.UserId != userId)
                    .Select(p => p.UserId)
                    .ToList();

                if (otherParticipantIds.Any())
                {
                    // Get caller info for missed call notification
                    var caller = await _userService.GetUserByIdAsync(userId);
                    var callerName = caller?.DisplayName ?? caller?.NominalRoll?.FullName ?? "Unknown";
                    var callType = call.Type.ToString();

                    _logger.LogInformation("Sending call ended push notification to {Count} participants for call {CallId}",
                        otherParticipantIds.Count, callId);
                    await _notificationService.SendCallEndedNotificationAsync(callId, otherParticipantIds, callerName, callType, call.ConversationId);

                    // Also send CallEnded directly to participants' SignalR connections
                    // This is needed because receivers may not have joined the call group yet
                    foreach (var participantId in otherParticipantIds)
                    {
                        var connections = GetUserConnectionIds(participantId);
                        foreach (var connectionId in connections)
                        {
                            _logger.LogInformation("Sending CallEnded to connection {ConnectionId} for user {UserId}", connectionId, participantId);
                            await Clients.Client(connectionId).SendAsync("CallEnded", callId, userId);
                        }
                    }
                }
            }

            lock (_activeCallParticipants)
            {
                _activeCallParticipants.Remove(callId);
            }
        }
    }

    public async Task UpdateCallStatus(Guid callId, UpdateCallStatusRequest request)
    {
        var userId = GetUserId();

        await _callService.UpdateParticipantStatusAsync(callId, userId, request.IsMuted, request.IsVideoEnabled, request.IsOnHold);

        await Clients.OthersInGroup($"call_{callId}").SendAsync("ParticipantStatusChanged", callId, userId, request);
    }

    public async Task InviteToCall(Guid callId, Guid inviteeUserId)
    {
        var userId = GetUserId();

        try
        {
            // Get the call
            var call = await _callService.GetCallByIdAsync(callId);
            if (call == null)
            {
                await Clients.Caller.SendAsync("CallError", "Call not found");
                return;
            }

            // Verify the inviter is a participant of the call
            var isParticipant = call.Participants.Any(p => p.UserId == userId);
            if (!isParticipant)
            {
                await Clients.Caller.SendAsync("CallError", "You are not a participant of this call");
                return;
            }

            // Add the invitee as a participant if not already
            await _callService.AddParticipantAsync(callId, inviteeUserId);

            // Get inviter's name for the notification
            var inviter = await _userService.GetUserByIdAsync(userId);
            var inviterName = inviter?.DisplayName ?? inviter?.NominalRoll.FullName ?? "Someone";

            var callDto = await MapCallToDto(call);

            // Send invitation to the invitee via SignalR
            var connections = GetUserConnectionIds(inviteeUserId);
            _logger.LogInformation("Sending CallInvitation to user {UserId}, connections: {Count}", inviteeUserId, connections.Count());
            foreach (var connectionId in connections)
            {
                await Clients.Client(connectionId).SendAsync("CallInvitation", callDto, inviterName);
            }

            // Also send push notification
            await _notificationService.SendCallNotificationAsync(call, new List<Guid> { inviteeUserId });

            _logger.LogInformation("User {UserId} invited user {InviteeId} to call {CallId}", userId, inviteeUserId, callId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error inviting user {InviteeId} to call {CallId}", inviteeUserId, callId);
            await Clients.Caller.SendAsync("CallError", "Failed to send invitation");
        }
    }

    public async Task SendCallSignal(Guid callId, Guid targetUserId, string signal)
    {
        var userId = GetUserId();

        var connections = GetUserConnectionIds(targetUserId);
        foreach (var connectionId in connections)
        {
            await Clients.Client(connectionId).SendAsync("CallSignal", callId, userId, signal);
        }
    }

    private static bool IsUserOnline(Guid userId)
    {
        lock (_userConnections)
        {
            return _userConnections.ContainsKey(userId.ToString()) &&
                   _userConnections[userId.ToString()].Count > 0;
        }
    }

    private static IEnumerable<string> GetUserConnectionIds(Guid userId)
    {
        lock (_userConnections)
        {
            if (_userConnections.TryGetValue(userId.ToString(), out var connections))
            {
                return connections.ToList();
            }
            return Enumerable.Empty<string>();
        }
    }

    private async Task<CallDto> MapCallToDto(Core.Entities.Call call)
    {
        var initiator = await _userService.GetUserByIdAsync(call.InitiatorId);

        return new CallDto
        {
            Id = call.Id,
            ConversationId = call.ConversationId,
            InitiatorId = call.InitiatorId,
            InitiatorName = initiator?.DisplayName ?? initiator?.NominalRoll.FullName,
            InitiatorProfilePicture = initiator?.ProfilePictureUrl,
            Type = call.Type,
            Status = call.Status,
            StartedAt = call.StartedAt,
            EndedAt = call.EndedAt,
            Duration = call.Duration,
            RoomId = call.RoomId,
            Participants = call.Participants.Select(p => new CallParticipantDto
            {
                UserId = p.UserId,
                DisplayName = p.User?.DisplayName ?? p.User?.NominalRoll.FullName,
                ProfilePictureUrl = p.User?.ProfilePictureUrl,
                Status = p.Status,
                IsMuted = p.IsMuted,
                IsVideoEnabled = p.IsVideoEnabled,
                JoinedAt = p.JoinedAt
            }).ToList()
        };
    }
}
