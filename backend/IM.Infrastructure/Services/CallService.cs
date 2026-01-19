using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using IM.Core.Entities;
using IM.Core.Enums;
using IM.Core.Interfaces;
using IM.Infrastructure.Data;
using Livekit.Server.Sdk.Dotnet;

namespace IM.Infrastructure.Services;

public class CallService : ICallService
{
    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly AccessToken _liveKitAccessToken;

    public CallService(ApplicationDbContext context, IConfiguration configuration)
    {
        _context = context;
        _configuration = configuration;

        var liveKitSettings = _configuration.GetSection("LiveKit");
        _liveKitAccessToken = new AccessToken(
            liveKitSettings["ApiKey"]!,
            liveKitSettings["ApiSecret"]!
        );
    }

    public async Task<(Call Call, string RoomToken)> InitiateCallAsync(Guid conversationId, Guid initiatorId, CallType type)
    {
        var conversation = await _context.Conversations
            .Include(c => c.Participants)
                .ThenInclude(p => p.User)
            .FirstOrDefaultAsync(c => c.Id == conversationId);

        if (conversation == null)
            throw new InvalidOperationException("Conversation not found");

        // Check for active calls in this conversation
        var activeCall = await _context.Calls
            .FirstOrDefaultAsync(c => c.ConversationId == conversationId &&
                                     (c.Status == CallStatus.Ringing || c.Status == CallStatus.Ongoing));

        if (activeCall != null)
            throw new InvalidOperationException("There is already an active call in this conversation");

        var roomId = $"call_{Guid.NewGuid()}";
        var initiator = await _context.Users.Include(u => u.NominalRoll).FirstAsync(u => u.Id == initiatorId);

        var call = new Call
        {
            ConversationId = conversationId,
            InitiatorId = initiatorId,
            Type = type,
            Status = CallStatus.Ringing,
            StartedAt = DateTime.UtcNow,
            RoomId = roomId
        };

        // Add all participants
        foreach (var participant in conversation.Participants.Where(p => p.IsActive))
        {
            call.Participants.Add(new CallParticipant
            {
                UserId = participant.UserId,
                Status = participant.UserId == initiatorId ? CallStatus.Ongoing : CallStatus.Ringing,
                JoinedAt = participant.UserId == initiatorId ? DateTime.UtcNow : null,
                IsVideoEnabled = type == CallType.Video
            });
        }

        await _context.Calls.AddAsync(call);
        await _context.SaveChangesAsync();

        // Generate LiveKit token for initiator
        var roomToken = GenerateLiveKitToken(initiatorId, roomId, initiator.DisplayName ?? initiator.NominalRoll.FullName);

        return (call, roomToken);
    }

    public async Task<(bool Success, string? RoomToken)> JoinCallAsync(Guid callId, Guid userId)
    {
        var call = await _context.Calls
            .Include(c => c.Participants)
            .FirstOrDefaultAsync(c => c.Id == callId);

        if (call == null || (call.Status != CallStatus.Ringing && call.Status != CallStatus.Ongoing))
            return (false, null);

        var participant = call.Participants.FirstOrDefault(p => p.UserId == userId);
        if (participant == null)
            return (false, null);

        var user = await _context.Users.Include(u => u.NominalRoll).FirstAsync(u => u.Id == userId);

        participant.Status = CallStatus.Ongoing;
        participant.JoinedAt = DateTime.UtcNow;

        // Update call status if this is the first person to join
        if (call.Status == CallStatus.Ringing)
        {
            call.Status = CallStatus.Ongoing;
        }

        await _context.SaveChangesAsync();

        var roomToken = GenerateLiveKitToken(userId, call.RoomId!, user.DisplayName ?? user.NominalRoll.FullName);
        return (true, roomToken);
    }

    public async Task<bool> EndCallAsync(Guid callId, Guid userId)
    {
        var call = await _context.Calls
            .Include(c => c.Participants)
            .FirstOrDefaultAsync(c => c.Id == callId);

        if (call == null)
            return false;

        call.Status = CallStatus.Ended;
        call.EndedAt = DateTime.UtcNow;
        call.Duration = (int)(call.EndedAt.Value - call.StartedAt).TotalSeconds;

        foreach (var participant in call.Participants)
        {
            if (participant.Status == CallStatus.Ongoing)
            {
                participant.LeftAt = DateTime.UtcNow;
                participant.Status = CallStatus.Ended;
            }
            else if (participant.Status == CallStatus.Ringing)
            {
                participant.Status = CallStatus.Missed;
            }
        }

        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<bool> DeclineCallAsync(Guid callId, Guid userId)
    {
        var call = await _context.Calls
            .Include(c => c.Participants)
            .FirstOrDefaultAsync(c => c.Id == callId);

        if (call == null || call.Status != CallStatus.Ringing)
            return false;

        var participant = call.Participants.FirstOrDefault(p => p.UserId == userId);
        if (participant == null)
            return false;

        participant.Status = CallStatus.Declined;

        // If all participants declined, end the call
        var allDeclined = call.Participants
            .Where(p => p.UserId != call.InitiatorId)
            .All(p => p.Status == CallStatus.Declined || p.Status == CallStatus.Busy);

        if (allDeclined)
        {
            call.Status = CallStatus.Ended;
            call.EndedAt = DateTime.UtcNow;
        }

        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<bool> UpdateParticipantStatusAsync(Guid callId, Guid userId, bool? isMuted, bool? isVideoEnabled, bool? isOnHold = null)
    {
        var participant = await _context.CallParticipants
            .FirstOrDefaultAsync(p => p.CallId == callId && p.UserId == userId);

        if (participant == null)
            return false;

        if (isMuted.HasValue)
            participant.IsMuted = isMuted.Value;
        if (isVideoEnabled.HasValue)
            participant.IsVideoEnabled = isVideoEnabled.Value;
        if (isOnHold.HasValue)
            participant.IsOnHold = isOnHold.Value;

        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<Call?> GetActiveCallAsync(Guid conversationId)
    {
        return await _context.Calls
            .Include(c => c.Participants)
                .ThenInclude(p => p.User)
            .FirstOrDefaultAsync(c => c.ConversationId == conversationId &&
                                     (c.Status == CallStatus.Ringing || c.Status == CallStatus.Ongoing));
    }

    public async Task<IEnumerable<Call>> GetCallHistoryAsync(Guid userId, int page = 1, int pageSize = 20)
    {
        return await _context.Calls
            .Include(c => c.Conversation)
            .Include(c => c.Participants)
                .ThenInclude(p => p.User)
                    .ThenInclude(u => u.NominalRoll)
            .Include(c => c.Initiator)
                .ThenInclude(i => i.NominalRoll)
            .Where(c => c.Participants.Any(p => p.UserId == userId))
            .OrderByDescending(c => c.StartedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();
    }

    public async Task<Call?> GetCallByIdAsync(Guid callId)
    {
        return await _context.Calls
            .Include(c => c.Participants)
                .ThenInclude(p => p.User)
                    .ThenInclude(u => u.NominalRoll)
            .Include(c => c.Initiator)
            .FirstOrDefaultAsync(c => c.Id == callId);
    }

    public string GenerateLiveKitToken(Guid userId, string roomId, string userName)
    {
        var grants = new VideoGrants
        {
            RoomJoin = true,
            Room = roomId,
            CanPublish = true,
            CanSubscribe = true,
            CanPublishData = true
        };

        return _liveKitAccessToken
            .WithIdentity(userId.ToString())
            .WithName(userName)
            .WithGrants(grants)
            .WithTtl(TimeSpan.FromHours(2))
            .ToJwt();
    }

    public async Task<string?> RefreshTokenAsync(Guid callId, Guid userId)
    {
        var call = await _context.Calls
            .Include(c => c.Participants)
            .FirstOrDefaultAsync(c => c.Id == callId);

        if (call == null || call.Status != CallStatus.Ongoing)
            return null;

        var participant = call.Participants.FirstOrDefault(p => p.UserId == userId);
        if (participant == null || participant.Status != CallStatus.Ongoing)
            return null;

        var user = await _context.Users.Include(u => u.NominalRoll).FirstAsync(u => u.Id == userId);
        return GenerateLiveKitToken(userId, call.RoomId!, user.DisplayName ?? user.NominalRoll.FullName);
    }

    public async Task<bool> AddParticipantAsync(Guid callId, Guid userId)
    {
        var call = await _context.Calls
            .Include(c => c.Participants)
            .FirstOrDefaultAsync(c => c.Id == callId);

        if (call == null || (call.Status != CallStatus.Ringing && call.Status != CallStatus.Ongoing))
            return false;

        // Check if user is already a participant
        var existingParticipant = call.Participants.FirstOrDefault(p => p.UserId == userId);
        if (existingParticipant != null)
        {
            // Already a participant, just update status if needed
            if (existingParticipant.Status == CallStatus.Declined || existingParticipant.Status == CallStatus.Missed)
            {
                existingParticipant.Status = CallStatus.Ringing;
                await _context.SaveChangesAsync();
            }
            return true;
        }

        // Add new participant
        call.Participants.Add(new CallParticipant
        {
            UserId = userId,
            Status = CallStatus.Ringing,
            IsVideoEnabled = call.Type == CallType.Video
        });

        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<int> CleanupStaleCallsAsync(TimeSpan maxAge)
    {
        var cutoffTime = DateTime.UtcNow - maxAge;

        var staleCalls = await _context.Calls
            .Include(c => c.Participants)
            .Where(c => (c.Status == CallStatus.Ringing || c.Status == CallStatus.Ongoing)
                        && c.StartedAt < cutoffTime)
            .ToListAsync();

        foreach (var call in staleCalls)
        {
            call.Status = CallStatus.Ended;
            call.EndedAt = DateTime.UtcNow;
            call.Duration = (int)(DateTime.UtcNow - call.StartedAt).TotalSeconds;

            foreach (var participant in call.Participants)
            {
                if (participant.Status == CallStatus.Ongoing)
                {
                    participant.LeftAt = DateTime.UtcNow;
                    participant.Status = CallStatus.Ended;
                }
                else if (participant.Status == CallStatus.Ringing)
                {
                    participant.Status = CallStatus.Missed;
                }
            }
        }

        await _context.SaveChangesAsync();
        return staleCalls.Count;
    }
}
