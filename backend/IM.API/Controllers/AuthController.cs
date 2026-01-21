using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using IM.API.DTOs;
using IM.Core.Interfaces;
using System.Security.Claims;

namespace IM.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;
    private readonly IConfiguration _configuration;

    public AuthController(IAuthService authService, IConfiguration configuration)
    {
        _authService = authService;
        _configuration = configuration;
    }

    [HttpPost("request-token")]
    public async Task<ActionResult<RequestTokenResponse>> RequestToken([FromBody] RequestTokenRequest request)
    {
        var (success, fullName, maskedEmail, maskedPhone, message) = await _authService.RequestLoginTokenAsync(request.ServiceNumber);

        if (!success)
        {
            return Ok(new RequestTokenResponse
            {
                Success = false,
                Message = message ?? "Service number not found"
            });
        }

        return Ok(new RequestTokenResponse
        {
            Success = true,
            FullName = fullName,
            MaskedEmail = maskedEmail,
            MaskedPhone = maskedPhone
        });
    }

    [HttpPost("verify-token")]
    public async Task<ActionResult<LoginResponse>> VerifyToken([FromBody] VerifyTokenRequest request)
    {
        // Pass deviceId if provided for single device login enforcement
        var (user, accessToken, refreshToken) = await _authService.VerifyLoginTokenAsync(
            request.ServiceNumber,
            request.Token,
            request.DeviceId);

        if (user == null || accessToken == null || refreshToken == null)
        {
            return Unauthorized(new { message = "Invalid or expired verification code" });
        }

        var expiryMinutes = int.Parse(_configuration["JwtSettings:ExpiryMinutes"]!);

        return Ok(new LoginResponse
        {
            UserId = user.Id,
            DisplayName = user.DisplayName ?? "",
            PhoneNumber = user.PhoneNumber,
            ProfilePictureUrl = user.ProfilePictureUrl,
            AccessToken = accessToken,
            RefreshToken = refreshToken,
            ExpiresAt = DateTime.UtcNow.AddMinutes(expiryMinutes)
        });
    }

    [HttpPost("refresh")]
    public async Task<ActionResult<TokenResponse>> RefreshToken([FromBody] RefreshTokenRequest request)
    {
        var (accessToken, refreshToken) = await _authService.RefreshTokenAsync(request.RefreshToken);

        if (accessToken == null || refreshToken == null)
        {
            return Unauthorized(new { message = "Invalid or expired refresh token" });
        }

        var expiryMinutes = int.Parse(_configuration["JwtSettings:ExpiryMinutes"]!);

        return Ok(new TokenResponse
        {
            AccessToken = accessToken,
            RefreshToken = refreshToken,
            ExpiresAt = DateTime.UtcNow.AddMinutes(expiryMinutes)
        });
    }

    [Authorize]
    [HttpPost("logout")]
    public async Task<ActionResult> Logout()
    {
        var userId = Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value!);
        await _authService.LogoutAsync(userId);
        return Ok(new { message = "Logged out successfully" });
    }
}
