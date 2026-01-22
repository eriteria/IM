using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using IM.Core.Interfaces;
using System.Security.Claims;

namespace IM.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class NotificationsController : ControllerBase
{
    private readonly INotificationService _notificationService;

    public NotificationsController(INotificationService notificationService)
    {
        _notificationService = notificationService;
    }

    private Guid GetUserId() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value!);

    [HttpPost("register")]
    public async Task<ActionResult> RegisterDevice([FromBody] RegisterDeviceRequest request)
    {
        var userId = GetUserId();
        await _notificationService.RegisterDeviceTokenAsync(userId, request.Token, request.Platform, request.DeviceId);
        return Ok(new { message = "Device registered for notifications" });
    }

    [HttpPost("unregister")]
    public async Task<ActionResult> UnregisterDevice([FromBody] UnregisterDeviceRequest request)
    {
        var userId = GetUserId();
        await _notificationService.UnregisterDeviceTokenAsync(userId, request.Token);
        return Ok(new { message = "Device unregistered from notifications" });
    }

    [HttpPost("register-voip")]
    public async Task<ActionResult> RegisterVoipDevice([FromBody] RegisterDeviceRequest request)
    {
        var userId = GetUserId();
        await _notificationService.RegisterVoipTokenAsync(userId, request.Token, request.Platform, request.DeviceId);
        return Ok(new { message = "VoIP device registered for call notifications" });
    }

    /// <summary>
    /// Get the status of notification services (Firebase and APNs)
    /// </summary>
    [HttpGet("status")]
    public ActionResult GetNotificationStatus()
    {
        var status = _notificationService.GetServiceStatus();
        return Ok(new
        {
            firebase = new
            {
                enabled = status.IsFirebaseEnabled,
                error = status.FirebaseError
            },
            apns = new
            {
                enabled = status.IsApnsEnabled,
                error = status.ApnsError
            },
            lastChecked = status.LastChecked
        });
    }
}

public class RegisterDeviceRequest
{
    public string Token { get; set; } = string.Empty;
    public string Platform { get; set; } = string.Empty; // "ios" or "android"
    public string? DeviceId { get; set; }
}

public class UnregisterDeviceRequest
{
    public string Token { get; set; } = string.Empty;
}
