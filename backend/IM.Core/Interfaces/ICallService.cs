using IM.Core.Entities;
using IM.Core.Enums;

namespace IM.Core.Interfaces;

public interface ICallService
{
    Task<(Call Call, string RoomToken)> InitiateCallAsync(Guid conversationId, Guid initiatorId, CallType type);
    Task<(bool Success, string? RoomToken)> JoinCallAsync(Guid callId, Guid userId);
    Task<bool> EndCallAsync(Guid callId, Guid userId);
    Task<bool> DeclineCallAsync(Guid callId, Guid userId);
    Task<bool> UpdateParticipantStatusAsync(Guid callId, Guid userId, bool? isMuted, bool? isVideoEnabled, bool? isOnHold = null);
    Task<Call?> GetActiveCallAsync(Guid conversationId);
    Task<IEnumerable<Call>> GetCallHistoryAsync(Guid userId, int page = 1, int pageSize = 20);
    Task<Call?> GetCallByIdAsync(Guid callId);
    string GenerateLiveKitToken(Guid userId, string roomId, string userName);
    Task<string?> RefreshTokenAsync(Guid callId, Guid userId);
    Task<int> CleanupStaleCallsAsync(TimeSpan maxAge);
    Task<bool> AddParticipantAsync(Guid callId, Guid userId);
}
