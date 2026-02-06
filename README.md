# IM - Instant Messaging Application

A full-featured WhatsApp-like messaging application with React Native mobile apps and a C# .NET 8 backend.

## Features

- **Real-time Messaging**: One-on-one and group chats with SignalR
- **Voice & Video Calls**: WebRTC-based calls using LiveKit (open source)
- **End-to-End Encryption**: TweetNaCl for message encryption
- **Message Expiry**: Configurable auto-delete (24h, 7d, 30d, 90d, or never)
- **Push Notifications**: Firebase Cloud Messaging & APNs
- **Status/Stories**: WhatsApp-style status updates
- **Nominal Roll Validation**: Employee verification for registration
- **Media Sharing**: Images, videos, documents, and audio messages

## Tech Stack

### Mobile App (React Native)
- React Native 0.73+ with TypeScript
- React Navigation 6
- Zustand + React Query for state management
- @microsoft/signalr for real-time messaging
- @livekit/react-native for voice/video calls
- TweetNaCl.js for E2E encryption

### Backend (C# .NET 8)
- ASP.NET Core 8 Web API
- Entity Framework Core 8 with PostgreSQL
- SignalR for real-time communication
- LiveKit Server for WebRTC
- JWT authentication with refresh tokens

## Project Structure

```
IM/
├── mobile/                     # React Native App
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   ├── screens/            # Screen components
│   │   ├── navigation/         # Navigation configuration
│   │   ├── services/           # API, SignalR, encryption
│   │   ├── stores/             # Zustand stores
│   │   ├── utils/              # Utilities
│   │   └── types/              # TypeScript types
│   ├── android/
│   └── ios/
│
├── backend/                    # C# .NET Backend
│   ├── IM.API/                 # Web API project
│   ├── IM.Core/                # Domain/Business logic
│   └── IM.Infrastructure/      # Data access & external services
│
├── livekit/                    # LiveKit server config
├── nginx/                      # Nginx configuration
├── scripts/                    # Database scripts
└── docker-compose.yml
```

## Prerequisites

- Docker and Docker Compose
- Node.js 18+ and npm
- .NET 8 SDK (for development)
- Android Studio (for Android development)
- Xcode (for iOS development, macOS only)
- Firebase project (for push notifications)

## Getting Started

### 1. Clone and Configure

```bash
git clone <repository-url>
cd IM

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
```

### 2. Start Backend Services

```bash
# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f api
```

### 3. Run Database Migrations

```bash
cd backend
dotnet ef database update --project IM.Infrastructure --startup-project IM.API
```

### 4. Set Up Mobile App

```bash
cd mobile

# Install dependencies
npm install

# iOS only: Install pods
cd ios && pod install && cd ..

# Start Metro bundler
npm start

# Run on Android
npm run android

# Run on iOS
npm run ios
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_USER` | PostgreSQL username | `im_user` |
| `POSTGRES_PASSWORD` | PostgreSQL password | Required |
| `POSTGRES_DB` | Database name | `im_db` |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | Required |
| `LIVEKIT_API_KEY` | LiveKit API key | `devkey` |
| `LIVEKIT_API_SECRET` | LiveKit API secret | `devsecret` |

### Mobile App Configuration

Create `mobile/.env`:

```
API_URL=http://localhost:5000/api
SIGNALR_URL=http://localhost:5000/hubs
LIVEKIT_URL=ws://localhost:7880
```

### Firebase Setup

1. Create a Firebase project
2. Download `google-services.json` (Android) and `GoogleService-Info.plist` (iOS)
3. Place files in the respective platform directories
4. Download service account key as `firebase-credentials.json` in backend folder

## Documentation

### Audio Routing

For a detailed breakdown of how audio routing is managed in the mobile app:
- **[Audio Routing Breakdown](./AUDIO_ROUTING_BREAKDOWN.md)** - Complete technical documentation
- **[Audio Routing Summary](./AUDIO_ROUTING_SUMMARY.md)** - Quick reference guide

### API Documentation

When running locally, Swagger UI is available at:
- http://localhost:5000/swagger

### Key Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/validate-service-number` | Validate employee service number |
| `POST /api/auth/register` | Register new user |
| `POST /api/auth/login` | Login and get tokens |
| `GET /api/conversations` | Get all conversations |
| `POST /api/calls/initiate` | Start a call |

### SignalR Hubs

| Hub | Purpose |
|-----|---------|
| `/hubs/chat` | Messaging, typing indicators, read receipts |
| `/hubs/call` | Call signaling |
| `/hubs/presence` | Online status |

## Admin API

The admin API allows managing the nominal roll and users:

```bash
# Add employee to nominal roll
POST /api/admin/nominal-roll
{
  "serviceNumber": "EMP001",
  "fullName": "John Doe",
  "phoneNumber": "+1234567890",
  "department": "IT",
  "rankPosition": "Developer"
}

# Bulk import from CSV
POST /api/admin/nominal-roll/bulk
Content-Type: multipart/form-data
file: employees.csv
```

## Message Expiry Options

Users can set message expiry per conversation:
- 24 hours
- 7 days
- 30 days
- 90 days
- Never (no expiry)

## Security Features

- End-to-end encryption using X25519 key exchange + XSalsa20-Poly1305
- JWT tokens with short expiry + refresh tokens
- Rate limiting on all endpoints
- Secure key storage (iOS Keychain / Android Keystore)
- Input validation and sanitization

## Development

### Backend Development

```bash
cd backend

# Restore packages
dotnet restore

# Run with hot reload
dotnet watch run --project IM.API
```

### Mobile Development

```bash
cd mobile

# Start Metro bundler
npm start

# Run tests
npm test

# Type check
npm run typecheck
```

## Production Deployment

1. Update `.env` with production values
2. Configure SSL certificates in `nginx/ssl/`
3. Run with production profile:

```bash
docker-compose --profile production up -d
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is proprietary software. All rights reserved.

## Support

For issues and feature requests, please open an issue in the repository.
