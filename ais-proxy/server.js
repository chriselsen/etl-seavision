import express from 'express';
import WebSocket from 'ws';

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration from environment variables
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY;
const DEFAULT_BOUNDING_BOX = process.env.DEFAULT_BOUNDING_BOX || '[[-48.0,166.0],[-34.0,179.0]]';

// In-memory vessel cache
const vesselCache = new Map();

// Connect to AISStream WebSocket
function connectToAISStream() {
    const boundingBox = JSON.parse(DEFAULT_BOUNDING_BOX);
    
    const subscriptionMessage = {
        APIKey: AISSTREAM_API_KEY,
        BoundingBoxes: [boundingBox],
        FilterMessageTypes: ["PositionReport", "ShipStaticData"]
    };

    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    
    ws.on('open', () => {
        console.log('Connected to AISStream');
        ws.send(JSON.stringify(subscriptionMessage));
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            processAISMessage(message);
        } catch (error) {
            console.warn('Failed to parse AIS message:', error);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        setTimeout(connectToAISStream, 5000);
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed, reconnecting...');
        setTimeout(connectToAISStream, 5000);
    });
}

function processAISMessage(message) {
    if (!message.MetaData?.MMSI) return;
    
    const mmsi = message.MetaData.MMSI;
    const existing = vesselCache.get(mmsi) || {};
    
    const vessel = {
        ...existing,
        MMSI: mmsi,
        TIME: message.MetaData.time_utc,
        LONGITUDE: message.MetaData.longitude,
        LATITUDE: message.MetaData.latitude,
        lastUpdate: new Date()
    };

    if (message.Message?.PositionReport) {
        const pos = message.Message.PositionReport;
        vessel.COG = pos.Cog;
        vessel.SOG = pos.Sog;
        vessel.HEADING = pos.TrueHeading;
        vessel.NAVSTAT = pos.NavigationalStatus;
    }

    if (message.Message?.ShipStaticData) {
        const static_data = message.Message.ShipStaticData;
        vessel.CALLSIGN = static_data.CallSign;
        vessel.DEST = static_data.Destination;
        vessel.TYPE = static_data.Type;
        vessel.IMO = static_data.ImoNumber;
        vessel.DRAUGHT = static_data.MaximumStaticDraught;
        if (static_data.ShipName) vessel.NAME = static_data.ShipName;
        if (static_data.Dimension) {
            vessel.A = static_data.Dimension.A;
            vessel.B = static_data.Dimension.B;
            vessel.C = static_data.Dimension.C;
            vessel.D = static_data.Dimension.D;
        }
        if (static_data.Eta) {
            const eta = static_data.Eta;
            vessel.ETA = `${eta.Month}/${eta.Day} ${eta.Hour}:${eta.Minute}`;
        }
    }

    vesselCache.set(mmsi, vessel);
}

// Clean up old vessels every 5 minutes
setInterval(() => {
    const oneHourAgo = new Date(Date.now() - 3600000);
    for (const [mmsi, vessel] of vesselCache.entries()) {
        if (vessel.lastUpdate < oneHourAgo) {
            vesselCache.delete(mmsi);
        }
    }
}, 300000);

// AISHub-compatible REST endpoint
app.get('/ws.php', (req, res) => {
    const { username, latmin, latmax, lonmin, lonmax } = req.query;
    
    if (username !== AISSTREAM_API_KEY) {
        return res.json({ ERROR: true });
    }
    
    if (!latmin || !latmax || !lonmin || !lonmax) {
        return res.json({ ERROR: true });
    }

    const minLat = parseFloat(latmin);
    const maxLat = parseFloat(latmax);
    const minLon = parseFloat(lonmin);
    const maxLon = parseFloat(lonmax);

    const vessels = [];
    for (const vessel of vesselCache.values()) {
        if (vessel.LATITUDE >= minLat && vessel.LATITUDE <= maxLat &&
            vessel.LONGITUDE >= minLon && vessel.LONGITUDE <= maxLon) {
            vessels.push(vessel);
        }
    }

    res.json({ VESSELS: vessels });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        vessels: vesselCache.size,
        uptime: process.uptime()
    });
});

app.listen(PORT, () => {
    console.log(`AIS Proxy server running on port ${PORT}`);
    if (AISSTREAM_API_KEY) {
        connectToAISStream();
    } else {
        console.error('AISSTREAM_API_KEY environment variable is required');
    }
});