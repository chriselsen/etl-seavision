# AIS Proxy

AISHub-compatible proxy service that connects to AISStream WebSocket and provides REST API access to cached vessel data.

## Features

- Connects to AISStream WebSocket for real-time AIS data
- Maintains in-memory cache of vessel positions
- Provides AISHub-compatible REST API endpoint
- Automatic reconnection and cache cleanup
- Docker support for easy deployment

## Configuration

Set environment variables:

```bash
AISSTREAM_API_KEY=your_aisstream_api_key
DEFAULT_BOUNDING_BOX=[[-48.0,166.0],[-34.0,179.0]]
PORT=3000
```

## Usage

### Docker Compose (Recommended)

```bash
cp .env.example .env
# Edit .env with your AISStream API key
docker-compose up -d
```

### Direct Node.js

```bash
npm install
AISSTREAM_API_KEY=your_key npm start
```

## API Endpoints

### Get Vessels
```
GET /ws.php?username=your_api_key&latmin=-48&latmax=-34&lonmin=166&lonmax=179
```

Returns AISHub-compatible JSON:
```json
{
  "VESSELS": [
    {
      "MMSI": 123456789,
      "TIME": "2024-01-01T12:00:00.000Z",
      "LONGITUDE": 174.7,
      "LATITUDE": -41.3,
      "COG": 45,
      "SOG": 12.5,
      "NAME": "VESSEL NAME"
    }
  ]
}
```

### Health Check
```
GET /health
```

## Integration

Update your ETL configuration to use the proxy:

```bash
# Instead of: http://data.aishub.net/ws.php
# Use: http://localhost:3000/ws.php
```