import express from 'express';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration from environment variables
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY;
const DEFAULT_BOUNDING_BOX = process.env.DEFAULT_BOUNDING_BOX || '[[-48.0,166.0],[-34.0,179.0]]';
const DEBUG = process.env.DEBUG === 'true';
const CACHE_FILE = '/data/vessel-cache.json';

// In-memory vessel cache
const vesselCache = new Map();

// Load cache from disk on startup
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            const cached = JSON.parse(data);
            for (const [mmsi, vessel] of Object.entries(cached)) {
                vessel.lastUpdate = new Date(vessel.lastUpdate);
                vesselCache.set(parseInt(mmsi), vessel);
            }
            console.log(`Loaded ${vesselCache.size} vessels from cache`);
        }
    } catch (error) {
        console.warn('Failed to load cache:', error.message);
    }
}

// Save cache to disk
function saveCache() {
    try {
        fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        const cacheObj = Object.fromEntries(vesselCache);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheObj));
        if (DEBUG) console.log(`Saved ${vesselCache.size} vessels to cache`);
    } catch (error) {
        console.warn('Failed to save cache:', error.message);
    }
}

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
    let vessel = vesselCache.get(mmsi) || {
        MMSI: mmsi,
        NAME: '',
        CALLSIGN: '',
        DEST: '',
        TYPE: null,
        IMO: null,
        DRAUGHT: null,
        A: null,
        B: null,
        C: null,
        D: null,
        ETA: null
    };
    
    // Always update position and metadata
    vessel.MMSI = mmsi;
    vessel.TIME = message.MetaData.time_utc;
    vessel.LONGITUDE = message.MetaData.longitude;
    vessel.LATITUDE = message.MetaData.latitude;
    vessel.lastUpdate = new Date();

    if (message.Message?.PositionReport) {
        const pos = message.Message.PositionReport;
        vessel.COG = pos.Cog;
        vessel.SOG = pos.Sog;
        vessel.HEADING = pos.TrueHeading;
        vessel.NAVSTAT = pos.NavigationalStatus;
        if (DEBUG) console.log(`Position update for MMSI ${mmsi}, NAME: ${vessel.NAME}`);
    }

    if (message.Message?.ShipStaticData) {
        const static_data = message.Message.ShipStaticData;
        if (DEBUG) console.log(`Raw static data for MMSI ${mmsi}:`, JSON.stringify(static_data, null, 2));
        
        if (static_data.CallSign) vessel.CALLSIGN = static_data.CallSign;
        if (static_data.Destination) vessel.DEST = static_data.Destination;
        if (static_data.Type !== undefined) vessel.TYPE = static_data.Type;
        if (static_data.ImoNumber !== undefined) vessel.IMO = static_data.ImoNumber;
        if (static_data.MaximumStaticDraught !== undefined) vessel.DRAUGHT = static_data.MaximumStaticDraught;
        
        if (static_data.Name) {
            vessel.NAME = static_data.Name.trim();
            if (DEBUG) console.log(`Setting NAME for MMSI ${mmsi}: '${vessel.NAME}'`);
        }
        
        if (static_data.Dimension) {
            if (static_data.Dimension.A !== undefined) vessel.A = static_data.Dimension.A;
            if (static_data.Dimension.B !== undefined) vessel.B = static_data.Dimension.B;
            if (static_data.Dimension.C !== undefined) vessel.C = static_data.Dimension.C;
            if (static_data.Dimension.D !== undefined) vessel.D = static_data.Dimension.D;
        }
        
        if (static_data.Eta) {
            const eta = static_data.Eta;
            const month = eta.Month?.toString().padStart(2, '0') || '00';
            const day = eta.Day?.toString().padStart(2, '0') || '00';
            const hour = eta.Hour?.toString().padStart(2, '0') || '00';
            const minute = eta.Minute?.toString().padStart(2, '0') || '00';
            vessel.ETA = `${month}/${day} ${hour}:${minute}`;
        }
    }

    vesselCache.set(mmsi, vessel);
    
    // Save cache periodically (every 100 updates)
    if (Math.random() < 0.01) saveCache();
}

// Clean up old vessels every 5 minutes
setInterval(() => {
    const oneHourAgo = new Date(Date.now() - 3600000);
    let removed = 0;
    for (const [mmsi, vessel] of vesselCache.entries()) {
        if (vessel.lastUpdate < oneHourAgo) {
            vesselCache.delete(mmsi);
            removed++;
        }
    }
    if (removed > 0) {
        console.log(`Cleaned up ${removed} old vessels`);
        saveCache();
    }
}, 300000);

// Save cache every 10 minutes
setInterval(saveCache, 600000);

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
            // Ensure all expected AISHub fields are present
            const vesselData = {
                MMSI: vessel.MMSI,
                TIME: vessel.TIME,
                LONGITUDE: vessel.LONGITUDE,
                LATITUDE: vessel.LATITUDE,
                COG: vessel.COG,
                SOG: vessel.SOG,
                HEADING: vessel.HEADING,
                NAVSTAT: vessel.NAVSTAT,
                IMO: vessel.IMO,
                NAME: vessel.NAME || '',
                CALLSIGN: vessel.CALLSIGN || '',
                TYPE: vessel.TYPE,
                A: vessel.A,
                B: vessel.B,
                C: vessel.C,
                D: vessel.D,
                DRAUGHT: vessel.DRAUGHT,
                DEST: vessel.DEST || '',
                ETA: vessel.ETA
            };
            vessels.push(vesselData);
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

app.get('/debug', (req, res) => {
    const vessels = Array.from(vesselCache.values()).slice(0, 5); // First 5 vessels
    res.json({ 
        totalVessels: vesselCache.size,
        sampleVessels: vessels
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Saving cache before shutdown...');
    saveCache();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Saving cache before shutdown...');
    saveCache();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`AIS Proxy server running on port ${PORT}`);
    loadCache();
    if (AISSTREAM_API_KEY) {
        connectToAISStream();
    } else {
        console.error('AISSTREAM_API_KEY environment variable is required');
    }
});