using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using IM.Core.Entities;
using IM.Core.Enums;
using IM.Core.Interfaces;
using IM.Infrastructure.Data;

namespace IM.Infrastructure.Services;

public class AuthService : IAuthService
{
    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AuthService> _logger;
    private readonly IEmailService _emailService;
    private readonly ISmsService _smsService;
    private readonly INotificationService _notificationService;
    private const int TOKEN_EXPIRY_MINUTES = 10;
    private const int MAX_ATTEMPTS = 5;

    public AuthService(
        ApplicationDbContext context,
        IConfiguration configuration,
        ILogger<AuthService> logger,
        IEmailService emailService,
        ISmsService smsService,
        INotificationService notificationService)
    {
        _context = context;
        _configuration = configuration;
        _logger = logger;
        _emailService = emailService;
        _smsService = smsService;
        _notificationService = notificationService;
    }

    public async Task<(bool Success, string? FullName, string? MaskedEmail, string? MaskedPhone, string? Message)> RequestLoginTokenAsync(string serviceNumber)
    {
        var nominalRoll = await _context.NominalRolls
            .FirstOrDefaultAsync(n => n.ServiceNumber == serviceNumber && n.Status == UserStatus.Active);

        if (nominalRoll == null)
        {
            return (false, null, null, null, "Service number not found or inactive");
        }

        // Invalidate any existing tokens for this user
        var existingTokens = await _context.LoginTokens
            .Where(t => t.NominalRollId == nominalRoll.Id && !t.IsUsed && t.ExpiresAt > DateTime.UtcNow)
            .ToListAsync();

        foreach (var token in existingTokens)
        {
            token.IsUsed = true;
        }

        // Generate a 6-digit token
        var tokenCode = GenerateNumericToken(6);

        var loginToken = new LoginToken
        {
            NominalRollId = nominalRoll.Id,
            Token = tokenCode,
            ExpiresAt = DateTime.UtcNow.AddMinutes(TOKEN_EXPIRY_MINUTES),
            IsUsed = false,
            AttemptCount = 0
        };

        await _context.LoginTokens.AddAsync(loginToken);
        await _context.SaveChangesAsync();

        // Get user info for masking (check if user exists)
        var user = await _context.Users.FirstOrDefaultAsync(u => u.NominalRollId == nominalRoll.Id);

        string? maskedEmail = null;
        string? maskedPhone = null;

        if (user != null)
        {
            maskedPhone = MaskPhoneNumber(user.PhoneNumber);
        }
        else if (!string.IsNullOrEmpty(nominalRoll.PhoneNumber))
        {
            maskedPhone = MaskPhoneNumber(nominalRoll.PhoneNumber);
        }

        // Get email from User or NominalRoll
        var email = user?.Email ?? nominalRoll.Email;
        if (!string.IsNullOrEmpty(email))
        {
            maskedEmail = MaskEmail(email);
        }

        // Log the token (for debugging)
        _logger.LogInformation("Login token for {ServiceNumber}: {Token}", serviceNumber, tokenCode);

        // Send token via SMS if phone number is available
        string? phoneToSend = user?.PhoneNumber ?? nominalRoll.PhoneNumber;
        if (!string.IsNullOrEmpty(phoneToSend))
        {
            var smsSent = await _smsService.SendVerificationCodeAsync(phoneToSend, tokenCode);
            if (smsSent)
            {
                _logger.LogInformation("Verification code sent via SMS to {Phone}", maskedPhone);
            }
        }

        // Send token via Email if email is available
        if (!string.IsNullOrEmpty(email))
        {
            var emailSent = await _emailService.SendVerificationCodeAsync(email, tokenCode, nominalRoll.FullName);
            if (emailSent)
            {
                _logger.LogInformation("Verification code sent via email to {Email}", maskedEmail);
            }
        }
        else
        {
            _logger.LogWarning("No email address found for service number {ServiceNumber}", serviceNumber);
        }

        return (true, nominalRoll.FullName, maskedEmail, maskedPhone, null);
    }

    public async Task<(User? User, string? AccessToken, string? RefreshToken)> VerifyLoginTokenAsync(string serviceNumber, string token, string? deviceId = null)
    {
        var nominalRoll = await _context.NominalRolls
            .FirstOrDefaultAsync(n => n.ServiceNumber == serviceNumber && n.Status == UserStatus.Active);

        if (nominalRoll == null)
        {
            return (null, null, null);
        }

        var loginToken = await _context.LoginTokens
            .Where(t => t.NominalRollId == nominalRoll.Id && !t.IsUsed && t.ExpiresAt > DateTime.UtcNow)
            .OrderByDescending(t => t.CreatedAt)
            .FirstOrDefaultAsync();

        if (loginToken == null)
        {
            return (null, null, null);
        }

        // Check attempt count
        if (loginToken.AttemptCount >= MAX_ATTEMPTS)
        {
            loginToken.IsUsed = true;
            await _context.SaveChangesAsync();
            return (null, null, null);
        }

        // Verify token
        if (loginToken.Token != token)
        {
            loginToken.AttemptCount++;
            await _context.SaveChangesAsync();
            return (null, null, null);
        }

        // Mark token as used
        loginToken.IsUsed = true;

        // Get or create user
        var user = await _context.Users.FirstOrDefaultAsync(u => u.NominalRollId == nominalRoll.Id);

        if (user == null)
        {
            // Auto-register user on first login
            user = new User
            {
                NominalRollId = nominalRoll.Id,
                PhoneNumber = nominalRoll.PhoneNumber ?? $"+234{GenerateSecurePhoneNumber()}",
                DisplayName = nominalRoll.FullName,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString()), // Random password since we use token auth
            };

            await _context.Users.AddAsync(user);
        }

        // Generate tokens
        var accessToken = GenerateAccessToken(user);
        var refreshToken = GenerateRefreshToken();

        user.RefreshToken = refreshToken;
        user.RefreshTokenExpiryTime = DateTime.UtcNow.AddDays(7);
        user.IsOnline = true;
        user.LastSeen = DateTime.UtcNow;

        await _context.SaveChangesAsync();

        // Single device login enforcement: logout other devices
        // This sends a force_logout notification to all other devices
        await LogoutOtherDevicesAsync(user.Id, deviceId);

        return (user, accessToken, refreshToken);
    }

    public async Task<(string? AccessToken, string? RefreshToken)> RefreshTokenAsync(string refreshToken)
    {
        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.RefreshToken == refreshToken && u.RefreshTokenExpiryTime > DateTime.UtcNow);

        if (user == null)
            return (null, null);

        var newAccessToken = GenerateAccessToken(user);
        var newRefreshToken = GenerateRefreshToken();

        user.RefreshToken = newRefreshToken;
        user.RefreshTokenExpiryTime = DateTime.UtcNow.AddDays(7);

        await _context.SaveChangesAsync();

        return (newAccessToken, newRefreshToken);
    }

    public async Task<bool> LogoutAsync(Guid userId)
    {
        var user = await _context.Users.FindAsync(userId);
        if (user == null)
            return false;

        user.RefreshToken = null;
        user.RefreshTokenExpiryTime = null;
        user.IsOnline = false;
        user.LastSeen = DateTime.UtcNow;

        await _context.SaveChangesAsync();
        return true;
    }

    public async Task LogoutOtherDevicesAsync(Guid userId, string? currentDeviceId)
    {
        // Get all active devices for this user except the current one
        var otherDevices = await _context.UserDevices
            .Where(d => d.UserId == userId && d.IsActive)
            .ToListAsync();

        // Filter out current device if deviceId is provided
        if (!string.IsNullOrEmpty(currentDeviceId))
        {
            otherDevices = otherDevices.Where(d => d.DeviceId != currentDeviceId).ToList();
        }

        if (!otherDevices.Any())
        {
            _logger.LogInformation("No other devices to logout for user {UserId}", userId);
            return;
        }

        _logger.LogInformation("Logging out {Count} other devices for user {UserId}", otherDevices.Count, userId);

        // Send force logout notification to other devices before deactivating them
        await _notificationService.SendForceLogoutNotificationAsync(userId, "You have been logged out because you logged in on another device.");

        // Deactivate all other devices
        foreach (var device in otherDevices)
        {
            device.IsActive = false;
        }

        await _context.SaveChangesAsync();
        _logger.LogInformation("Other devices deactivated for user {UserId}", userId);
    }

    public string GenerateAccessToken(User user)
    {
        var jwtSettings = _configuration.GetSection("JwtSettings");
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings["SecretKey"]!));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.MobilePhone, user.PhoneNumber),
            new Claim(ClaimTypes.Name, user.DisplayName ?? ""),
            new Claim("NominalRollId", user.NominalRollId.ToString())
        };

        var token = new JwtSecurityToken(
            issuer: jwtSettings["Issuer"],
            audience: jwtSettings["Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(int.Parse(jwtSettings["ExpiryMinutes"]!)),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string GenerateRefreshToken()
    {
        var randomNumber = new byte[64];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(randomNumber);
        return Convert.ToBase64String(randomNumber);
    }

    private static string GenerateNumericToken(int length)
    {
        var token = new StringBuilder(length);
        var randomBytes = new byte[length];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(randomBytes);

        for (int i = 0; i < length; i++)
        {
            // Map each byte to a digit 0-9
            token.Append(randomBytes[i] % 10);
        }
        return token.ToString();
    }

    private static string GenerateSecurePhoneNumber()
    {
        // Generate a secure random phone number in range 7000000000-9999999999
        using var rng = RandomNumberGenerator.Create();
        var bytes = new byte[8];
        rng.GetBytes(bytes);
        var value = BitConverter.ToUInt64(bytes, 0);
        // Map to range 7000000000-9999999999 (3 billion range)
        var number = 7000000000 + (value % 3000000000);
        return number.ToString();
    }

    private static string MaskPhoneNumber(string phone)
    {
        if (string.IsNullOrEmpty(phone) || phone.Length < 6)
            return "***";

        return $"{phone[..3]}****{phone[^3..]}";
    }

    private static string MaskEmail(string email)
    {
        if (string.IsNullOrEmpty(email))
            return "***";

        var parts = email.Split('@');
        if (parts.Length != 2)
            return "***";

        var name = parts[0];
        var domain = parts[1];

        if (name.Length <= 2)
            return $"**@{domain}";

        return $"{name[0]}***{name[^1]}@{domain}";
    }
}
