using IM.Core.Enums;

namespace IM.API.DTOs;

public class CallDto
{
    public Guid Id { get; set; }
    public Guid ConversationId { get; set; }
    public Guid InitiatorId { get; set; }
    public string? InitiatorName { get; set; }
    public string? InitiatorProfilePicture { get; set; }
    public CallType Type { get; set; }
    public CallStatus Status { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
    public int? Duration { get; set; }
    public string? RoomId { get; set; }
    public List<CallParticipantDto> Participants { get; set; } = new();
}

public class CallParticipantDto
{
    public Guid UserId { get; set; }
    public string? DisplayName { get; set; }
    public string? ProfilePictureUrl { get; set; }
    public CallStatus Status { get; set; }
    public bool IsMuted { get; set; }
    public bool IsVideoEnabled { get; set; }
    public bool IsOnHold { get; set; }
    public DateTime? JoinedAt { get; set; }
}

public class InitiateCallRequest
{
    public Guid ConversationId { get; set; }
    public CallType Type { get; set; }
}

public class InitiateCallResponse
{
    public CallDto Call { get; set; } = null!;
    public string RoomToken { get; set; } = string.Empty;
    public string LiveKitUrl { get; set; } = string.Empty;
}

public class JoinCallResponse
{
    public string RoomToken { get; set; } = string.Empty;
    public string RoomId { get; set; } = string.Empty;
    public string LiveKitUrl { get; set; } = string.Empty;
}

public class UpdateCallStatusRequest
{
    public bool? IsMuted { get; set; }
    public bool? IsVideoEnabled { get; set; }
    public bool? IsOnHold { get; set; }
}

public class RefreshTokenResponse
{
    public string Token { get; set; } = string.Empty;
}
