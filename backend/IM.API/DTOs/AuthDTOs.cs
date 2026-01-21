using System.ComponentModel.DataAnnotations;

namespace IM.API.DTOs;

public class RequestTokenRequest
{
    [Required]
    public string ServiceNumber { get; set; } = string.Empty;
}

public class RequestTokenResponse
{
    public bool Success { get; set; }
    public string? FullName { get; set; }
    public string? MaskedEmail { get; set; }
    public string? MaskedPhone { get; set; }
    public string? Message { get; set; }
}

public class VerifyTokenRequest
{
    [Required]
    public string ServiceNumber { get; set; } = string.Empty;

    [Required]
    [StringLength(6, MinimumLength = 6)]
    public string Token { get; set; } = string.Empty;

    /// <summary>
    /// Device ID for single device login enforcement.
    /// When provided, other devices for this user will be logged out.
    /// </summary>
    public string? DeviceId { get; set; }
}

public class LoginResponse
{
    public Guid UserId { get; set; }
    public string DisplayName { get; set; } = string.Empty;
    public string PhoneNumber { get; set; } = string.Empty;
    public string? ProfilePictureUrl { get; set; }
    public string AccessToken { get; set; } = string.Empty;
    public string RefreshToken { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
}

public class RefreshTokenRequest
{
    [Required]
    public string RefreshToken { get; set; } = string.Empty;
}

public class TokenResponse
{
    public string AccessToken { get; set; } = string.Empty;
    public string RefreshToken { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
}
