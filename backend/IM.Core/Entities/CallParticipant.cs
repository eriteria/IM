using IM.Core.Enums;

namespace IM.Core.Entities;

public class CallParticipant : BaseEntity
{
    public Guid CallId { get; set; }
    public Guid UserId { get; set; }
    public DateTime? JoinedAt { get; set; }
    public DateTime? LeftAt { get; set; }
    public CallStatus Status { get; set; } = CallStatus.Ringing;
    public bool IsMuted { get; set; }
    public bool IsVideoEnabled { get; set; } = true;
    public bool IsOnHold { get; set; }

    // Navigation
    public Call Call { get; set; } = null!;
    public User User { get; set; } = null!;
}
